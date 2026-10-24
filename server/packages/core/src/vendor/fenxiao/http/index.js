// fenxiao/http:框架无关的处理器,输入「已鉴权的 id + 参数」,输出 { status, body }。宿主只管鉴权、限流、绑路由。
export { createAdminHandlers } from "./admin.js";
export { err, HTTP_STATUS_BY_CODE, KIND_BY_STATUS, kindOfStatus, maskName, toJson, } from "./shared.js";
export { createUserHandlers } from "./user.js";
