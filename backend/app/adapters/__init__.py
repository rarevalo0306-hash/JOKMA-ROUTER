from app.adapters.anthropic import AnthropicAdapter
from app.adapters.base import AdapterError, ProviderAdapter
from app.adapters.ollama import OllamaAdapter
from app.adapters.openai_compat import OpenAIAdapter
from app.adapters.stubs import stub_adapters

ADAPTERS: dict[str, ProviderAdapter] = {
    "openai": OpenAIAdapter(),
    "anthropic": AnthropicAdapter(),
    "ollama": OllamaAdapter(),
}
for _stub in stub_adapters():
    ADAPTERS[_stub.slug] = _stub


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
