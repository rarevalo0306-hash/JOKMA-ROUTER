# Ollama y vLLM en local, LAN y VPS

La URL base la llama **el proceso de FastAPI**, no el navegador. Registra en Proveedores la dirección que la API puede alcanzar.

No pongas claves, tokens de Cloudflare ni claves de Tailscale en el repositorio. Van en `.env` o en el formulario del panel, que las cifra.

## Ollama

### Solo en esta máquina

```bash
ollama serve
ollama pull llama3.2:3b
```

Por defecto escucha en `127.0.0.1:11434`.

En el panel:

- Nombre: `local`
- Adaptador: `ollama`
- URL base: `http://127.0.0.1:11434`
- Sin clave
- Modelo: `llama3.2:3b` (el nombre que devuelve `ollama list`, sin barra)

El id público queda `local/llama3.2:3b`. Si el nombre del modelo lleva `:`, es válido. No uses `/` dentro del nombre: la barra separa proveedor y modelo.

Si JOKMA corre en Docker y Ollama en el host, la URL suele ser `http://host.docker.internal:11434` (Docker Desktop) o la IP del puente. `127.0.0.1` dentro del contenedor es el propio contenedor.

### En la LAN

```bash
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

Abre el puerto solo hacia la subred local. Ollama no trae autenticación. No lo publiques en el router.

URL base desde el host de JOKMA: `http://192.168.1.20:11434`.

### En un VPS

Deja Ollama en localhost del VPS (`127.0.0.1:11434`). No abras el 11434 a internet.

Tres formas de exponerlo hacia la máquina donde corre JOKMA:

1. **Tailscale (preferible en una red propia).** Instala Tailscale en el VPS y en el host de JOKMA. `tailscale up` en ambos. Usa la IP 100.x o el nombre MagicDNS: `http://ollama-vps:11434`. No hace falta certificado público.
2. **Cloudflare Tunnel.** En el VPS, `cloudflared tunnel` hacia `http://127.0.0.1:11434`. El hostname `https://ollama.ejemplo.com` es la URL base. El túnel nombrado vive en la cuenta de Cloudflare; no copies el token al repo. Ollama sigue sin auth: protege el hostname (Access, o no lo publiques en DNS público).
3. **HTTPS con Caddy o nginx** en el VPS, certificado y, si puedes, un bearer delante. Si el proxy exige `Authorization: Bearer …`, pega ese secreto en el campo de clave del proveedor. El panel lo guarda cifrado con `ROUTER_SECRET_KEY`.

Prueba con **Probar conexión**. Una respuesta correcta lista los modelos de `/api/tags`.

## vLLM

vLLM ya habla el API de OpenAI. El adaptador llamado `vllm` está reservado y no está implementado. Registra el servidor con el adaptador `openai` y una URL que termine en `/v1`.

### Local

```bash
vllm serve meta-llama/Llama-3.2-3B-Instruct --host 127.0.0.1 --port 8001
```

- Nombre: `vps` o `local-vllm`
- Adaptador: `openai`
- URL base: `http://127.0.0.1:8001/v1`
- Modelo: el id que muestra `GET /v1/models`, sin el prefijo del proveedor

### LAN

`--host 0.0.0.0` y firewall de la subred. URL `http://192.168.1.20:8001/v1`.

### VPS

Igual que Ollama: escucha en `127.0.0.1:8001` y llega a JOKMA por Tailscale o por un túnel.

- Tailscale: `http://vllm-vps:8001/v1`
- Cloudflare Tunnel hacia el puerto 8001: `https://vllm.ejemplo.com/v1`
- Caddy con TLS: `https://vllm.ejemplo.com/v1`

La prueba de conexión hace `GET {base}/models`. Tiene que responder 200.

## Registro

1. Panel → Proveedores → guardar y **Probar conexión**.
2. Panel → Modelos → nombre exacto del modelo upstream, alias opcional, precio estimado (0 si es hardware propio).
3. Crea una clave interna y llama `POST /v1/chat/completions` con `model` = `nombre-proveedor/nombre-modelo` o el alias.

Ejemplo de cuerpo, sin secretos reales:

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer ak_…" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/llama3.2:3b","messages":[{"role":"user","content":"hola"}]}'
```
