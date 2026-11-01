-- JOKMA Router schema.
-- Local:  python -m app.migrate   (from backend/, DATABASE_URL set)
--         psql "$DATABASE_URL" -f supabase/migrations/20261101043500_init_gateway.sql
-- Supabase: paste this file in the SQL editor, or `supabase db push` from a
-- linked project you intend to change. This repository does not apply it for you.
--
-- Secrets: providers.api_key_encrypted is Fernet ciphertext (ROUTER_SECRET_KEY).
-- api_keys.key_hash is SHA-256 of the ak_… token. Raw provider keys and raw
-- internal keys are never stored. Supabase disk encryption is a second layer.

create extension if not exists pgcrypto;

create table if not exists providers (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    adapter text not null,
    base_url text not null,
    api_key_encrypted text,
    api_key_last4 text,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint providers_name_check check (name ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
    constraint providers_adapter_check check (
        adapter in (
            'openai', 'anthropic', 'ollama',
            'groq', 'gemini', 'deepseek', 'together', 'vllm'
        )
    ),
    constraint providers_base_url_check check (base_url ~ '^https?://')
);

comment on column providers.api_key_encrypted is
    'Fernet token (AES-128-CBC + HMAC-SHA256) created with ROUTER_SECRET_KEY. NULL when the provider has no secret, which is normal for Ollama. Plaintext is never written. Disk encryption is additional at-rest protection, not a replacement.';

create table if not exists models (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references providers (id) on delete cascade,
    name text not null,
    alias text,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint models_provider_name_unique unique (provider_id, name),
    constraint models_alias_unique unique (alias),
    constraint models_name_check check (
        char_length(name) between 1 and 128 and position('/' in name) = 0
    )
);

comment on column models.alias is
    'Optional client-facing id without a slash. Requests may use the alias or provider/model.';

comment on table models is
    'Public model id is provider.name || ''/'' || models.name (for example openai/gpt-4o).';

create table if not exists model_fallbacks (
    model_id uuid not null references models (id) on delete cascade,
    fallback_model_id uuid not null references models (id) on delete cascade,
    position smallint not null,
    primary key (model_id, position),
    constraint model_fallbacks_unique_target unique (model_id, fallback_model_id),
    constraint model_fallbacks_no_self check (model_id <> fallback_model_id),
    constraint model_fallbacks_position_check check (position >= 0)
);

comment on table model_fallbacks is
    'Ordered fallback list. The gateway retries only the first enabled entry after a timeout, HTTP 429, or HTTP 5xx, and only before any token is sent to the client.';

create table if not exists model_prices (
    model_id uuid primary key references models (id) on delete cascade,
    currency text not null default 'USD',
    input_per_million numeric(14, 6) not null default 0,
    output_per_million numeric(14, 6) not null default 0,
    updated_at timestamptz not null default now(),
    constraint model_prices_nonnegative check (
        input_per_million >= 0 and output_per_million >= 0
    )
);

comment on table model_prices is
    'Editable estimate table, not an invoice. cost = (prompt_tokens * input_per_million + completion_tokens * output_per_million) / 1000000.';

create table if not exists api_keys (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    app_name text not null,
    key_prefix text not null,
    key_hash text not null unique,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz not null default now(),
    constraint api_keys_hash_len check (char_length(key_hash) = 64)
);

comment on column api_keys.key_hash is
    'Hex SHA-256 of the full ak_ token. High-entropy random keys are looked up by hash. The raw token is returned once at creation and is not stored.';

create table if not exists usage_logs (
    id uuid primary key default gen_random_uuid(),
    api_key_id uuid references api_keys (id) on delete set null,
    app_name text not null,
    model_requested text not null,
    model_served text,
    prompt_tokens integer not null default 0,
    completion_tokens integer not null default 0,
    latency_ms integer not null default 0,
    status text not null,
    http_status integer,
    estimated_cost numeric(16, 8) not null default 0,
    error_message text,
    route_trace jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    constraint usage_logs_status_check check (status in ('success', 'fallback', 'error')),
    constraint usage_logs_tokens_check check (prompt_tokens >= 0 and completion_tokens >= 0),
    constraint usage_logs_latency_check check (latency_ms >= 0)
);

create index if not exists ix_usage_logs_app_created
    on usage_logs (app_name, created_at desc);

create index if not exists ix_usage_logs_key_created
    on usage_logs (api_key_id, created_at desc);

create index if not exists ix_usage_logs_model_served_created
    on usage_logs (model_served, created_at desc);

create index if not exists ix_usage_logs_model_requested_created
    on usage_logs (model_requested, created_at desc);

create index if not exists ix_usage_logs_created
    on usage_logs (created_at desc);

create index if not exists ix_models_provider on models (provider_id);
create index if not exists ix_model_fallbacks_target on model_fallbacks (fallback_model_id);
create index if not exists ix_api_keys_app on api_keys (app_name);

-- Data API lockdown. The FastAPI role is the table owner locally, or the
-- Supabase postgres / service_role connection. Those bypass RLS. anon and
-- authenticated get no policies, so they cannot read keys or usage.
-- FORCE ROW LEVEL SECURITY is intentionally not set: it would also block the owner.

alter table providers enable row level security;
alter table models enable row level security;
alter table model_fallbacks enable row level security;
alter table model_prices enable row level security;
alter table api_keys enable row level security;
alter table usage_logs enable row level security;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all privileges on table
            providers, models, model_fallbacks, model_prices, api_keys, usage_logs
            from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all privileges on table
            providers, models, model_fallbacks, model_prices, api_keys, usage_logs
            from authenticated;
    end if;
end
$$;

-- Sample catalog. No secrets. Cloud rows start disabled until a key is saved.
-- Prices are rough public-list estimates and should be edited.

insert into providers (id, name, adapter, base_url, enabled) values
    ('11111111-1111-4111-8111-111111111111', 'openai', 'openai', 'https://api.openai.com/v1', false),
    ('22222222-2222-4222-8222-222222222222', 'anthropic', 'anthropic', 'https://api.anthropic.com', false),
    ('33333333-3333-4333-8333-333333333333', 'local', 'ollama', 'http://127.0.0.1:11434', true)
on conflict (name) do nothing;

insert into models (id, provider_id, name, alias, enabled) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'gpt-4o', 'smart', false),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111', 'gpt-4o-mini', 'fast', false),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '22222222-2222-4222-8222-222222222222', 'claude-3-5-sonnet', null, false),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '33333333-3333-4333-8333-333333333333', 'llama3.2-3b', 'local-llama', true)
on conflict do nothing;

insert into model_fallbacks (model_id, fallback_model_id, position) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 0)
on conflict do nothing;

insert into model_prices (model_id, input_per_million, output_per_million) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 2.5, 10),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 0.15, 0.6),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 3, 15),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 0, 0)
on conflict (model_id) do nothing;
