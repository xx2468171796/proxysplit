-- 账号来源渠道：'' = 自己官网 / 客户端注册；'aigw' = AI 编程官网（中转站）经 POWER云 登录来的客户。
-- 中转站客户由推广员带来，客户端对 aigw 渠道隐藏作者联系方式（QQ 群 / 微信 / 赞赏码 / 官网 / GitHub）。
-- 只会从 '' 变成 'aigw'，不会自动改回。
ALTER TABLE users ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT '';
