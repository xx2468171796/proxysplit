/**
 * fenxiao(多级分销)域类型。
 *
 * 一句话模型:**每个用户最多一个上级(注册时带码绑定,一生一次,后台可改挂);
 * 下级付款时沿上级链逐级算佣金,先冻结(退款观察期),到期转可提现,推广人申请提现、后台审核打款;
 * 订单退款时同事务冲回佣金。**
 *
 * 刻意的边界:
 * 1. 用户 id 是不透明字符串;包内不存昵称手机号,显示名由宿主投影。
 * 2. 金额一律 bigint,单位由宿主定(人民币分最常见),只做整数运算、向下取整。
 * 3. 规则(FxPolicy)由宿主的配置系统给,每次结算现取;默认值是「关」。
 * 4. 包不打款:提现单「已打款」只是记账,真实转账由财务在线下 / 支付平台完成。
 * 5. 合规:默认最多返 2 级,超过 3 级必须显式 allowDeepLevels(国内「三级及以上」有传销风险,见 INTEGRATION.md)。
 */
export const FxErrorCodes = {
    POLICY_INVALID: "FX_POLICY_INVALID",
    INPUT_INVALID: "FX_INPUT_INVALID",
    NOT_FOUND: "FX_NOT_FOUND",
    TIER_NOT_FOUND: "FX_TIER_NOT_FOUND",
    CODE_TAKEN: "FX_CODE_TAKEN",
    CODE_INVALID: "FX_CODE_INVALID",
    NOT_ELIGIBLE: "FX_NOT_ELIGIBLE",
    CYCLE: "FX_CYCLE",
    AMOUNT_INVALID: "FX_AMOUNT_INVALID",
    BELOW_MIN_WITHDRAWAL: "FX_BELOW_MIN_WITHDRAWAL",
    INSUFFICIENT_BALANCE: "FX_INSUFFICIENT_BALANCE",
    ALREADY_CLOSED: "FX_ALREADY_CLOSED",
    APPLICATION_CLOSED: "FX_APPLICATION_CLOSED",
};
/** 只给调用方错误(参数 / 状态不允许)用;绑定与结算不抛,返回结果对象 */
export class FenxiaoError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "FenxiaoError";
        this.code = code;
    }
}
