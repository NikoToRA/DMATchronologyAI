"""
API router package.

This package contains all FastAPI router modules for the ChronologyAI backend,
including session management, chronology entries, participants, settings,
and Zoom integration endpoints.
"""

from .chronology import router as chronology_router
from .exceptions import (
    APIException,
    BadRequestException,
    ConflictException,
    NotFoundException,
    ServiceUnavailableException,
    create_success_response,
)
from .participants import router as participants_router
from .sessions import router as sessions_router
from .settings import router as settings_router
from .zoom import router as zoom_router

__all__ = [
    # Routers
    "chronology_router",
    "participants_router",
    "sessions_router",
    "settings_router",
    "zoom_router",
    # Exceptions
    "APIException",
    "BadRequestException",
    "ConflictException",
    "NotFoundException",
    "ServiceUnavailableException",
    # Utilities
    "create_success_response",
]
