"""
Shared exception handling utilities for API endpoints.

This module provides consistent error handling patterns across all API routes,
including custom exception classes and reusable error response helpers.
"""

from typing import Any, Optional
from fastapi import HTTPException, status


class APIException(HTTPException):
    """Base exception class for API errors with consistent formatting."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        headers: Optional[dict[str, str]] = None
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)


class NotFoundException(APIException):
    """Exception raised when a requested resource is not found."""

    def __init__(self, resource: str, resource_id: Optional[str] = None) -> None:
        detail = f"{resource} not found"
        if resource_id:
            detail = f"{resource} with id '{resource_id}' not found"
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class BadRequestException(APIException):
    """Exception raised for invalid request parameters or data."""

    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


class ConflictException(APIException):
    """Exception raised when there's a conflict with existing data."""

    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


class ServiceUnavailableException(APIException):
    """Exception raised when a required service is not available or configured."""

    def __init__(self, service: str, detail: Optional[str] = None) -> None:
        message = detail or f"{service} is not available or not configured"
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=message
        )


def create_success_response(
    message: str = "ok",
    **kwargs: Any
) -> dict[str, Any]:
    """
    Create a standardized success response dictionary.

    Args:
        message: Success message (default: "ok")
        **kwargs: Additional key-value pairs to include in the response

    Returns:
        Dictionary with status and any additional provided fields
    """
    return {"status": message, **kwargs}
