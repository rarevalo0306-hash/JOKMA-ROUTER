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

Los adaptadores `groq`, `gemini`, `deepseek`, `together` y `vllm` usan el protocolo Chat Completions de OpenAI. Para otros servicios compatibles, elige `openai` y configura la raíz de su API. Para Anthropic y Ollama puedes elegir sus adaptadores nativos. [Conexión de modelos locales y en un VPS](docs/local-and-vps.md)

## Conectar una app con una sola clave

1. En **Proveedores**, guarda la clave de cada servicio que vayas a usar y actívalo. Para Ollama indica la URL que FastAPI puede alcanzar. Pulsa **Probar conexión**.
2. En **Modelos**, selecciona el proveedor y uno de sus modelos disponibles o escribe el ID exacto. Activa el modelo. Puedes darle un alias como `asistente` y asignarle otro modelo como respaldo. Para mover `asistente`, escribe ese alias en el modelo de destino y confirma **Mover alias y guardar**. La app seguirá enviando el mismo nombre.
3. En **Claves**, crea una clave para tu app. Puedes darle acceso a todos los modelos o elegir un menú con modelos de varios proveedores, incluidos los locales. Guarda la clave en `JOKMA_API_KEY`. Después puedes editar su menú en **Claves** y seguir usando el mismo valor en tu app. Las claves anteriores conservan el acceso a todos los modelos habilitados hasta que les asignes una selección.
4. Copia la URL base de **Conectar mi app** a `JOKMA_BASE_URL`. Por defecto es la dirección del panel con `/v1`. Si publicas FastAPI en otro dominio, puedes fijar la URL que muestra el panel con `PUBLIC_API_BASE_URL`, incluido `/v1`.
5. Instala el paquete Python `openai` en la app y usa su cliente habitual.

Con un menú personalizado, `GET /v1/models` devuelve una entrada `proveedor/modelo` por cada modelo seleccionado y habilitado cuyo proveedor de chat esté activo. Para el chat puedes enviar ese ID o su alias. Por ejemplo, para usar `asistente` con un modelo local como respaldo, incluye en el menú tanto el modelo al que apunta el alias como el modelo local. Ante un fallo que admite reintento, el router usa el primer respaldo habilitado que también permita la clave.

```python
import os
from openai import OpenAI

router = OpenAI(
    api_key=os.environ["JOKMA_API_KEY"],
    base_url=os.environ["JOKMA_BASE_URL"],
)
print([model.id for model in router.models.list().data])
reply = router.chat.completions.create(
    model="asistente",
    messages=[{"role": "user", "content": "Hola"}],
)
print(reply.choices[0].message.content)
```

### Capacidades de chat

| Solicitud del cliente | Servicio compatible con OpenAI | Anthropic | Ollama |
| --- | --- | --- | --- |
| Texto y streaming | Chat Completions | Messages | `/api/chat` |
| Imagen en un mensaje | Según el proveedor | URL o imagen en base64 | Imagen en base64 (`data:image/…;base64,…`) |
| Herramientas de tipo función | Llamadas y resultados | Llamadas y resultados | Llamadas y resultados con modelos compatibles |
| Salida estructurada | `response_format` según el modelo | `json_schema` | `json_object` o `json_schema` |

Cuando el modelo devuelve `tool_calls`, tu app ejecuta la función y envía el resultado en un mensaje con `role="tool"` y su `tool_call_id`. El router conserva los argumentos y los identificadores también en streaming. Los límites los marca cada modelo. Por ejemplo, el adaptador nativo de Ollama admite la selección automática de herramientas y devuelve un error si se le exige una función específica. La API pública de JOKMA cubre el catálogo y Chat Completions con una respuesta por solicitud.

## Arranque con Docker

La contraseña `jokma` de Postgres en `docker-compose.yml` es solo la base local. No pongas claves de proveedores en el repo.

```bash
cp .env.example .env
# Rellena ROUTER_SECRET_KEY y ADMIN_API_KEY. Para el panel, configura AUTH_SECRET,
# AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET y PANEL_ALLOWED_EMAILS. Registra en Google
# la URL de retorno de desarrollo http://localhost:3000/api/auth/callback/google.
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
cd backend && pip install -r requirements-dev.txt
# Incluye la prueba de migraciones con la base local de Docker Compose.
TEST_POSTGRES_DSN=postgresql://jokma:jokma@127.0.0.1:5432/postgres pytest
```

## Decisiones

- **Hash de claves internas.** SHA-256 hex, no bcrypt. La clave es un token aleatorio de alta entropía, y el hash permite buscarla en un índice. El texto plano no se guarda.
- **Secretos de proveedor.** Fernet (AES-128-CBC + HMAC). Hace falta `ROUTER_SECRET_KEY`. El cifrado de disco de Supabase es una capa extra, no sustituye esta columna.
- **Tokens.** Si el proveedor manda `usage`, se usa tal cual. Si no, se estima con unos 4 caracteres por token. No es un tokenizador.
- **Costo.** `(entrada * precio_entrada + salida * precio_salida) / 1_000_000`, con la fila de `model_prices` del modelo que respondió. Los precios de ejemplo del SQL son orientativos y se editan en el catálogo.
- **Latencia.** Milisegundos hasta que termina el stream, no el tiempo hasta el primer token.
- **Respaldo.** Solo el primer modelo habilitado de la lista, y solo si el primario falla antes de abrir un 200. Un error de solicitud, como un 400, vuelve al cliente.
- **Admin.** `Authorization: Bearer` con `ADMIN_API_KEY`. El navegador llama a `/api/admin` de Next, que añade la clave en el servidor. No va en `NEXT_PUBLIC_`.
- **Panel.** `https://router.jokma.app` pide sesión. El inicio es Google OAuth (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`) y solo entran los correos de `PANEL_ALLOWED_EMAILS`. Si esa variable no existe, entra únicamente `rarevalo0306@gmail.com`. La URI de redirección en Google Cloud es `https://router.jokma.app/api/auth/callback/google`. Las claves `ak_…` del gateway no cambian.
