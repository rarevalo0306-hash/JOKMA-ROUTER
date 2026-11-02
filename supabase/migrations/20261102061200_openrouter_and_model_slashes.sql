-- OpenRouter preset, plus model names that may contain a slash (author/slug).
-- The public id is still providers.name || '/' || models.name, so the first
-- slash stays the provider. openrouter/openai/gpt-4o stores openai/gpt-4o and
-- that full string is what an OpenAI-compatible adapter sends upstream.
-- Does not write api_key_encrypted. Safe to run more than once.

alter table models drop constraint if exists models_name_check;
alter table models add constraint models_name_check check (
    char_length(name) between 1 and 200
    and name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}(/[A-Za-z0-9][A-Za-z0-9._:-]{0,199})*$'
);

insert into providers (id, name, adapter, base_url, key_url, label, kind, enabled)
values (
    '44444444-4444-4444-8444-444444444407',
    'openrouter',
    'openai',
    'https://openrouter.ai/api/v1',
    'https://openrouter.ai/keys',
    'OpenRouter',
    'chat',
    true
)
on conflict (name) do update
set adapter = excluded.adapter,
    base_url = excluded.base_url,
    key_url = excluded.key_url,
    label = excluded.label,
    kind = excluded.kind,
    updated_at = now();
