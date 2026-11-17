// 链路状态（link_app.go → internal/service/link_svc.go）：当前节点、Google 延迟、实时 Ping。Go 返回值在这里用 Zod 校验。
import { z } from "zod";
import * as W from "../../wailsjs/go/main/App.js";

const LinkStatusSchema = z.object({
  running: z.boolean().default(false),
  nodeId: z.string().default(""),
  nodeName: z.string().default(""),
  nodeType: z.string().default(""),
  core: z.string().default(""),
  /** 0 = 还没测，-1 = 测不通 */
  googleMs: z.number().default(0),
  /** 节点保活探测最近一次 TCP 往返；0 = 没有，-1 = 失败 */
  pingMs: z.number().default(0),
  pingP50: z.number().default(0),
  conns: z.number().default(0),
});
export type LinkStatus = z.infer<typeof LinkStatusSchema>;

export const EMPTY_LINK: LinkStatus = LinkStatusSchema.parse({});

export const linkApi = {
  status: async (): Promise<LinkStatus> => LinkStatusSchema.parse(await W.GetLinkStatus()),
};

/** Go 推送的 run-event：代理自己变了状态（内核 / 接管自动重启、救不回来自己停了），message 是给用户看的一句话。 */
const RunEventSchema = z.object({ kind: z.string().default(""), message: z.string().default("") });
export type RunEvent = z.infer<typeof RunEventSchema>;
export const parseRunEvent = (raw: unknown): RunEvent => RunEventSchema.parse(raw ?? {});
