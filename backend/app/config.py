from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://jokma:jokma@localhost:5432/jokma"
    router_secret_key: str = ""
    admin_api_key: str = ""
    request_timeout_seconds: float = 120.0
    cors_origins: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


def get_settings() -> Settings:
    return Settings()
