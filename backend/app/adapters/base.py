import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

import httpx


@dataclass
class ChatChunk:
    content: str = ""
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass
class AdapterError(Exception):
    status_code: int
    message: str
    retryable: bool

    def __str__(self) -> str:
        return self.message


@dataclass
class OpenedStream:
    response: httpx.Response
    parser: Callable[[httpx.Response], AsyncIterator[ChatChunk]]
    _closed: bool = field(default=False, init=False)

    async def __aiter__(self) -> AsyncIterator[ChatChunk]:
        try:
            async for chunk in self.parser(self.response):
                yield chunk
        finally:
            await self.aclose()

    async def aclose(self) -> None:
        if not self._closed:
            self._closed = True
            await self.response.aclose()


class ProviderAdapter:
    """Extension point for a provider.

    Implemented adapters open the upstream response, and only then yield
    tokens. A timeout, HTTP 429, or HTTP 5xx raised before the first yield is
    retryable so the router can switch to the configured fallback once.
    """

    slug: str
    implemented: bool = True
    summary: str = ""

    async def test_connection(
        self,
        client: httpx.AsyncClient,
        *,
        base_url: str,
        api_key: str | None,
        timeout: float,
    ) -> str:
        raise NotImplementedError

    async def open_chat(
        self,
        client: httpx.AsyncClient,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        messages: list[dict],
        temperature: float | None,
        max_tokens: int | None,
        timeout: float,
    ) -> OpenedStream:
        raise NotImplementedError


def timeout_for(seconds: float) -> httpx.Timeout:
    return httpx.Timeout(connect=10.0, read=seconds, write=30.0, pool=10.0)


def join_url(base: str, *parts: str) -> str:
    url = base.rstrip("/")
    for part in parts:
        url = url + "/" + part.strip("/")
    return url


def upstream_message(status_code: int, body: bytes) -> str:
    text = body.decode("utf-8", errors="replace").strip()
    try:
        payload = json.loads(body) if body else None
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and error.get("message"):
            text = str(error["message"])
        elif isinstance(error, str):
            text = error
        elif payload.get("message"):
            text = str(payload["message"])
    text = " ".join(text.split())
    if not text:
        text = f"upstream status {status_code}"
    return text[:500]


def retryable_status(status_code: int) -> bool:
    return status_code == 429 or 500 <= status_code <= 599


async def send_checked(client: httpx.AsyncClient, request: httpx.Request) -> httpx.Response:
    try:
        response = await client.send(request, stream=True)
    except httpx.TimeoutException as exc:
        raise AdapterError(504, "upstream timeout", True) from exc
    except httpx.TransportError as exc:
        raise AdapterError(502, "upstream connection failed", True) from exc
    if response.status_code != 200:
        raw = await response.aread()
        await response.aclose()
        raise AdapterError(
            response.status_code,
            upstream_message(response.status_code, raw),
            retryable_status(response.status_code),
        )
    return response


async def iter_lines(response: httpx.Response) -> AsyncIterator[str]:
    buffer = ""
    async for chunk in response.aiter_bytes():
        buffer += chunk.decode("utf-8", errors="replace")
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            yield line.rstrip("\r")
    if buffer:
        yield buffer.rstrip("\r")


async def iter_sse_events(response: httpx.Response) -> AsyncIterator[tuple[str | None, str]]:
    """Yield (event name, data payload) without holding the rest of the body."""
    event_name: str | None = None
    data_lines: list[str] = []
    async for line in iter_lines(response):
        if line == "":
            if data_lines:
                yield event_name, "\n".join(data_lines)
            event_name = None
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    if data_lines:
        yield event_name, "\n".join(data_lines)
