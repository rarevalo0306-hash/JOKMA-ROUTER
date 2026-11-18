import uuid
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.base import ChatChunk
from app.orm import UsageLog
from app.tokens import estimate_tokens


class UsageAccumulator:
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.refusal: list[str] = []
        self.reasoning: list[str] = []
        self.tool_calls: dict[int, dict] = {}
        self.prompt_tokens: int | None = None
        self.completion_tokens: int | None = None
        self._finish_reason: str | None = None

    def add(self, chunk: ChatChunk) -> None:
        if chunk.content:
            self.parts.append(chunk.content)
        if chunk.refusal:
            self.refusal.append(chunk.refusal)
        if chunk.reasoning_content:
            self.reasoning.append(chunk.reasoning_content)
        for delta in chunk.tool_calls:
            call = self.tool_calls.setdefault(delta["index"], {"function": {"arguments": ""}})
            call.update({k: v for k, v in delta.items() if k not in {"index", "function"} and v is not None})
            for key, value in (delta.get("function") or {}).items():
                if value is not None:
                    call["function"][key] = call["function"].get(key, "") + value
        if chunk.prompt_tokens is not None:
            self.prompt_tokens = int(chunk.prompt_tokens)
        if chunk.completion_tokens is not None:
            self.completion_tokens = int(chunk.completion_tokens)
        if chunk.finish_reason:
            self._finish_reason = chunk.finish_reason

    @property
    def finish_reason(self) -> str:
        return self._finish_reason or ("tool_calls" if self.tool_calls else "stop")

    @property
    def message(self) -> dict:
        content = "".join(self.parts)
        message: dict = {"role": "assistant", "content": content}
        if self.tool_calls:
            message["tool_calls"] = [self.tool_calls[i] for i in sorted(self.tool_calls)]
        if self.refusal:
            message["refusal"] = "".join(self.refusal)
        if self.reasoning:
            message["reasoning_content"] = "".join(self.reasoning)
        if not content and (self.tool_calls or self.refusal):
            message["content"] = None
        return message

    def usage(self, estimated_prompt_tokens: int) -> dict:
        prompt = self.prompt_tokens if self.prompt_tokens is not None else estimated_prompt_tokens
        completion = self.completion_tokens
        if completion is None:
            text = "".join(self.parts + self.reasoning + self.refusal)
            for call in self.tool_calls.values():
                text += call["function"].get("name", "") + call["function"]["arguments"]
            completion = estimate_tokens(text)
        return {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion}


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
