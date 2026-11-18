from app.adapters.base import AdapterError, ProviderAdapter


class VideoAdapter(ProviderAdapter):
    slug = "video"
    implemented = False
    summary = "Proveedor de vídeo. El endpoint de chat solo acepta modelos de chat."

    async def test_connection(self, client, *, base_url, api_key, timeout) -> str:
        raise AdapterError(501, "adapter 'video' is not implemented", False)

    async def open_chat(self, client, **kwargs):
        raise AdapterError(501, "adapter 'video' is not implemented", False)
