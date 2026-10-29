-- 公司统一通知 tongzhi（tongzhi-v1.7.0 sql/schema.sql 原样）+ 老公告 announcements 迁入 notice（2026-10-29）。
-- 老表保留只读，下个版本确认无人读后再删；/v1/announcements 改从 notice 派生，老客户端不受影响。

-- tongzhi 建表(PostgreSQL)。幂等,可重复跑。表名可改(store 的 tables 选项),列名不可改。
-- 用户 id 列是 text:bigint 主键的宿主照样用(出入参字符串,PG 自转);要严格类型就把 user_id 改成 bigint,列名别动。
-- 跑法:psql -U postgres -d <db> -f schema.sql;然后把归属交给应用用户(见文件末尾)。

create table if not exists notice (
  id               text primary key,
  kind             text not null default 'system',
  severity         text not null default 'normal',
  surfaces         text[] not null default '{inbox}',
  title            text not null,
  body             text not null default '',
  cover            text,
  icon             text,
  actions          jsonb not null default '[]'::jsonb,
  audience_type    text not null default 'all',
  audience_values  text[] not null default '{}',
  start_at         timestamptz,
  end_at           timestamptz,
  pinned           boolean not null default false,
  sort_order       integer not null default 0,
  frequency        text not null default 'once',
  frequency_hours  integer not null default 24,
  max_popups       integer not null default 1,
  force_read       boolean not null default false,
  closable         boolean not null default true,
  status           text not null default 'draft',
  idem_key         text,
  batch_id         text,
  source           text not null default 'admin',
  created_by       text not null default '',
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz,
  revoked_at       timestamptz,
  constraint notice_kind_chk      check (kind in ('system','maintenance','event','reward','warning')),
  constraint notice_severity_chk  check (severity in ('low','normal','high','critical')),
  constraint notice_status_chk    check (status in ('draft','published','revoked')),
  constraint notice_frequency_chk check (frequency in ('once','daily','every','gap')),
  constraint notice_audience_chk  check (audience_type in ('all','users','tiers','tags','roles'))
);
create unique index if not exists notice_idem_key_uq on notice (idem_key) where idem_key is not null;
-- 玩家 feed 的主路径:published + 窗口;audience_values 的 && 用 GIN
create index if not exists notice_live_idx on notice (status, start_at, end_at) where status = 'published';
create index if not exists notice_audience_gin on notice using gin (audience_values);
create index if not exists notice_surfaces_gin on notice using gin (surfaces);
create index if not exists notice_batch_idx on notice (batch_id) where batch_id is not null;
create index if not exists notice_updated_idx on notice (updated_at desc);
-- 广播分支(all / tiers / tags / roles)只有几十行:部分索引让它不用扫几十万条定向站内信(v1.2.0)
create index if not exists notice_broadcast_idx on notice (status, start_at, end_at) where status = 'published' and audience_type <> 'users';

create table if not exists notice_delivery (
  notice_id  text not null references notice(id) on delete cascade,
  user_id    text not null,
  payload    jsonb,
  created_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);
create index if not exists notice_delivery_user_idx on notice_delivery (user_id, created_at desc);

create table if not exists notice_receipt (
  notice_id       text not null references notice(id) on delete cascade,
  user_id         text not null,
  seen_at         timestamptz,
  read_at         timestamptz,
  archived_at     timestamptz,
  dismissed_until timestamptz,
  popup_count     integer not null default 0,
  last_popup_at   timestamptz,
  primary key (notice_id, user_id)
);
create index if not exists notice_receipt_user_idx on notice_receipt (user_id);

-- 老公告迁入：id 前缀 ann-，idem_key 防重跑；摘要 / 版本号放 meta（/v1/announcements 还要还原成老形状）。
INSERT INTO notice(id,kind,surfaces,title,body,pinned,start_at,end_at,status,idem_key,source,created_by,meta,created_at,updated_at,published_at)
SELECT 'ann-'||a.id::text,
  CASE a.type WHEN 'maintenance' THEN 'maintenance' WHEN 'release' THEN 'event' ELSE 'system' END,
  CASE WHEN a.pinned THEN '{inbox,banner}'::text[] ELSE '{inbox}'::text[] END,
  left(a.title,120), a.content, a.pinned, a.starts_at, a.ends_at,
  CASE WHEN a.active THEN 'published' ELSE 'draft' END,
  'ann:'||a.id::text, 'migrate', coalesce(a.created_by::text,''),
  jsonb_build_object('summary',a.summary,'version',a.version,'legacyType',a.type),
  a.created_at, a.updated_at, CASE WHEN a.active THEN a.published_at END
FROM announcements a
ON CONFLICT DO NOTHING;
