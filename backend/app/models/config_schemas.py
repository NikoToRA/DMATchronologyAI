"""JSON configuration file schemas and validators.

This module provides Pydantic models for validating JSON configuration files
and utilities for loading and validating config data.
"""

import json
from pathlib import Path
from typing import Any, List, Optional, Type, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .schemas import HQMaster, ZoomCredentials


# Type variable for generic config loading
T = TypeVar("T", bound=BaseModel)


class HQMasterConfig(BaseModel):
    """Configuration model for HQ Master list validation."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
    )

    items: List[HQMaster] = Field(
        default_factory=list,
        description="List of HQ Master entries",
    )

    @classmethod
    def from_list(cls, data: List[dict[str, Any]]) -> "HQMasterConfig":
        """Create config from a list of HQ Master dictionaries."""
        return cls(items=[HQMaster(**item) for item in data])

    def to_list(self) -> List[dict[str, Any]]:
        """Convert to list of dictionaries for JSON serialization."""
        return [item.model_dump() for item in self.items]


class ZoomCredentialsConfig(ZoomCredentials):
    """Configuration model for Zoom credentials validation."""

    @field_validator("client_id", "client_secret", "account_id", mode="before")
    @classmethod
    def strip_whitespace(cls, v: Any) -> str:
        """Strip whitespace from string values."""
        if isinstance(v, str):
            return v.strip()
        return v if v is not None else ""


class ConfigValidationError(Exception):
    """Exception raised when configuration validation fails."""

    def __init__(self, message: str, errors: Optional[List[dict[str, Any]]] = None):
        super().__init__(message)
        self.errors = errors or []


def load_json_config(
    file_path: Path,
    model: Type[T],
    *,
    is_list: bool = False,
) -> T:
    """Load and validate a JSON configuration file.

    Args:
        file_path: Path to the JSON configuration file
        model: Pydantic model class to validate against
        is_list: If True, expects a JSON array and wraps in HQMasterConfig

    Returns:
        Validated configuration model instance

    Raises:
        ConfigValidationError: If file doesn't exist or validation fails
        FileNotFoundError: If the configuration file doesn't exist
    """
    if not file_path.exists():
        raise FileNotFoundError(f"Configuration file not found: {file_path}")

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigValidationError(
            f"Invalid JSON in configuration file: {file_path}",
            errors=[{"type": "json_decode_error", "message": str(e)}],
        )

    try:
        if is_list and isinstance(data, list):
            # Special handling for list-based configs like hq_master.json
            return HQMasterConfig.from_list(data)  # type: ignore
        return model.model_validate(data)
    except Exception as e:
        raise ConfigValidationError(
            f"Configuration validation failed: {file_path}",
            errors=[{"type": "validation_error", "message": str(e)}],
        )


def validate_hq_master_json(file_path: Path) -> HQMasterConfig:
    """Validate HQ Master configuration file.

    Args:
        file_path: Path to hq_master.json

    Returns:
        Validated HQMasterConfig instance
    """
    return load_json_config(file_path, HQMasterConfig, is_list=True)  # type: ignore


def validate_zoom_credentials_json(file_path: Path) -> ZoomCredentialsConfig:
    """Validate Zoom credentials configuration file.

    Args:
        file_path: Path to zoom_credentials.json

    Returns:
        Validated ZoomCredentialsConfig instance
    """
    return load_json_config(file_path, ZoomCredentialsConfig)


def generate_json_schema(model: Type[BaseModel]) -> dict[str, Any]:
    """Generate JSON Schema from a Pydantic model.

    Args:
        model: Pydantic model class

    Returns:
        JSON Schema dictionary
    """
    return model.model_json_schema()


def save_json_schema(model: Type[BaseModel], output_path: Path) -> None:
    """Save JSON Schema to a file.

    Args:
        model: Pydantic model class
        output_path: Path to save the schema file
    """
    schema = generate_json_schema(model)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False)
