-- ---------------------------------------------------------------------------
-- NWP-Core :: core schema
-- ---------------------------------------------------------------------------

create type user_role      as enum ('user', 'admin');
create type account_status as enum ('active', 'suspended');
create type model_status   as enum ('candidate', 'active', 'archived');

-- --------------------------------------------------------------- profiles --
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  email         text,
  display_name  text,
  avatar_seed   text,
  role          user_role      not null default 'user',
  status        account_status not null default 'active',
  -- per-user inference preferences, read by the workspace on load
  prefs         jsonb not null default
                  '{"temperature":0.8,"top_k":5,"ghost_text":true,"telemetry":true,"theme":"instrument"}'::jsonb,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

-- ------------------------------------------------------- model registry ----
create table public.models (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  version              text not null,
  quantization         text not null default 'int8',   -- fp32 | fp16 | int8
  architecture         jsonb not null default '{}'::jsonb,
  params_total         bigint,
  params_non_embedding bigint,
  vocab_size           integer,
  context_length       integer,
  train_tokens         bigint,
  val_loss             numeric(10,5),
  perplexity           numeric(10,3),
  top1                 numeric(6,5),
  top3                 numeric(6,5),
  top5                 numeric(6,5),
  artifact_path        text,        -- public path the browser fetches
  size_bytes           bigint,
  status               model_status not null default 'candidate',
  traffic_pct          integer not null default 0 check (traffic_pct between 0 and 100),
  notes                text,
  created_at           timestamptz not null default now(),
  unique (name, version, quantization)
);

-- ------------------------------------------------------- training runs -----
create table public.training_runs (
  id               uuid primary key default gen_random_uuid(),
  run_name         text unique not null,
  config           jsonb not null default '{}'::jsonb,
  corpus           jsonb not null default '{}'::jsonb,
  device           text,
  status           text not null default 'running',   -- running | complete | failed
  started_at       timestamptz,
  finished_at      timestamptz,
  total_steps      integer,
  tokens_seen      bigint,
  best_val_loss    numeric(10,5),
  best_perplexity  numeric(10,3),
  created_at       timestamptz not null default now()
);

create table public.training_metrics (
  id              bigserial primary key,
  run_id          uuid not null references public.training_runs on delete cascade,
  kind            text not null,          -- 'train' | 'eval'
  step            integer not null,
  tokens          bigint,
  loss            numeric(10,5),
  ema_loss        numeric(10,5),
  perplexity      numeric(12,3),
  lr              numeric(12,10),
  grad_norm       numeric(10,4),
  tokens_per_sec  integer,
  top1            numeric(6,5),
  top3            numeric(6,5),
  top5            numeric(6,5),
  elapsed_s       integer
);
create index on public.training_metrics (run_id, kind, step);

-- ---------------------------------------------------------- documents ------
create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null default 'Untitled',
  content     text not null default '',
  word_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.documents (user_id, updated_at desc);

-- ------------------------------------------------- prediction telemetry ----
-- One row per suggestion surfaced. This is the source of truth for every
-- number on the user dashboard and the admin analytics pages.
create table public.prediction_events (
  id             bigserial primary key,
  user_id        uuid references auth.users on delete cascade,
  document_id    uuid references public.documents on delete set null,
  model_id       uuid references public.models on delete set null,
  latency_ms     numeric(10,3),
  context_tokens integer,
  top1_token     text,
  top1_prob      numeric(6,5),
  entropy        numeric(8,5),
  accepted       boolean not null default false,
  accepted_rank  integer,               -- 1..k when accepted, else null
  chars_saved    integer not null default 0,
  source         text not null default 'browser',   -- browser | api
  created_at     timestamptz not null default now()
);
create index on public.prediction_events (user_id, created_at desc);
create index on public.prediction_events (created_at desc);
create index on public.prediction_events (model_id, accepted);

-- ------------------------------------------------------------ api keys -----
create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  name          text not null default 'default',
  key_prefix    text not null,      -- shown in UI, e.g. nwp_live_a1b2
  key_hash      text not null,      -- sha256 of the full key; raw key never stored
  request_count bigint not null default 0,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.api_keys (user_id);
create unique index on public.api_keys (key_hash);

-- ------------------------------------------------------ feature flags ------
create table public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  rollout_pct integer not null default 0 check (rollout_pct between 0 and 100),
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users on delete set null
);

-- ---------------------------------------------------------- audit log ------
create table public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references auth.users on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_log (created_at desc);
