-- Current chat models the OpenAI and Anthropic adapters can call.
-- Public id is providers.name || '/' || models.name.
-- Prices are rough public list rates per million tokens (short context).
-- Dated snapshots are omitted. Retired Claude Opus 4.1 is omitted because
-- the Claude API no longer accepts it. Safe to run more than once.

insert into models (id, provider_id, name, enabled)
select seed.id, providers.id, seed.name, true
from (
    values
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001'::uuid, 'openai', 'gpt-6-astra'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002'::uuid, 'openai', 'gpt-6.1-sol'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003'::uuid, 'openai', 'gpt-6.1-terra'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb004'::uuid, 'openai', 'gpt-6-luna'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb005'::uuid, 'openai', 'gpt-4.1'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb006'::uuid, 'openai', 'o3'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb011'::uuid, 'anthropic', 'claude-fable-5-1'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb012'::uuid, 'anthropic', 'claude-opus-5-5'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb013'::uuid, 'anthropic', 'claude-sonnet-5-5'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb014'::uuid, 'anthropic', 'claude-haiku-5-5'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb015'::uuid, 'anthropic', 'claude-sonnet-4-5')
) as seed (id, provider_name, name)
join providers on providers.name = seed.provider_name
on conflict (provider_id, name) do update
set enabled = true,
    updated_at = now();

update models
set enabled = true,
    updated_at = now()
where name = 'gpt-4o'
  and provider_id = (select id from providers where name = 'openai');

insert into model_prices (model_id, input_per_million, output_per_million)
select models.id, seed.input_per_million, seed.output_per_million
from (
    values
        ('openai', 'gpt-6-astra', 10::numeric, 50::numeric),
        ('openai', 'gpt-6.1-sol', 2, 10),
        ('openai', 'gpt-6.1-terra', 1, 5),
        ('openai', 'gpt-6-luna', 0.10, 0.50),
        ('openai', 'gpt-4.1', 2, 8),
        ('openai', 'o3', 2, 8),
        ('openai', 'gpt-4o', 2.50, 10),
        ('anthropic', 'claude-fable-5-1', 10, 50),
        ('anthropic', 'claude-opus-5-5', 4, 20),
        ('anthropic', 'claude-sonnet-5-5', 2, 10),
        ('anthropic', 'claude-haiku-5-5', 0.10, 0.50),
        ('anthropic', 'claude-sonnet-4-5', 3, 15)
) as seed (provider_name, model_name, input_per_million, output_per_million)
join providers on providers.name = seed.provider_name
join models on models.provider_id = providers.id and models.name = seed.model_name
on conflict (model_id) do update
set input_per_million = excluded.input_per_million,
    output_per_million = excluded.output_per_million,
    updated_at = now();

-- Turn the provider on only when a key is already stored. Do not invent one.
update providers
set enabled = true,
    updated_at = now()
where name in ('openai', 'anthropic')
  and api_key_encrypted is not null
  and length(api_key_encrypted) > 0;
