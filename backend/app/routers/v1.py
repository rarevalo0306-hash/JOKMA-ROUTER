import json
import time
import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.orm import ApiKey, Model, Provider
from app.schemas import ChatRequest
from app.security import hash_api_key
from app.adapters import AdapterError
from app.services.gateway import ModelNotFound, RouteFailed, open_with_fallback, resolve_model
from app.services.usage import UsageAccumulator, record_usage
from app.tokens import content_to_text, estimate_cost, estimate_messages, estimate_tokens

router = APIRouter(prefix="/v1")


class APIError(Exception):
    def __init__(self, status: int, message: str, error_type: str, code: str):
        self.status = status
        self.message = message
        self.error_type = error_type
        self.code = code


def require_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise APIError(401, "Missing API key", "authentication_error", "invalid_api_key")
    return authorization.split(" ", 1)[1].strip()


async def require_api_key(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> ApiKey:
    raw = require_bearer(request.headers.get("authorization"))
    if not raw.startswith("ak_"):
        raise APIError(401, "Invalid API key", "authentication_error", "invalid_api_key")
    key = (
        await session.execute(select(ApiKey).where(ApiKey.key_hash == hash_api_key(raw)))
    ).scalar_one_or_none()
    if key is None:
        raise APIError(401, "Invalid API key", "authentication_error", "invalid_api_key")
    if key.revoked_at is not None:
        raise APIError(401, "API key revoked", "authentication_error", "revoked_api_key")
    from datetime import datetime, timezone

    key.last_used_at = datetime.now(timezone.utc)
    await session.commit()
    return key


@router.get("/models")
async def list_models(
    _api_key: Annotated[ApiKey, Depends(require_api_key)],
    session: Annotated[AsyncSession, Depends(get_db)],
):
    rows = (
        await session.execute(
            select(Model, Provider)
            .join(Provider, Provider.id == Model.provider_id)
            .where(Model.enabled.is_(True), Provider.enabled.is_(True))
            .order_by(Provider.name, Model.name)
        )
    ).all()
    created = int(time.time())
    data = []
    for model, provider in rows:
        data.append(
            {
                "id": f"{provider.name}/{model.name}",
                "object": "model",
                "created": created,
                "owned_by": provider.name,
            }
        )
        if model.alias:
            data.append(
                {
                    "id": model.alias,
                    "object": "model",
                    "created": created,
                    "owned_by": "alias",
                }
            )
    return {"object": "list", "data": data}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _chunk(completion_id: str, created: int, model: str, delta: dict, finish, usage=None) -> str:
    body = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    if usage is not None:
        body["usage"] = usage
    return _sse(body)


def _route_headers(public_id: str, used_fallback: bool) -> dict[str, str]:
    return {
        "X-Jokma-Model-Served": public_id,
        "X-Jokma-Fallback": "true" if used_fallback else "false",
    }


def _normalized_messages(payload: ChatRequest) -> list[dict]:
    return [
        {"role": message.role, "content": content_to_text(message.content)}
        for message in payload.messages
    ]


@router.post("/chat/completions")
async def chat_completions(
    payload: ChatRequest,
    request: Request,
    api_key: Annotated[ApiKey, Depends(require_api_key)],
    session: Annotated[AsyncSession, Depends(get_db)],
):
    settings = request.app.state.settings
    messages = _normalized_messages(payload)
    started = time.perf_counter()
    key_id = api_key.id
    app_name = api_key.app_name
    sessionmaker = request.app.state.sessionmaker

    try:
        primary = await resolve_model(session, settings, payload.model)
    except ModelNotFound:
        raise APIError(404, "Model not found", "invalid_request_error", "model_not_found") from None
    except AdapterError as exc:
        raise APIError(exc.status_code, exc.message, "provider_error", "upstream_error") from None

    try:
        opened = await open_with_fallback(
            request.app.state.http,
            settings,
            session,
            primary,
            messages,
            payload.temperature,
            payload.max_tokens,
        )
    except RouteFailed as exc:
        await record_usage(
            sessionmaker,
            api_key_id=key_id,
            app_name=app_name,
            model_requested=payload.model,
            model_served=None,
            prompt_tokens=estimate_messages(messages),
            completion_tokens=0,
            latency_ms=_latency(started),
            status="error",
            http_status=exc.status_code,
            estimated_cost=Decimal("0"),
            error_message=exc.message,
            route_trace=exc.attempts,
        )
        raise APIError(exc.status_code, exc.message, "provider_error", "upstream_error") from None

    accumulator = UsageAccumulator()
    served = opened.resolved
    status_name = "fallback" if opened.used_fallback else "success"

    async def persist(status: str, http_status: int, error: str | None) -> None:
        prompt_tokens = (
            accumulator.prompt_tokens
            if accumulator.prompt_tokens is not None
            else estimate_messages(messages)
        )
        completion_tokens = (
            accumulator.completion_tokens
            if accumulator.completion_tokens is not None
            else estimate_tokens(accumulator.text)
        )
        await record_usage(
            sessionmaker,
            api_key_id=key_id,
            app_name=app_name,
            model_requested=payload.model,
            model_served=served.public_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=_latency(started),
            status=status,
            http_status=http_status,
            estimated_cost=estimate_cost(
                prompt_tokens,
                completion_tokens,
                served.input_per_million,
                served.output_per_million,
            ),
            error_message=error,
            route_trace=opened.attempts,
        )

    headers = _route_headers(served.public_id, opened.used_fallback)
    completion_id = "chatcmpl-" + uuid.uuid4().hex[:24]
    created = int(time.time())

    if not payload.stream:
        try:
            async for chunk in opened.stream:
                accumulator.add(chunk)
        except Exception as exc:  # connection dropped after headers
            await opened.stream.aclose()
            await persist("error", 502, "upstream stream interrupted")
            raise APIError(502, "upstream stream interrupted", "provider_error", "upstream_error") from exc
        await persist(status_name, 200, None)
        prompt_tokens = (
            accumulator.prompt_tokens
            if accumulator.prompt_tokens is not None
            else estimate_messages(messages)
        )
        completion_tokens = (
            accumulator.completion_tokens
            if accumulator.completion_tokens is not None
            else estimate_tokens(accumulator.text)
        )
        body = {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": payload.model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": accumulator.text},
                    "finish_reason": accumulator.finish_reason or "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        }
        return JSONResponse(body, headers=headers)

    async def generate():
        sent_role = False
        try:
            async for chunk in opened.stream:
                accumulator.add(chunk)
                if not chunk.content:
                    continue
                delta = {"content": chunk.content}
                if not sent_role:
                    delta["role"] = "assistant"
                    sent_role = True
                yield _chunk(completion_id, created, payload.model, delta, None)
            if not sent_role:
                yield _chunk(completion_id, created, payload.model, {"role": "assistant"}, None)
            prompt_tokens = (
                accumulator.prompt_tokens
                if accumulator.prompt_tokens is not None
                else estimate_messages(messages)
            )
            completion_tokens = (
                accumulator.completion_tokens
                if accumulator.completion_tokens is not None
                else estimate_tokens(accumulator.text)
            )
            usage = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            }
            yield _chunk(
                completion_id,
                created,
                payload.model,
                {},
                accumulator.finish_reason or "stop",
                usage,
            )
            yield "data: [DONE]\n\n"
            await persist(status_name, 200, None)
        except Exception:
            await persist("error", 502, "upstream stream interrupted")
            yield _sse(
                {"error": {"message": "upstream stream interrupted", "type": "provider_error"}}
            )
        finally:
            await opened.stream.aclose()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            **headers,
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _latency(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
