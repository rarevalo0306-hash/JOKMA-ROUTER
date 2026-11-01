import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import AdapterError, get_adapter
from app.adapters.base import OpenedStream
from app.config import Settings
from app.orm import Model, ModelFallback, ModelPrice, Provider
from app.security import decrypt_secret
from app.tokens import as_decimal


class ModelNotFound(Exception):
    pass


@dataclass
class ResolvedModel:
    model_id: uuid.UUID
    public_id: str
    provider_name: str
    adapter: str
    base_url: str
    api_key: str | None
    upstream_model: str
    input_per_million: Decimal
    output_per_million: Decimal


@dataclass
class OpenRoute:
    stream: OpenedStream
    resolved: ResolvedModel
    used_fallback: bool
    attempts: list[dict]


@dataclass
class RouteFailed(Exception):
    status_code: int
    message: str
    attempts: list[dict] = field(default_factory=list)

    def __str__(self) -> str:
        return self.message


def _resolved(model: Model, provider: Provider, price: ModelPrice | None, settings: Settings) -> ResolvedModel:
    try:
        api_key = decrypt_secret(settings, provider.api_key_encrypted)
    except RuntimeError as exc:
        raise AdapterError(500, str(exc), False) from exc
    return ResolvedModel(
        model_id=model.id,
        public_id=f"{provider.name}/{model.name}",
        provider_name=provider.name,
        adapter=provider.adapter,
        base_url=provider.base_url,
        api_key=api_key,
        upstream_model=model.name,
        input_per_million=as_decimal(price.input_per_million if price else 0),
        output_per_million=as_decimal(price.output_per_million if price else 0),
    )


async def resolve_model(session: AsyncSession, settings: Settings, model_ref: str) -> ResolvedModel:
    ref = model_ref.strip()
    if not ref:
        raise ModelNotFound()
    stmt = (
        select(Model, Provider, ModelPrice)
        .join(Provider, Provider.id == Model.provider_id)
        .outerjoin(ModelPrice, ModelPrice.model_id == Model.id)
    )
    if "/" in ref:
        provider_name, model_name = ref.split("/", 1)
        stmt = stmt.where(Provider.name == provider_name, Model.name == model_name)
    else:
        stmt = stmt.where(Model.alias == ref)
    row = (await session.execute(stmt)).first()
    if row is None:
        raise ModelNotFound()
    model, provider, price = row
    if not model.enabled or not provider.enabled:
        raise ModelNotFound()
    return _resolved(model, provider, price, settings)


async def first_fallback(
    session: AsyncSession, settings: Settings, model_id: uuid.UUID
) -> ResolvedModel | None:
    stmt = (
        select(Model, Provider, ModelPrice)
        .join(ModelFallback, ModelFallback.fallback_model_id == Model.id)
        .join(Provider, Provider.id == Model.provider_id)
        .outerjoin(ModelPrice, ModelPrice.model_id == Model.id)
        .where(ModelFallback.model_id == model_id)
        .order_by(ModelFallback.position)
    )
    for model, provider, price in (await session.execute(stmt)).all():
        if not model.enabled or not provider.enabled:
            continue
        try:
            return _resolved(model, provider, price, settings)
        except AdapterError:
            continue
    return None


async def open_with_fallback(
    http,
    settings: Settings,
    session: AsyncSession,
    primary: ResolvedModel,
    messages: list[dict],
    temperature: float | None,
    max_tokens: int | None,
) -> OpenRoute:
    """Try the primary route. On timeout, 429, or 5xx, try one fallback.

    The fallback is chosen before any byte is forwarded to the caller. A
    failure after tokens have started streaming is not retried.
    """
    candidates = [primary]
    fallback = await first_fallback(session, settings, primary.model_id)
    if fallback is not None and fallback.public_id != primary.public_id:
        candidates.append(fallback)

    attempts: list[dict] = []
    last: AdapterError | None = None
    for index, candidate in enumerate(candidates):
        try:
            adapter = get_adapter(candidate.adapter)
            stream = await adapter.open_chat(
                http,
                base_url=candidate.base_url,
                api_key=candidate.api_key,
                model=candidate.upstream_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=settings.request_timeout_seconds,
            )
        except AdapterError as exc:
            attempts.append(
                {
                    "model": candidate.public_id,
                    "adapter": candidate.adapter,
                    "status": exc.status_code,
                    "error": exc.message[:500],
                    "retryable": exc.retryable,
                }
            )
            last = exc
            if exc.retryable and index == 0 and len(candidates) > 1:
                continue
            break
        attempts.append(
            {
                "model": candidate.public_id,
                "adapter": candidate.adapter,
                "status": 200,
                "error": None,
                "retryable": False,
            }
        )
        return OpenRoute(
            stream=stream,
            resolved=candidate,
            used_fallback=index > 0,
            attempts=attempts,
        )

    assert last is not None
    raise RouteFailed(last.status_code, last.message, attempts)
