// 官网的站点配方（qiantai）：整页的结构和文案都在这一份数据里，SiteView 照着渲染。
// 文案只写软件真实能做的事；价格、版本号这类实时内容不写进配方，放在插槽（{t:"slot"}）里由接口填。
// 按钮 / 导航点了去哪由 app.tsx 的 actions 按文字对应 —— 改这里的按钮文字要同步改 actions。
import type { SiteRecipe } from "qiantai";

export const PROTOCOLS = [
  "HTTP",
  "HTTPS",
  "SOCKS5",
  "VLESS",
  "VMess",
  "Trojan",
  "Shadowsocks",
  "Hysteria2",
  "TUIC",
  "AnyTLS",
  "WireGuard",
];

/** 按钮 / 导航文字（actions 的键） */
export const LABEL = {
  download: "下载 Windows 版",
  navDownload: "下载",
  tour: "看看怎么用",
  features: "功能",
  pricing: "会员",
  faq: "常见问题",
  notice: "使用须知",
  qq: "QQ 群 719243244",
  wechat: "客服微信 zyg69996",
} as const;

const SITE: NonNullable<SiteRecipe["site"]> = {
  name: "ProxySplit",
  nav: [LABEL.features, LABEL.pricing, LABEL.faq, LABEL.notice],
  navCta: LABEL.navDownload,
  note: "Windows / macOS 上按程序分流的网络工具。仅供学习与合法的软件调试使用，请遵守中华人民共和国法律法规。",
  footer: [
    ["产品", [LABEL.features, LABEL.pricing, LABEL.faq, LABEL.notice]],
    ["下载", [LABEL.download]],
    ["联系我们", [LABEL.qq, LABEL.wechat]],
  ],
};

type Blocks = NonNullable<SiteRecipe["blocks"]>;

const hero = (version: string | null): Blocks[number] => ({
  t: "hero",
  v: "center",
  eyebrow: `Windows 10 / 11 · macOS 11+（Apple 芯片）${version ? ` · 当前版本 v${version}` : ""}`,
  title: "每个程序，走自己的网络。",
  sub: "浏览器走代理、微信直连、某个工具单独走一条线路 —— 在一张列表里设好，马上生效。节点、规则和配置都保存在你自己的电脑上。",
  cta: LABEL.download,
  cta2: LABEL.tour,
  trust: ["新用户免费试用 3 天", "Windows 单个 exe，不用安装", "Mac 版同步更新", "更新包签名校验"],
});

const EXTRAS: Blocks[number] = {
  t: "features",
  eyebrow: "更多",
  title: "细节也替你想好了",
  items: [
    [
      "🧭",
      "指纹浏览器端口代理",
      "一次开多个 SOCKS5 / HTTP 端口，每个端口一条独立线路、单独选节点；指纹浏览器每个窗口填一个端口就行，和按程序分流同时用。",
    ],
    [
      "🖥️",
      "看得见每台设备",
      "局域网里谁连上了哪个端口一目了然：选中端口，设备、连接、流量和访问记录直接显示在表格下面；每个端口单独开关、单独切规则 / 全局 / 直连。",
    ],
    [
      "🔗",
      "前置代理",
      "节点可以先经过另一个节点再连出去（链式代理），只能从特定出口访问的节点也能用；导入支持 WireGuard 链接和整份 .conf。",
    ],
    [
      "🗂️",
      "订阅更好管",
      "订阅可只保留或去掉名字含某些字的节点（比如只要香港），可自定义 User-Agent 和自动更新间隔；XHTTP、mKCP 这类节点装好就能用，不用另外下载组件。",
    ],
    ["📝", "更新说明", "每次自动升级完成后，打开软件先告诉你这次更新了什么，不用去翻公告。"],
    ["📚", "规则库", "国内网站、国内 IP 直连，广告域名直接拦截；规则库每天从国内服务器自动同步，不用开代理。"],
    ["📦", "配置随身带", "应用规则能导出成一段文本，换了电脑粘贴导入就行；整份配置也能备份和恢复。"],
    ["🔐", "放心升级", "新版本要同时通过签名和 SHA256 校验才会安装；装完自动重启，代理自动恢复。"],
  ],
};

const STEPS: Blocks[number] = {
  t: "steps",
  title: "四步用起来",
  items: [
    ["下载并打开", "Windows 是单个 exe，双击就能用；Mac 解压后拖进「应用程序」。第一次打开注册账号，领 3 天试用。"],
    ["导入你的节点", "粘贴分享链接或订阅地址；软件本身不提供节点。"],
    ["挑要分流的程序", "在「应用分流」里加入程序，给每个程序选好走法。"],
    ["一键连接", "点概览中间的大开关；每个程序走哪条线路、延迟多少，一眼就能看到。"],
  ],
};

// 合规声明：三段原文保留，不改措辞
const NOTICE: Blocks[number] = {
  t: "features",
  id: "notice",
  title: "使用须知",
  items: [
    ["💻", "只管本机流量", "ProxySplit 只提供本地的应用流量管理、网络技术学习和软件调试能力。"],
    [
      "🚫",
      "不提供网络服务",
      "我们不提供任何翻墙、VPN、代理节点、订阅或网络线路服务，也不对第三方网络资源的可用性或合法性作任何承诺。",
    ],
    [
      "⚖️",
      "遵守法律法规",
      "请严格遵守中华人民共和国法律法规，只在合法、获得授权的网络环境中使用，不得用于任何违法违规活动。",
    ],
  ],
};

const FAQ: Blocks[number] = {
  t: "faq",
  id: "faq",
  title: "常见问题",
  items: [
    [
      "ProxySplit 是 VPN 吗？",
      "不是。它不提供 VPN、代理节点、订阅或跨境网络服务，只负责在你的电脑上决定每个程序的流量怎么走。",
    ],
    [
      "会上传我的节点和规则吗？",
      "不会。节点、订阅、应用规则和配置都保存在本机。会员服务只处理账号、设备摘要和授权状态。",
    ],
    [
      "为什么每次打开都会检查更新？",
      "为了让每个人都用上修好问题的版本。发现新版本会自动下载、校验后安装，通常一分钟内完成，正在用的代理会自动恢复。",
    ],
    [
      "支持哪些系统？",
      "64 位 Windows 10 / 11（单个 exe），以及 macOS 11 以上的 Apple 芯片 Mac。两个版本功能相同、版本号同步，配置都保存在当前用户目录下。",
    ],
    [
      "Mac 版第一次打开要注意什么？",
      "第一次打开请在「应用程序」里右键 ProxySplit → 打开；首次连接会请求一次电脑密码，用来接管网络和设置系统代理。",
    ],
    ["一个账号能在几台电脑上用？", "普通会员 3 台，超级会员 8 台。换电脑时在软件的「账号与设备」里解绑旧的就行。"],
  ],
};

/** 整页配方。version：接口拿到的最新版本号（拿不到为 null）；dark：深色版（?theme=dark，给评审看） */
export function siteRecipe(version: string | null, dark = false): SiteRecipe {
  return {
    version: 1,
    industry: "saas",
    // 和桌面客户端同一套主色：浅色近黑墨色，深色单独用 #6b7584（近黑在深色下看不见）
    brand: dark ? "#6b7584" : "#1c1f24",
    designLanguage: "clean-modern",
    // 「沉静」配方，首屏背景换成渐变百叶（WebGL，按需加载、离屏 / 减少动效时自动停）；其余仍是模糊聚焦标题 + 淡入
    motionRecipe: "calm",
    motionSlots: { bg: "gradient-blinds", title: "blur", enter: "fade", card: "glare", click: "magnet", count: true },
    intensity: "normal",
    dark: dark ? "dark" : "light",
    site: SITE,
    blocks: [
      hero(version),
      { t: "slot", id: "preview" },
      { t: "logos", label: `支持 ${PROTOCOLS.length} 种节点协议`, names: PROTOCOLS },
      { t: "slot", id: "features" },
      EXTRAS,
      STEPS,
      { t: "slot", id: "pricing" },
      NOTICE,
      FAQ,
      { t: "slot", id: "download" },
    ],
  };
}
