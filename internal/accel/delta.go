// Package accel 是 Claude Code 加速的客户端编码端：把 Claude Code 的请求压成「只发和上一轮不同的部分」，
// 经所选节点送到落地机上的解码中继（sub2api 仓 accel/，Rust）还原后发官方。
//
// 协议与中继逐字节兼容（中继 0.5）：增量帧 AXD1、可续传流（请求 ID、D/K/E 帧、按字节续传）、用户加速令牌、签名打招呼。
// 设计见 docs/Claude加速-网关切换.md。
package accel

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"

	"github.com/klauspost/compress/zstd"
)

// 帧格式（小端）：
//
//	"AXD1" | kind u8 (0=整包, 1=增量) | [增量: 基准 sha256 32B | 前缀长度 u32] | 目标 sha256 32B | 目标长度 u32 | zstd 帧
//
// 增量时 zstd 以「基准从前缀前 1MB 起、最多 8MB」为原始内容字典（与中继 dict_window 一致）。
const (
	dictBefore = 1 << 20
	dictMax    = 8 << 20
	minPrefix  = 4096
	maxBody    = 64 << 20
	windowSize = 1 << 25
)

var magic = []byte("AXD1")

type Sha = [32]byte

// Encoded 是编码结果
type Encoded struct {
	Frame     []byte
	Prefix    int // 引用基准时的公共前缀长度；整包为 0
	TargetSha Sha
}

// commonPrefix 返回两段字节的公共前缀长度
func commonPrefix(a, b []byte) int {
	n := min(len(a), len(b))
	i := 0
	for i+8 <= n && bytes.Equal(a[i:i+8], b[i:i+8]) {
		i += 8
	}
	for i < n && a[i] == b[i] {
		i++
	}
	return i
}

func dictWindow(base []byte, prefix int) []byte {
	start := max(prefix-dictBefore, 0)
	end := min(len(base), start+dictMax)
	return base[start:end]
}

// Encode 编码 cur；base 为 nil 或公共前缀不足 minPrefix 时发整包
func Encode(base []byte, baseSha *Sha, cur []byte) (Encoded, error) {
	if len(cur) > maxBody {
		return Encoded{}, fmt.Errorf("请求体 %d 字节超过上限", len(cur))
	}
	target := sha256.Sum256(cur)
	prefix := 0
	if base != nil {
		prefix = commonPrefix(base, cur)
	}
	frame := make([]byte, 0, 128+(len(cur)-prefix)/2)
	frame = append(frame, magic...)
	var payload []byte
	var err error
	if base != nil && baseSha != nil && prefix >= minPrefix {
		frame = append(frame, 1)
		frame = append(frame, baseSha[:]...)
		frame = binary.LittleEndian.AppendUint32(frame, uint32(prefix))
		payload, err = compress(dictWindow(base, prefix), cur[prefix:])
	} else {
		prefix = 0
		frame = append(frame, 0)
		payload, err = compress(nil, cur)
	}
	if err != nil {
		return Encoded{}, err
	}
	frame = append(frame, target[:]...)
	frame = binary.LittleEndian.AppendUint32(frame, uint32(len(cur)))
	frame = append(frame, payload...)
	return Encoded{Frame: frame, Prefix: prefix, TargetSha: target}, nil
}

func compress(dict, src []byte) ([]byte, error) {
	opts := []zstd.EOption{
		zstd.WithEncoderLevel(zstd.SpeedDefault),
		zstd.WithWindowSize(windowSize),
		zstd.WithEncoderCRC(false),
		zstd.WithEncoderConcurrency(1),
		zstd.WithZeroFrames(true),
	}
	if len(dict) >= 8 {
		// id 0：帧头不写字典 ID，中继按「原始内容前缀」（ZSTD_refPrefix）解
		opts = append(opts, zstd.WithEncoderDictRaw(0, dict))
	}
	enc, err := zstd.NewWriter(nil, opts...)
	if err != nil {
		return nil, err
	}
	defer enc.Close()
	return enc.EncodeAll(src, make([]byte, 0, len(src)/4+64)), nil
}

// ErrNeedBase 表示解码端没有引用的基准
var ErrNeedBase = errors.New("缺基准")

// Decode 解码并逐字节校验（测试与自检用；线上解码在中继）
func Decode(frame []byte, lookup func(Sha) []byte) ([]byte, error) {
	bad := func(why string) error { return fmt.Errorf("帧损坏：%s", why) }
	if len(frame) < 5 || !bytes.Equal(frame[:4], magic) {
		return nil, bad("magic")
	}
	pos := 5
	var base []byte
	prefix := 0
	switch frame[4] {
	case 0:
	case 1:
		if len(frame) < pos+36 {
			return nil, bad("短帧")
		}
		var sha Sha
		copy(sha[:], frame[pos:pos+32])
		prefix = int(binary.LittleEndian.Uint32(frame[pos+32 : pos+36]))
		pos += 36
		if base = lookup(sha); base == nil {
			return nil, ErrNeedBase
		}
		if prefix > len(base) {
			return nil, bad("前缀长于基准")
		}
	default:
		return nil, bad("未知类型")
	}
	if len(frame) < pos+36 {
		return nil, bad("短帧")
	}
	var target Sha
	copy(target[:], frame[pos:pos+32])
	tlen := int(binary.LittleEndian.Uint32(frame[pos+32 : pos+36]))
	pos += 36
	if tlen > maxBody || prefix > tlen {
		return nil, bad("长度")
	}
	opts := []zstd.DOption{zstd.WithDecoderMaxWindow(windowSize * 2), zstd.WithDecoderConcurrency(1), zstd.WithDecoderMaxMemory(uint64(tlen) + 1)}
	var dict []byte
	if base != nil {
		dict = dictWindow(base, prefix)
		if len(dict) >= 8 {
			opts = append(opts, zstd.WithDecoderDictRaw(0, dict))
		}
	}
	dec, err := zstd.NewReader(nil, opts...)
	if err != nil {
		return nil, err
	}
	defer dec.Close()
	out := make([]byte, 0, tlen)
	if base != nil {
		out = append(out, base[:prefix]...)
	}
	suffix, err := dec.DecodeAll(frame[pos:], nil)
	if err != nil {
		return nil, bad(err.Error())
	}
	out = append(out, suffix...)
	if len(out) != tlen || sha256.Sum256(out) != target {
		return nil, bad("校验不符")
	}
	return out, nil
}
