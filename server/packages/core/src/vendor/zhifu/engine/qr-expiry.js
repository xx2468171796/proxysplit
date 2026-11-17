/**
 * When the QR / pay link shown to the player stops working = the earliest of: the order's own expiry,
 * the upstream-reported expiry, and the channel's 「二维码有效期」 override (`qrTtlSec`, seconds from
 * when the upstream accepted). The 中转站 reports a fixed 15-minute `expire_at` regardless of the line
 * (章鱼哥 / paofen really expire after 2 minutes), so such channels set the override. Pure.
 */
export function qrExpiresAt(input) {
    let out = input.orderExpiresAt;
    if (input.upstreamExpiresAt && input.upstreamExpiresAt < out)
        out = input.upstreamExpiresAt;
    if (input.qrTtlSec && input.qrTtlSec > 0) {
        const ttl = new Date(input.now.getTime() + input.qrTtlSec * 1000);
        if (ttl < out)
            out = ttl;
    }
    return out;
}
