import re
import uuid
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PROVIDER_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
_MODEL_SEGMENT = r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}"
MODEL_NAME = re.compile(rf"^(?:{_MODEL_SEGMENT})(?:/{_MODEL_SEGMENT})*$")
ALIAS_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")


class ChatMessage(BaseModel):
    role: str
    content: str | list | None = None
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    model_config = ConfigDict(extra="allow")


class StreamOptions(BaseModel):
    include_usage: bool = False
    model_config = ConfigDict(extra="forbid")


class ChatFunction(BaseModel):
    name: str = Field(min_length=1)
    parameters: dict | None = None
    model_config = ConfigDict(extra="allow")


class ChatTool(BaseModel):
    type: Literal["function"]
    function: ChatFunction
    model_config = ConfigDict(extra="allow")


class ChatRequest(BaseModel):
    model: str = Field(min_length=1)
    messages: list[ChatMessage] = Field(min_length=1)
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    tools: list[ChatTool] | None = None
    tool_choice: Literal["auto", "none", "required"] | dict | None = None
    parallel_tool_calls: bool | None = None
    max_completion_tokens: int | None = Field(default=None, ge=1)
    response_format: dict | None = None
    stream_options: StreamOptions | None = None
    n: Literal[1] = 1
    model_config = ConfigDict(extra="allow")

    @field_validator("response_format")
    @classmethod
    def valid_response_format(cls, value: dict | None) -> dict | None:
        if value is None:
            return None
        if value.get("type") not in ("text", "json_object", "json_schema"):
            raise ValueError("Unknown response_format type")
        if value["type"] == "json_schema":
            definition = value.get("json_schema")
            if not isinstance(definition, dict) or not isinstance(definition.get("schema"), dict):
                raise ValueError("response_format requires a JSON schema")
        return value

    def adapter_options(self) -> dict:
        options = self.model_dump(
            exclude={"model", "messages", "stream", "stream_options", "temperature", "max_tokens", "n"},
            exclude_unset=True,
        )
        return {key: value for key, value in options.items() if value is not None}


class ProviderIn(BaseModel):
    name: str
    adapter: str
    base_url: str
    api_key: str | None = None
    enabled: bool = True

    @field_validator("name", "adapter")
    @classmethod
    def lower(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("name")
    @classmethod
    def name_ok(cls, value: str) -> str:
        if not PROVIDER_NAME.match(value):
            raise ValueError("name must be a lowercase slug")
        return value

    @field_validator("base_url")
    @classmethod
    def url_ok(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError("base_url must start with http:// or https://")
        return value


class ProviderUpdate(BaseModel):
    name: str | None = None
    adapter: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    enabled: bool | None = None

    @field_validator("name", "adapter")
    @classmethod
    def lower(cls, value: str | None) -> str | None:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def name_ok(cls, value: str | None) -> str | None:
        if value is not None and not PROVIDER_NAME.match(value):
            raise ValueError("name must be a lowercase slug")
        return value

    @field_validator("base_url")
    @classmethod
    def url_ok(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip().rstrip("/")
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError("base_url must start with http:// or https://")
        return value


class ModelIn(BaseModel):
    provider_id: uuid.UUID
    name: str
    alias: str | None = None
    enabled: bool = True
    fallback_model_ids: list[uuid.UUID] = Field(default_factory=list)
    input_per_million: Decimal = Decimal("0")
    output_per_million: Decimal = Decimal("0")

    @field_validator("name")
    @classmethod
    def name_ok(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 200 or not MODEL_NAME.match(value):
            raise ValueError("model name must be a slug or author/slug")
        return value

    @field_validator("alias")
    @classmethod
    def alias_ok(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if value == "":
            return None
        if "/" in value or not ALIAS_NAME.match(value):
            raise ValueError("alias cannot contain a slash")
        return value

    @field_validator("input_per_million", "output_per_million")
    @classmethod
    def price_ok(cls, value: Decimal) -> Decimal:
        if value < 0:
            raise ValueError("price cannot be negative")
        return value


class ModelUpdate(BaseModel):
    alias: str | None = None
    expected_alias: str | None = None
    transfer_alias_from: uuid.UUID | None = None
    enabled: bool | None = None
    fallback_model_ids: list[uuid.UUID] | None = None
    input_per_million: Decimal | None = None
    output_per_million: Decimal | None = None

    @field_validator("alias")
    @classmethod
    def alias_ok(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if value == "":
            return None
        if "/" in value or not ALIAS_NAME.match(value):
            raise ValueError("alias cannot contain a slash")
        return value

    @field_validator("input_per_million", "output_per_million")
    @classmethod
    def price_ok(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("price cannot be negative")
        return value


class ApiKeyIn(BaseModel):
    """One label. app_name stays for usage rows and defaults to the name."""

    name: str = Field(min_length=1, max_length=120)
    app_name: str | None = Field(default=None, max_length=120)

    @field_validator("name")
    @classmethod
    def name_ok(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name is required")
        return value

    @field_validator("app_name")
    @classmethod
    def app_ok(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None
