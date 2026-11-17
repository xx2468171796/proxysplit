import { z } from 'zod'
/** env 里留空（KEY=）当没配 */
const blank=<T extends z.ZodType>(inner:T)=>z.preprocess(v=>v===''?undefined:v,inner.optional())
const schema=z.object({NODE_ENV:z.enum(['development','test','production']).default('development'),HOST:z.string().default('127.0.0.1'),PORT:z.coerce.number().int().min(1).max(65535).default(18780),PUBLIC_BASE_URL:z.string().url().default('http://127.0.0.1:18780'),DATABASE_URL:z.string().min(1),REDIS_URL:z.string().url().optional(),ACCESS_TOKEN_SECRET:z.string().min(32),REFRESH_TOKEN_TTL_DAYS:z.coerce.number().int().min(1).max(365).default(30),LICENSE_PRIVATE_KEY_PEM:z.string().optional(),LICENSE_PUBLIC_KEY_PEM:z.string().optional(),ACCEL_TOKEN_PRIVATE_KEY_PEM:z.string().optional(),POWERVPN_BASE_URL:z.string().url().optional(),ADMIN_ORIGIN:z.string().url().default('http://127.0.0.1:18781'),BOOTSTRAP_ADMIN_USERNAME:z.string().optional(),BOOTSTRAP_ADMIN_PASSWORD:z.string().min(10).optional(),TZ_AI_TOKEN:z.string().min(32).optional(),
  // 客户端日志上报：保留天数（默认 7）、压缩后单批上限（默认 1 MB）、每台设备每分钟上报次数（默认 30）
  TELEMETRY_RETENTION_DAYS:z.coerce.number().int().min(1).max(365).optional(),TELEMETRY_MAX_GZIP_BYTES:z.coerce.number().int().min(1024).max(4*1024*1024).optional(),TELEMETRY_IP_BYTES_PER_10MIN:z.coerce.number().int().min(64*1024).max(1024*1024*1024).optional(),TELEMETRY_PER_DEVICE_PER_MINUTE:z.coerce.number().int().min(1).max(600).optional(),
  // 同事节点上报（docs/节点上报.md）：链接加密密钥（32 字节 base64，不配则不存链接）、能解密链接的超管用户名（逗号分隔，默认 admin）
  NODE_LINK_KEY:z.string().optional(),SUPER_ADMIN_USERNAMES:z.string().optional(),
  // 短信（云片，堡垒机资产 #289）：没配 key 时开发环境把验证码打日志，生产 503；模板 id 默认 6437354
  YUNPIAN_API_KEY:z.string().optional(),YUNPIAN_TPL_ID:z.string().regex(/^\d+$/).optional(),
  // 短信验证码走雷池验证中心：LCV_SITE_ID / LCV_HOST / LCV_SITE_SECRET 三项都配 = 中心模式（要 REDIS_URL），都不配 = 本地模式（上面的云片）；
  // 只配一部分启动报错。LCV_URL = 中心签名端口（容器里是宿主桥接地址），不配用 SDK 默认 http://127.0.0.1:8977。空串当没配。
  LCV_SITE_ID:blank(z.string().regex(/^[a-z0-9_-]{1,32}$/)),LCV_HOST:blank(z.string().regex(/^[a-z0-9.-]+$/i)),LCV_SITE_SECRET:blank(z.string().min(32)),LCV_URL:blank(z.string().url()),
  // 配置云同步 / 云端配置加密密钥：32 字节 base64（openssl rand -base64 32），不配则相关接口 503
  CONFIG_SYNC_KEY:z.string().optional(),
  // 代理站：aigw 公开接口地址（默认 https://ai.zygskins.cn）；Host 头（走内网地址绕开公网 WAF 时填 ai.zygskins.cn，可空）
  AIGW_PUBLIC_BASE:z.string().url().optional(),AIGW_PUBLIC_HOST:z.string().regex(/^(?:[a-z0-9.-]+(?::\d+)?)?$/i).optional()}).superRefine((v,ctx)=>{if(v.NODE_ENV==='production'&&!v.LICENSE_PRIVATE_KEY_PEM)ctx.addIssue({code:'custom',path:['LICENSE_PRIVATE_KEY_PEM'],message:'A persistent Ed25519 private key is required in production'})
  const lcv=[v.LCV_SITE_ID,v.LCV_HOST,v.LCV_SITE_SECRET].filter(Boolean).length
  if(lcv>0&&lcv<3)ctx.addIssue({code:'custom',path:['LCV_SITE_SECRET'],message:'LCV_SITE_ID, LCV_HOST and LCV_SITE_SECRET must be set together (all three = verification center, none = local SMS)'})
  if(lcv===3&&!v.REDIS_URL)ctx.addIssue({code:'custom',path:['REDIS_URL'],message:'REDIS_URL is required when LCV_* is configured'})})
export type ApiConfig=z.infer<typeof schema>
export const loadConfig=(env:NodeJS.ProcessEnv=process.env)=>schema.parse(env)
