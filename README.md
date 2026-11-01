# JOKMA Router

Puerta de enlace privada para los modelos que usan las apps de Ricardo. Un solo endpoint compatible con OpenAI (`/v1/chat/completions`, `/v1/models`) y un panel para proveedores, catálogo, claves y uso.

La API está en `backend/` (FastAPI). El panel está en `web/` (Next.js, textos en español). El esquema vive en `supabase/migrations/` y **no se aplica solo** a ningún proyecto Supabase remoto.

## Qué quedó implementado

- OpenAI, Anthropic y Ollama, con streaming reenviado evento a evento.
- Respaldo: un reintento si el primario agota el tiempo, responde 429 o 5xx, antes de enviar el primer token.
- Claves internas `ak_…` guardadas como SHA-256. Una clave ausente o revocada recibe 401.
- Claves de proveedor cifradas con Fernet (`ROUTER_SECRET_KEY`).
- Registro de uso: modelo pedido, modelo servido, tokens, latencia, estado y costo estimado.
- Panel: proveedores (alta y prueba de conexión), modelos (activar, alias, respaldo, precios), analítica y claves.

Adaptadores reservados, sin implementación propia: `groq`, `gemini`, `deepseek`, `together`, `vllm`. Groq, DeepSeek, Together y vLLM hablan el API de OpenAI: regístralos con el adaptador `openai` y su URL `/v1`. Gemini puede usar su endpoint compatible con OpenAI de la misma forma. Ver [docs/local-and-vps.md](docs/local-and-vps.md) para Ollama y vLLM en localhost, LAN o un VPS (Tailscale, Cloudflare Tunnel o HTTPS).

## Arranque con Docker

La contraseña `jokma` de Postgres en `docker-compose.yml` es solo la base local. No pongas claves de proveedores en el repo.

```bash
cp .env.example .env
# Rellena ROUTER_SECRET_KEY y ADMIN_API_KEY.
# La clave Fernet:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

docker compose up --build
```

- API: http://localhost:8000
- Panel: http://localhost:3000
- Al arrancar, la API aplica el SQL con `python -m app.migrate`.

Solo API y base: `docker compose up postgres api`.

## Arranque sin Docker

Postgres 16 local, luego:

```bash
cp backend/.env.example backend/.env
cp web/.env.example web/.env.local
# Mismo ROUTER_SECRET_KEY, ADMIN_API_KEY y DATABASE_URL en backend/.env.
# En web/.env.local: API_INTERNAL_URL=http://127.0.0.1:8000, el mismo ADMIN_API_KEY,
# AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_URL y PANEL_ALLOWED_EMAILS.

cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m app.migrate
uvicorn app.main:app --reload --port 8000

cd ../web
npm install
npm run dev
```

## Migraciones

Archivo: `supabase/migrations/20261101043500_init_gateway.sql`.

Local, con la URL de `backend/.env`:

```bash
cd backend && python -m app.migrate
```

O con `psql`:

```bash
psql "postgresql://jokma:jokma@localhost:5432/jokma" \
  -f supabase/migrations/20261101043500_init_gateway.sql
```

En Supabase, pega el archivo en el SQL editor o usa `supabase db push` **desde un proyecto que sí quieras cambiar**. Este repo no apunta a un proyecto remoto y no ejecuta la migración allí.

RLS está activo en todas las tablas, sin políticas para `anon` ni `authenticated`. La API entra como dueño de las tablas (local) o con la conexión `postgres` / service role (Supabase), que no pasa por el Data API. El panel no habla con Supabase: habla con FastAPI.

El runner anota los archivos en `jokma_schema_migrations` para no repetirlos. El SQL también es reaplicable (`if not exists`, `on conflict do nothing`).

## Probar el gateway

Crea un proveedor y un modelo en el panel, luego una clave. Con la clave `ak_…` que se muestra una vez:

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer ak_…" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"hola"}]}'
```

`GET /v1/models` usa la misma clave. La cabecera `X-Jokma-Model-Served` dice qué ruta respondió. `X-Jokma-Fallback: true` si entró el respaldo.

Tests (sin claves reales; OpenAI, Anthropic y Ollama van por mocks de httpx y respx):

```bash
cd backend && pip install -r requirements-dev.txt && pytest
```

## Decisiones

- **Hash de claves internas.** SHA-256 hex, no bcrypt. La clave es un token aleatorio de alta entropía, y el hash permite buscarla en un índice. El texto plano no se guarda.
- **Secretos de proveedor.** Fernet (AES-128-CBC + HMAC). Hace falta `ROUTER_SECRET_KEY`. El cifrado de disco de Supabase es una capa extra, no sustituye esta columna.
- **Tokens.** Si el proveedor manda `usage`, se usa tal cual. Si no, se estima con unos 4 caracteres por token. No es un tokenizador.
- **Costo.** `(entrada * precio_entrada + salida * precio_salida) / 1_000_000`, con la fila de `model_prices` del modelo que respondió. Los precios de ejemplo del SQL son orientativos y se editan en el catálogo.
- **Latencia.** Milisegundos hasta que termina el stream, no el tiempo hasta el primer token.
- **Respaldo.** Solo el primer modelo habilitado de la lista, y solo si el primario falla antes de abrir un 200. Un 400 no reintenta. Un adaptador sin implementar (501) tampoco.
- **Admin.** `Authorization: Bearer` con `ADMIN_API_KEY`. El navegador llama a `/api/admin` de Next, que añade la clave en el servidor. No va en `NEXT_PUBLIC_`.
- **Panel.** `https://router.jokma.app` pide sesión. El inicio es Google OAuth (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`) y solo entran los correos de `PANEL_ALLOWED_EMAILS`. Si esa variable no existe, entra únicamente `rarevalo0306@gmail.com`. La URI de redirección en Google Cloud es `https://router.jokma.app/api/auth/callback/google`. Las claves `ak_…` del gateway no cambian.
