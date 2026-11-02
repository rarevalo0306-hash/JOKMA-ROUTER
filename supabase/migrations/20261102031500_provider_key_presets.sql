-- Preset providers for the Proveedores cards.
-- Chat rows are enabled and wait for a key. Video rows are stored so the
-- panel can show them, and they stay out of chat routing.
-- Existing OpenAI and Anthropic rows only gain a key URL and a label.
-- api_key_encrypted is never written here. Safe to run more than once.

alter table providers add column if not exists key_url text;
alter table providers add column if not exists label text;
alter table providers add column if not exists kind text not null default 'chat';

alter table providers drop constraint if exists providers_kind_check;
alter table providers add constraint providers_kind_check
    check (kind in ('chat', 'video'));

alter table providers drop constraint if exists providers_key_url_check;
alter table providers add constraint providers_key_url_check
    check (key_url is null or key_url ~ '^https://');

alter table providers drop constraint if exists providers_adapter_check;
alter table providers add constraint providers_adapter_check check (
    adapter in (
        'openai', 'anthropic', 'ollama',
        'groq', 'gemini', 'deepseek', 'together', 'vllm', 'video'
    )
);

update providers
set key_url = 'https://platform.openai.com/api-keys',
    label = 'OpenAI',
    updated_at = now()
where name = 'openai';

update providers
set key_url = 'https://console.anthropic.com/settings/keys',
    label = 'Anthropic',
    updated_at = now()
where name = 'anthropic';

insert into providers (id, name, adapter, base_url, key_url, label, kind, enabled)
values
    (
        '44444444-4444-4444-8444-444444444401',
        'gemini',
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/openai',
        'https://aistudio.google.com/apikey',
        'Google Gemini',
        'chat',
        true
    ),
    (
        '44444444-4444-4444-8444-444444444402',
        'groq',
        'openai',
        'https://api.groq.com/openai/v1',
        'https://console.groq.com/keys',
        'Groq',
        'chat',
        true
    ),
    (
        '44444444-4444-4444-8444-444444444403',
        'deepseek',
        'openai',
        'https://api.deepseek.com/v1',
        'https://platform.deepseek.com/api_keys',
        'DeepSeek',
        'chat',
        true
    ),
    (
        '44444444-4444-4444-8444-444444444404',
        'together',
        'openai',
        'https://api.together.xyz/v1',
        'https://api.together.ai/settings/api-keys',
        'Together',
        'chat',
        true
    ),
    (
        '44444444-4444-4444-8444-444444444405',
        'mistral',
        'openai',
        'https://api.mistral.ai/v1',
        'https://console.mistral.ai/api-keys',
        'Mistral (Codestral)',
        'chat',
        true
    ),
    (
        '44444444-4444-4444-8444-444444444406',
        'dashscope',
        'openai',
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        'https://modelstudio.console.alibabacloud.com/',
        'DashScope Qwen',
        'chat',
        true
    ),
    (
        '55555555-5555-4555-8555-555555555501',
        'veo',
        'video',
        'https://aistudio.google.com/apikey',
        'https://aistudio.google.com/apikey',
        'Google Veo',
        'video',
        false
    ),
    (
        '55555555-5555-4555-8555-555555555502',
        'sora',
        'video',
        'https://platform.openai.com/api-keys',
        'https://platform.openai.com/api-keys',
        'OpenAI Sora',
        'video',
        false
    ),
    (
        '55555555-5555-4555-8555-555555555503',
        'runway',
        'video',
        'https://dev.runwayml.com/',
        'https://dev.runwayml.com/',
        'Runway',
        'video',
        false
    ),
    (
        '55555555-5555-4555-8555-555555555504',
        'kling',
        'video',
        'https://klingai.com/dev',
        'https://klingai.com/dev',
        'Kling',
        'video',
        false
    ),
    (
        '55555555-5555-4555-8555-555555555505',
        'luma',
        'video',
        'https://lumalabs.ai/dream-machine/api',
        'https://lumalabs.ai/dream-machine/api',
        'Luma',
        'video',
        false
    ),
    (
        '55555555-5555-4555-8555-555555555506',
        'pika',
        'video',
        'https://pika.art/',
        'https://pika.art/',
        'Pika',
        'video',
        false
    ),
    (
        '55555555-5555-4555-8555-555555555507',
        'fal',
        'video',
        'https://fal.ai/dashboard/keys',
        'https://fal.ai/dashboard/keys',
        'Fal',
        'video',
        false
    ),
    (
        '55555555-5555-4555-8555-555555555508',
        'hailuo',
        'video',
        'https://www.minimax.io/',
        'https://www.minimax.io/',
        'MiniMax Hailuo',
        'video',
        false
    )
on conflict (name) do update
set adapter = excluded.adapter,
    base_url = excluded.base_url,
    key_url = excluded.key_url,
    label = excluded.label,
    kind = excluded.kind,
    updated_at = now();
