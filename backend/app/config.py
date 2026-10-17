"""All configuration comes from environment variables (or backend/.env locally)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    gemini_api_key: str = ""
    gemini_model: str = ""
    frontend_origins: str = "http://localhost:3000"
    nominatim_user_agent: str = "iku-trip-planner/1.0"
    google_maps_api_key: str = ""  # optional; used ONLY for opening hours

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
