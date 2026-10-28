-- 同事节点上报（docs/节点上报.md）：每台设备当前的全部节点 / 订阅，按设备整份替换。
-- device_id 与 client_devices.device_id 相同。link_enc / url_enc 为 AES-256-GCM（env NODE_LINK_KEY），
-- 格式 base64(iv12 | tag16 | 密文)；没配密钥时为 NULL。*_hash = sha256 十六进制（跨设备找同一节点）。
-- client_node_changes 保留 90 天，由 API 进程定时清理。

CREATE TABLE IF NOT EXISTS client_nodes (
  device_id    text NOT NULL,
  node_id      text NOT NULL,
  account_id   uuid,                 -- 令牌核实过的账号（users.id）
  name         text NOT NULL DEFAULT '',
  type         text NOT NULL DEFAULT '',
  server       text NOT NULL DEFAULT '',
  port         integer NOT NULL DEFAULT 0,
  network      text NOT NULL DEFAULT '',
  security     text NOT NULL DEFAULT '',
  sni          text NOT NULL DEFAULT '',
  core         text NOT NULL DEFAULT '',
  via          text NOT NULL DEFAULT '',
  sub_id       text NOT NULL DEFAULT '',
  official     boolean NOT NULL DEFAULT false,
  source       text NOT NULL DEFAULT '',
  latency      integer NOT NULL DEFAULT 0,
  tcp_latency  integer NOT NULL DEFAULT 0,
  speed        double precision NOT NULL DEFAULT 0,
  link_enc     text,
  link_hash    text NOT NULL DEFAULT '',
  selected     boolean NOT NULL DEFAULT false,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,
  PRIMARY KEY (device_id, node_id)
);
CREATE INDEX IF NOT EXISTS client_nodes_last_seen_idx ON client_nodes (last_seen DESC);
CREATE INDEX IF NOT EXISTS client_nodes_alive_idx ON client_nodes (server, port) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS client_nodes_type_idx ON client_nodes (type) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS client_nodes_account_idx ON client_nodes (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_nodes_link_hash_idx ON client_nodes (link_hash) WHERE link_hash <> '';

CREATE TABLE IF NOT EXISTS client_subs (
  device_id    text NOT NULL,
  sub_id       text NOT NULL,
  account_id   uuid,
  name         text NOT NULL DEFAULT '',
  host         text NOT NULL DEFAULT '',
  url_enc      text,
  url_hash     text NOT NULL DEFAULT '',
  node_count   integer NOT NULL DEFAULT 0,
  auto_update  boolean NOT NULL DEFAULT false,
  last_update  timestamptz,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,
  PRIMARY KEY (device_id, sub_id)
);
CREATE INDEX IF NOT EXISTS client_subs_last_seen_idx ON client_subs (last_seen DESC);
CREATE INDEX IF NOT EXISTS client_subs_url_hash_idx ON client_subs (url_hash) WHERE url_hash <> '';

CREATE TABLE IF NOT EXISTS client_node_changes (
  id          bigserial PRIMARY KEY,
  device_id   text NOT NULL,
  account_id  uuid,
  kind        text NOT NULL,          -- node | sub
  item_id     text NOT NULL,
  name        text NOT NULL DEFAULT '',
  action      text NOT NULL,          -- add | remove | update
  fields      text[] NOT NULL DEFAULT '{}', -- update 时变了的字段名
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_node_changes_at_idx ON client_node_changes (at DESC);
CREATE INDEX IF NOT EXISTS client_node_changes_device_idx ON client_node_changes (device_id, at DESC);
