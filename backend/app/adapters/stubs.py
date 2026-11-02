from app.adapters.base import AdapterError, ProviderAdapter

_STUBS = {
    "groq": (
        "Reserved adapter. Register Groq today with the openai adapter and "
        "base URL https://api.groq.com/openai/v1."
    ),
    "gemini": (
        "Reserved adapter. Gemini's OpenAI-compatible endpoint can use the "
        "openai adapter until this one is implemented."
    ),
    "deepseek": (
        "Reserved adapter. Register DeepSeek with the openai adapter and "
        "base URL https://api.deepseek.com."
    ),
    "together": (
        "Reserved adapter. Register Together with the openai adapter and "
        "base URL https://api.together.xyz/v1."
    ),
    "vllm": (
        "Reserved adapter. vLLM already speaks the OpenAI API: register it "
        "with the openai adapter and a base URL that ends in /v1."
    ),
    "video": (
        "Video provider. The gateway only routes chat completions, so this "
        "adapter does not call the upstream API."
    ),
}


class StubAdapter(ProviderAdapter):
    implemented = False

    def __init__(self, slug: str, summary: str):
        self.slug = slug
        self.summary = summary

    async def test_connection(self, client, *, base_url, api_key, timeout) -> str:
        raise AdapterError(501, f"adapter '{self.slug}' is not implemented", False)

    async def open_chat(
        self,
        client,
        *,
        base_url,
        api_key,
        model,
        messages,
        temperature,
        max_tokens,
        timeout,
    ):
        raise AdapterError(501, f"adapter '{self.slug}' is not implemented", False)


def stub_adapters() -> list[StubAdapter]:
    return [StubAdapter(slug, summary) for slug, summary in _STUBS.items()]
