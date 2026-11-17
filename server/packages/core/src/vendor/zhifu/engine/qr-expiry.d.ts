/**
 * When the QR / pay link shown to the player stops working = the earliest of: the order's own expiry,
 * the upstream-reported expiry, and the channel's 「二维码有效期」 override (`qrTtlSec`, seconds from
 * when the upstream accepted). The 中转站 reports a fixed 15-minute `expire_at` regardless of the line
 * (章鱼哥 / paofen really expire after 2 minutes), so such channels set the override. Pure.
 */
export declare function qrExpiresAt(input: {
    orderExpiresAt: Date;
    upstreamExpiresAt?: Date | undefined;
    qrTtlSec?: number | undefined;
    now: Date;
}): Date;