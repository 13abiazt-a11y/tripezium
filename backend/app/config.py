"""All configuration comes from environment variables (or backend/.env locally)."""
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"  # 2.5-flash is closed to new API keys
    # Tried in order when a model hits its quota (429). Free-tier quotas are per model, ~20 requests/day.
    gemini_fallback_models: str = "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash"
    fx_source: str = "public"  # wise | public
    wise_api_token: str = ""
    frontend_origins: str = "http://localhost:3000"
    nominatim_user_agent: str = "iku-trip-planner/1.0"

    @field_validator("gemini_model", "gemini_fallback_models", "nominatim_user_agent", mode="before")
    @classmethod
    def _blank_means_default(cls, v, info):
        # A blank line in .env (e.g. "GEMINI_MODEL=") would otherwise override the default with "".
        if isinstance(v, str) and not v.strip():
            return cls.model_fields[info.field_name].default
        return v

    @property
    def gemini_models(self) -> list[str]:
        """Primary model first, then fallbacks, without duplicates."""
        fallbacks = [m.strip() for m in self.gemini_fallback_models.split(",") if m.strip()]
        return list(dict.fromkeys([self.gemini_model, *fallbacks]))

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
