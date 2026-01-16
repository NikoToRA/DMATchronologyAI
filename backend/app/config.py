"""Application configuration using Pydantic Settings.

This module provides centralized configuration management with:
- Environment variable loading from .env file
- Type validation and coercion
- Sensible defaults for development
"""

from functools import lru_cache
from typing import Literal, Optional

from pydantic import Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Main application settings.

    All settings are loaded from environment variables and .env file.

    Environment Variables:
        AZURE_STORAGE_CONNECTION_STRING: Azure Blob Storage connection string
        AZURE_STORAGE_ACCOUNT_NAME: Azure Storage account name (default: dmatstorage)
        AZURE_STORAGE_CONTAINER_NAME: Container name (default: sessions)
        AZURE_SPEECH_KEY: Azure Speech Services API key
        AZURE_SPEECH_REGION: Azure Speech region (default: japaneast)
        AZURE_OPENAI_ENDPOINT: Azure OpenAI endpoint URL
        AZURE_OPENAI_KEY: Azure OpenAI API key
        AZURE_OPENAI_DEPLOYMENT: Deployment name (default: gpt-4o)
        APP_ENV: Application environment (development/staging/production)
        DEBUG: Enable debug mode (default: true)
        LOCAL_STORAGE_PATH: Local storage path (default: ./data)
        CONFIG_PATH: Config files directory (default: ../config)
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        validate_default=True,
        case_sensitive=False,
    )

    # =========================================================================
    # Azure Blob Storage Settings
    # =========================================================================
    azure_storage_connection_string: Optional[str] = Field(
        default=None,
        description="Azure Storage connection string",
    )
    azure_storage_account_name: str = Field(
        default="dmatstorage",
        description="Azure Storage account name",
    )
    azure_storage_container_name: str = Field(
        default="sessions",
        description="Azure Blob container name for session data",
    )

    # =========================================================================
    # Azure Speech Services Settings
    # =========================================================================
    azure_speech_key: Optional[str] = Field(
        default=None,
        description="Azure Speech Services API key",
    )
    azure_speech_region: str = Field(
        default="japaneast",
        description="Azure Speech Services region",
    )

    # =========================================================================
    # Azure OpenAI Settings
    # =========================================================================
    azure_openai_endpoint: Optional[str] = Field(
        default=None,
        description="Azure OpenAI endpoint URL",
    )
    azure_openai_key: Optional[str] = Field(
        default=None,
        description="Azure OpenAI API key",
    )
    azure_openai_deployment: str = Field(
        default="gpt-4o",
        description="Azure OpenAI deployment name",
    )

    # =========================================================================
    # Application Settings
    # =========================================================================
    app_env: Literal["development", "staging", "production"] = Field(
        default="development",
        description="Application environment",
    )
    debug: bool = Field(
        default=True,
        description="Enable debug mode",
    )
    local_storage_path: str = Field(
        default="./data",
        description="Local storage path for development",
    )
    config_path: str = Field(
        default="../config",
        description="Configuration files directory path",
    )

    # =========================================================================
    # Computed Properties
    # =========================================================================
    @computed_field
    @property
    def is_azure_storage_configured(self) -> bool:
        """Check if Azure Storage is configured."""
        return self.azure_storage_connection_string is not None

    @computed_field
    @property
    def is_azure_speech_configured(self) -> bool:
        """Check if Azure Speech is configured."""
        return self.azure_speech_key is not None

    @computed_field
    @property
    def is_azure_openai_configured(self) -> bool:
        """Check if Azure OpenAI is configured."""
        return self.azure_openai_endpoint is not None and self.azure_openai_key is not None

    @computed_field
    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.app_env == "production"

    # =========================================================================
    # Validators
    # =========================================================================
    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, v: object) -> bool:
        """Parse debug value from various input types."""
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes", "on")
        return bool(v)

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        """Validate that production has appropriate settings."""
        if self.app_env == "production" and self.debug:
            import warnings
            warnings.warn(
                "Debug mode is enabled in production environment. "
                "Set DEBUG=false for production deployments.",
                UserWarning,
                stacklevel=2,
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.

    Returns a cached Settings instance for performance.
    Use this function instead of creating Settings() directly.

    Returns:
        Cached Settings instance.

    Example:
        >>> settings = get_settings()
        >>> if settings.is_azure_storage_configured:
        ...     print("Azure Storage is ready")
    """
    return Settings()


# Singleton instance for backwards compatibility
settings = get_settings()
