import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import AdapterError, get_adapter, list_adapters
from app.db import get_db
from app.orm import ApiKey, Model, ModelFallback, ModelPrice, Provider, UsageLog
from app.schemas import ApiKeyIn, ModelIn, ModelUpdate, ProviderIn, ProviderUpdate
from app.security import decrypt_secret, encrypt_secret, generate_api_key, scrub, secrets_equal
from app.tokens import as_decimal

router = APIRouter(prefix="/admin")


def require_admin(request: Request) -> None:
    expected = request.app.state.settings.admin_api_key
    if not expected:
        raise HTTPException(status_code=503, detail="Admin API is not configured")
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    provided = authorization.split(" ", 1)[1].strip()
    if not secrets_equal(provided, expected):
        raise HTTPException(status_code=401, detail="Admin authentication required")


Admin = Annotated[None, Depends(require_admin)]
Db = Annotated[AsyncSession, Depends(get_db)]


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _money(value) -> float:
    return float(as_decimal(value))


def _provider_out(row: Provider) -> dict:
    return {
        "id": str(row.id),
        "name": row.name,
        "adapter": row.adapter,
        "base_url": row.base_url,
        "enabled": row.enabled,
        "has_api_key": bool(row.api_key_encrypted),
        "api_key_last4": row.api_key_last4,
        "key_url": row.key_url,
        "label": row.label,
        "kind": row.kind or "chat",
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


async def _model_out(session: AsyncSession, model: Model, provider: Provider, price: ModelPrice | None) -> dict:
    fallback_rows = (
        await session.execute(
            select(ModelFallback, Model, Provider)
            .join(Model, Model.id == ModelFallback.fallback_model_id)
            .join(Provider, Provider.id == Model.provider_id)
            .where(ModelFallback.model_id == model.id)
            .order_by(ModelFallback.position)
        )
    ).all()
    fallbacks = [
        {"id": str(target.id), "public_id": f"{target_provider.name}/{target.name}"}
        for _link, target, target_provider in fallback_rows
    ]
    return {
        "id": str(model.id),
        "provider_id": str(provider.id),
        "provider_name": provider.name,
        "name": model.name,
        "public_id": f"{provider.name}/{model.name}",
        "alias": model.alias,
        "enabled": model.enabled,
        "fallback_model_ids": [item["id"] for item in fallbacks],
        "fallbacks": fallbacks,
        "input_per_million": _money(price.input_per_million if price else 0),
        "output_per_million": _money(price.output_per_million if price else 0),
        "currency": price.currency if price else "USD",
    }


async def _replace_fallbacks(session: AsyncSession, model_id: uuid.UUID, fallback_ids: list[uuid.UUID]) -> None:
    if model_id in fallback_ids:
        raise HTTPException(status_code=400, detail="A model cannot fall back to itself")
    if len(fallback_ids) != len(set(fallback_ids)):
        raise HTTPException(status_code=400, detail="Fallback list contains duplicates")
    if fallback_ids:
        found = (
            await session.execute(select(Model.id).where(Model.id.in_(fallback_ids)))
        ).scalars().all()
        if set(found) != set(fallback_ids):
            raise HTTPException(status_code=400, detail="Fallback model was not found")
    await session.execute(delete(ModelFallback).where(ModelFallback.model_id == model_id))
    await session.flush()
    for position, fallback_id in enumerate(fallback_ids):
        session.add(
            ModelFallback(model_id=model_id, fallback_model_id=fallback_id, position=position)
        )


def _touch(row) -> None:
    row.updated_at = datetime.now(timezone.utc)


@router.get("/adapters")
async def adapters(_admin: Admin):
    return {"adapters": list_adapters()}


@router.get("/providers")
async def list_providers(_admin: Admin, session: Db):
    rows = (await session.execute(select(Provider).order_by(Provider.name))).scalars().all()
    return [_provider_out(row) for row in rows]


@router.post("/providers", status_code=201)
async def create_provider(payload: ProviderIn, request: Request, _admin: Admin, session: Db):
    try:
        get_adapter(payload.adapter)
    except AdapterError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    row = Provider(
        name=payload.name,
        adapter=payload.adapter,
        base_url=payload.base_url,
        enabled=payload.enabled,
    )
    if payload.api_key:
        row.api_key_encrypted = encrypt_secret(request.app.state.settings, payload.api_key)
        row.api_key_last4 = payload.api_key[-4:]
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Provider name already exists") from exc
    return _provider_out(row)


@router.patch("/providers/{provider_id}")
async def update_provider(
    provider_id: uuid.UUID,
    payload: ProviderUpdate,
    request: Request,
    _admin: Admin,
    session: Db,
):
    row = await session.get(Provider, provider_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    data = payload.model_dump(exclude_unset=True)
    if "adapter" in data and data["adapter"] is not None:
        try:
            get_adapter(data["adapter"])
        except AdapterError as exc:
            raise HTTPException(status_code=400, detail=exc.message) from exc
        row.adapter = data["adapter"]
    if "name" in data and data["name"] is not None:
        row.name = data["name"]
    if "base_url" in data and data["base_url"] is not None:
        row.base_url = data["base_url"]
    if "enabled" in data and data["enabled"] is not None:
        row.enabled = data["enabled"]
    if "api_key" in data:
        secret = data["api_key"]
        if secret:
            row.api_key_encrypted = encrypt_secret(request.app.state.settings, secret)
            row.api_key_last4 = secret[-4:]
        else:
            row.api_key_encrypted = None
            row.api_key_last4 = None
    _touch(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Provider name already exists") from exc
    return _provider_out(row)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(provider_id: uuid.UUID, _admin: Admin, session: Db):
    row = await session.get(Provider, provider_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    await session.execute(delete(Model).where(Model.provider_id == provider_id))
    await session.delete(row)


@router.post("/providers/{provider_id}/test")
async def test_provider(provider_id: uuid.UUID, request: Request, _admin: Admin, session: Db):
    row = await session.get(Provider, provider_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    settings = request.app.state.settings
    try:
        api_key = decrypt_secret(settings, row.api_key_encrypted)
    except RuntimeError as exc:
        return {"ok": False, "detail": str(exc)}
    adapter = get_adapter(row.adapter)
    try:
        detail = await adapter.test_connection(
            request.app.state.http,
            base_url=row.base_url,
            api_key=api_key,
            timeout=settings.request_timeout_seconds,
        )
        return {"ok": True, "detail": scrub(detail, api_key)}
    except AdapterError as exc:
        return {"ok": False, "detail": scrub(exc.message, api_key)}
    except Exception as exc:
        return {"ok": False, "detail": scrub(str(exc), api_key)[:300]}


@router.get("/models")
async def list_models(_admin: Admin, session: Db):
    rows = (
        await session.execute(
            select(Model, Provider, ModelPrice)
            .join(Provider, Provider.id == Model.provider_id)
            .outerjoin(ModelPrice, ModelPrice.model_id == Model.id)
            .order_by(Provider.name, Model.name)
        )
    ).all()
    return [await _model_out(session, model, provider, price) for model, provider, price in rows]


@router.post("/models", status_code=201)
async def create_model(payload: ModelIn, _admin: Admin, session: Db):
    provider = await session.get(Provider, payload.provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    model = Model(
        provider_id=provider.id,
        name=payload.name,
        alias=payload.alias,
        enabled=payload.enabled,
    )
    session.add(model)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Model name or alias already exists") from exc
    price = ModelPrice(
        model_id=model.id,
        input_per_million=payload.input_per_million,
        output_per_million=payload.output_per_million,
    )
    session.add(price)
    await _replace_fallbacks(session, model.id, payload.fallback_model_ids)
    await session.flush()
    return await _model_out(session, model, provider, price)


@router.patch("/models/{model_id}")
async def update_model(model_id: uuid.UUID, payload: ModelUpdate, _admin: Admin, session: Db):
    model = await session.get(Model, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    provider = await session.get(Provider, model.provider_id)
    data = payload.model_dump(exclude_unset=True)
    if "alias" in data:
        model.alias = data["alias"]
    if "enabled" in data and data["enabled"] is not None:
        model.enabled = data["enabled"]
    price = await session.get(ModelPrice, model.id)
    if price is None:
        price = ModelPrice(model_id=model.id)
        session.add(price)
    if "input_per_million" in data and data["input_per_million"] is not None:
        price.input_per_million = data["input_per_million"]
    if "output_per_million" in data and data["output_per_million"] is not None:
        price.output_per_million = data["output_per_million"]
    price.updated_at = datetime.now(timezone.utc)
    if "fallback_model_ids" in data and data["fallback_model_ids"] is not None:
        await _replace_fallbacks(session, model.id, data["fallback_model_ids"])
    _touch(model)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Alias already exists") from exc
    return await _model_out(session, model, provider, price)


@router.delete("/models/{model_id}", status_code=204)
async def delete_model(model_id: uuid.UUID, _admin: Admin, session: Db):
    model = await session.get(Model, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    await session.execute(
        delete(ModelFallback).where(
            (ModelFallback.model_id == model_id) | (ModelFallback.fallback_model_id == model_id)
        )
    )
    await session.execute(delete(ModelPrice).where(ModelPrice.model_id == model_id))
    await session.delete(model)


def _key_out(row: ApiKey, raw_key: str | None = None) -> dict:
    payload = {
        "id": str(row.id),
        "name": row.name,
        "app_name": row.app_name,
        "key_prefix": row.key_prefix,
        "revoked_at": _iso(row.revoked_at),
        "last_used_at": _iso(row.last_used_at),
        "created_at": _iso(row.created_at),
    }
    if raw_key is not None:
        payload["raw_key"] = raw_key
    return payload


@router.get("/api-keys")
async def list_api_keys(_admin: Admin, session: Db):
    rows = (await session.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))).scalars().all()
    return [_key_out(row) for row in rows]


@router.post("/api-keys", status_code=201)
async def create_api_key(payload: ApiKeyIn, _admin: Admin, session: Db):
    # No maximum. Each call mints a new ak_ token. The raw value is returned
    # once here and is not stored.
    raw, key_hash, prefix = generate_api_key()
    row = ApiKey(
        name=payload.name,
        app_name=payload.app_name or payload.name,
        key_prefix=prefix,
        key_hash=key_hash,
    )
    session.add(row)
    await session.flush()
    return _key_out(row, raw)


@router.post("/api-keys/{key_id}/revoke")
async def revoke_api_key(key_id: uuid.UUID, _admin: Admin, session: Db):
    row = await session.get(ApiKey, key_id)
    if row is None:
        raise HTTPException(status_code=404, detail="API key not found")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
    return _key_out(row)


@router.get("/usage/summary")
async def usage_summary(
    _admin: Admin,
    session: Db,
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
):
    filters = []
    if from_ is not None:
        filters.append(UsageLog.created_at >= from_)
    if to is not None:
        filters.append(UsageLog.created_at <= to)

    def apply(stmt):
        return stmt.where(*filters) if filters else stmt

    totals = (
        await session.execute(
            apply(
                select(
                    func.count(UsageLog.id),
                    func.avg(UsageLog.latency_ms),
                    func.coalesce(func.sum(UsageLog.prompt_tokens), 0),
                    func.coalesce(func.sum(UsageLog.completion_tokens), 0),
                    func.coalesce(func.sum(UsageLog.estimated_cost), 0),
                )
            )
        )
    ).one()
    requests, avg_latency, prompt_tokens, completion_tokens, estimated_cost = totals

    by_app = (
        await session.execute(
            apply(
                select(
                    UsageLog.app_name,
                    func.coalesce(func.sum(UsageLog.prompt_tokens), 0),
                    func.coalesce(func.sum(UsageLog.completion_tokens), 0),
                    func.count(UsageLog.id),
                ).group_by(UsageLog.app_name)
            ).order_by(UsageLog.app_name)
        )
    ).all()
    by_model = (
        await session.execute(
            apply(
                select(
                    UsageLog.model_served,
                    func.coalesce(func.sum(UsageLog.estimated_cost), 0),
                    func.coalesce(func.sum(UsageLog.prompt_tokens), 0),
                    func.coalesce(func.sum(UsageLog.completion_tokens), 0),
                    func.count(UsageLog.id),
                )
                .where(UsageLog.model_served.is_not(None))
                .group_by(UsageLog.model_served)
            ).order_by(UsageLog.model_served)
        )
    ).all()
    recent_rows = (
        await session.execute(
            apply(select(UsageLog).order_by(UsageLog.created_at.desc()).limit(20))
        )
    ).scalars().all()

    return {
        "requests": int(requests or 0),
        "avg_latency_ms": None if avg_latency is None else round(float(avg_latency), 1),
        "prompt_tokens": int(prompt_tokens or 0),
        "completion_tokens": int(completion_tokens or 0),
        "estimated_cost": _money(estimated_cost),
        "tokens_by_app": [
            {
                "app": app,
                "prompt_tokens": int(prompt),
                "completion_tokens": int(completion),
                "requests": int(count),
            }
            for app, prompt, completion, count in by_app
        ],
        "cost_by_model": [
            {
                "model": model,
                "estimated_cost": _money(cost),
                "prompt_tokens": int(prompt),
                "completion_tokens": int(completion),
                "requests": int(count),
            }
            for model, cost, prompt, completion, count in by_model
        ],
        "recent": [
            {
                "id": str(row.id),
                "app_name": row.app_name,
                "model_requested": row.model_requested,
                "model_served": row.model_served,
                "prompt_tokens": row.prompt_tokens,
                "completion_tokens": row.completion_tokens,
                "latency_ms": row.latency_ms,
                "status": row.status,
                "http_status": row.http_status,
                "estimated_cost": _money(row.estimated_cost),
                "error_message": row.error_message,
                "route_trace": row.route_trace,
                "created_at": _iso(row.created_at),
            }
            for row in recent_rows
        ],
    }
