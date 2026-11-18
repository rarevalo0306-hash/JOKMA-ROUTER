import asyncio
import json

import httpx

from app.adapters.base import AdapterError


async def fetch_model_names(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    timeout: float,
    *,
    list_field: str = "data",
    name_field: str = "id",
    anthropic_pages: bool = False,
) -> list[str]:
    names: set[str] = set()
    cursors: set[str] = set()
    params = {"limit": "1000"} if anthropic_pages else {}
    try:
        async with asyncio.timeout(min(timeout, 15)):
            while True:
                async with client.stream("GET", url, headers=headers, params=params) as response:
                    if response.status_code != 200:
                        raise AdapterError(502, f"El proveedor respondió con HTTP {response.status_code}", False)
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(content) + len(chunk) > 8 * 1024 * 1024:
                            raise AdapterError(502, "El catálogo del proveedor excede el tamaño admitido", False)
                        content.extend(chunk)
                page = json.loads(content)
                rows = page.get(list_field) if isinstance(page, dict) else None
                if not isinstance(rows, list):
                    raise ValueError("missing model list")
                for row in rows:
                    name = row.get(name_field) if isinstance(row, dict) else None
                    if not isinstance(name, str) or not name.strip():
                        raise ValueError("missing model identifier")
                    names.add(name)
                if not anthropic_pages or not page.get("has_more"):
                    return sorted(names)
                cursor = page.get("last_id")
                if not isinstance(cursor, str) or not cursor or cursor in cursors or len(cursors) >= 10:
                    raise ValueError("invalid model catalog pagination")
                cursors.add(cursor)
                params["after_id"] = cursor
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise AdapterError(504, "El proveedor tardó demasiado en devolver sus modelos", False) from exc
    except (httpx.RequestError, httpx.InvalidURL) as exc:
        raise AdapterError(502, "No se pudo conectar con el proveedor", False) from exc
    except (ValueError, RecursionError) as exc:
        raise AdapterError(502, "El proveedor devolvió un catálogo inválido", False) from exc
