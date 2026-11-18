alter table api_keys add column if not exists restrict_models boolean not null default false;

create table if not exists api_key_models (
    api_key_id uuid not null references api_keys (id) on delete cascade,
    model_id uuid not null references models (id) on delete cascade,
    primary key (api_key_id, model_id)
);
create index if not exists ix_api_key_models_model on api_key_models (model_id);

comment on column api_keys.restrict_models is
    'When true, this key can use only the models listed in api_key_models, including an empty selection.';

alter table api_key_models enable row level security;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all privileges on table api_key_models from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all privileges on table api_key_models from authenticated;
    end if;
end
$$;
