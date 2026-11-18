from app.adapters.anthropic import AnthropicAdapter
from app.adapters.base import AdapterError, ProviderAdapter
from app.adapters.ollama import OllamaAdapter
from app.adapters.openai_compat import OpenAIAdapter
from app.adapters.stubs import VideoAdapter

ADAPTERS: dict[str, ProviderAdapter] = {
    **{slug: OpenAIAdapter(slug) for slug in ("openai", "groq", "gemini", "deepseek", "together", "vllm")},
    "anthropic": AnthropicAdapter(),
    "ollama": OllamaAdapter(),
    "video": VideoAdapter(),
}


def get_adapter(slug: str) -> ProviderAdapter:
    adapter = ADAPTERS.get(slug)
    if adapter is None:
        raise AdapterError(400, f"unknown adapter '{slug}'", False)
    return adapter


def list_adapters() -> list[dict]:
    return [
        {"slug": adapter.slug, "implemented": adapter.implemented, "summary": adapter.summary}
        for adapter in ADAPTERS.values()
    ]


__all__ = ["ADAPTERS", "AdapterError", "get_adapter", "list_adapters"]
