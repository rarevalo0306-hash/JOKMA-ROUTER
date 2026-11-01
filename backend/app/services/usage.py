import uuid
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.orm import UsageLog


class UsageAccumulator:
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.prompt_tokens: int | None = None
        self.completion_tokens: int | None = None
        self.finish_reason: str | None = None

    def add(self, chunk) -> None:
        if chunk.content:
            self.parts.append(chunk.content)
        if chunk.prompt_tokens is not None:
            self.prompt_tokens = int(chunk.prompt_tokens)
        if chunk.completion_tokens is not None:
            self.completion_tokens = int(chunk.completion_tokens)
        if chunk.finish_reason:
            self.finish_reason = chunk.finish_reason

    @property
    def text(self) -> str:
        return "".join(self.parts)


async def record_usage(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    api_key_id: uuid.UUID,
    app_name: str,
    model_requested: str,
    model_served: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    latency_ms: int,
    status: str,
    http_status: int | None,
    estimated_cost: Decimal,
    error_message: str | None,
    route_trace: list,
) -> None:
    async with sessionmaker() as session:
        session.add(
            UsageLog(
                api_key_id=api_key_id,
                app_name=app_name,
                model_requested=model_requested,
                model_served=model_served,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency_ms=max(latency_ms, 0),
                status=status,
                http_status=http_status,
                estimated_cost=estimated_cost,
                error_message=error_message[:500] if error_message else None,
                route_trace=route_trace,
            )
        )
        await session.commit()
