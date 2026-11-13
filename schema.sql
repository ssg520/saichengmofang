-- 赛程魔方 · 单表 jsonb 文档 + version 列
-- 平台无事务：单行 UPDATE 天然原子，WHERE version=base 即 CAS。
-- 受限 SQL 子集：仅 CREATE TABLE / CREATE INDEX，无 CHECK/触发器，校验全在 Function。
CREATE TABLE app.tournaments (
  id uuid PRIMARY KEY,
  share_id text NOT NULL UNIQUE,
  edit_token_hash text NOT NULL,
  owner_id text,
  title text NOT NULL,
  data jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tournaments_owner_created_at_idx ON app.tournaments (owner_id, created_at);