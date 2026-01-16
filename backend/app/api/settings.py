"""
System settings and configuration API endpoints.

This module provides endpoints for managing system-wide settings including
Zoom API credentials, HQ (headquarters) master data, and system status checks.
"""

from typing import Any

from fastapi import APIRouter

from ..models.schemas import (
    HQMaster,
    HQMasterCreate,
    ZoomCredentials,
    ZoomCredentialsUpdate,
)
from ..services.storage import storage_service
from .exceptions import NotFoundException, create_success_response


router = APIRouter(prefix="/settings", tags=["settings"])


# =============================================================================
# Zoom Credentials Management
# =============================================================================

def _mask_secret(secret: str) -> str:
    """
    Mask a secret value for secure display.

    Args:
        secret: The secret string to mask

    Returns:
        Masked string "********" if secret exists, empty string otherwise
    """
    return "********" if secret else ""


@router.get("/zoom", response_model=ZoomCredentials)
async def get_zoom_credentials() -> ZoomCredentials:
    """
    Retrieve Zoom API configuration.

    The client_secret is always masked in the response for security.

    Returns:
        Zoom credentials with masked secret
    """
    credentials = await storage_service.get_zoom_credentials()
    if credentials.client_secret:
        credentials.client_secret = _mask_secret(credentials.client_secret)
    return credentials


@router.put("/zoom", response_model=ZoomCredentials)
async def update_zoom_credentials(data: ZoomCredentialsUpdate) -> ZoomCredentials:
    """
    Update Zoom API configuration.

    Only provided fields are updated. The 'configured' flag is automatically
    set to True when all required fields (client_id, client_secret, account_id)
    are present.

    Args:
        data: Fields to update (client_id, client_secret, account_id)

    Returns:
        Updated credentials with masked secret
    """
    current = await storage_service.get_zoom_credentials()

    # Apply updates for provided fields only
    if data.client_id is not None:
        current.client_id = data.client_id
    if data.client_secret is not None:
        current.client_secret = data.client_secret
    if data.account_id is not None:
        current.account_id = data.account_id

    # Auto-set configured flag based on field completeness
    current.configured = bool(
        current.client_id and
        current.client_secret and
        current.account_id
    )

    await storage_service.save_zoom_credentials(current)

    # Mask secret before returning
    current.client_secret = _mask_secret(current.client_secret)
    return current


# =============================================================================
# HQ Master Data Management
# =============================================================================

@router.get("/hq", response_model=list[HQMaster])
async def list_hq_master() -> list[HQMaster]:
    """
    Retrieve the list of headquarters master data.

    HQ master data is used for matching Zoom participants to their
    respective headquarters based on display name patterns.

    Returns:
        List of all headquarters records
    """
    return await storage_service.get_hq_master()


@router.post("/hq", response_model=HQMaster, status_code=201)
async def create_hq(data: HQMasterCreate) -> HQMaster:
    """
    Create a new headquarters record.

    The zoom_pattern field is used for automatic participant-to-HQ matching
    based on Zoom display names.

    Args:
        data: HQ creation data including name, zoom_pattern, and active status

    Returns:
        The newly created HQ record with generated hq_id
    """
    hq = HQMaster(
        hq_name=data.hq_name,
        zoom_pattern=data.zoom_pattern,
        active=data.active
    )
    return await storage_service.add_hq(hq)


@router.patch("/hq/{hq_id}", response_model=HQMaster)
async def update_hq(hq_id: str, data: dict[str, Any]) -> HQMaster:
    """
    Update a headquarters record.

    Args:
        hq_id: The unique identifier of the HQ to update
        data: Fields to update (hq_name, zoom_pattern, active)

    Returns:
        The updated HQ record

    Raises:
        HTTPException: 404 if HQ not found
    """
    hq = await storage_service.update_hq(hq_id, data)
    if not hq:
        raise NotFoundException("HQ", hq_id)
    return hq


@router.delete("/hq/{hq_id}")
async def delete_hq(hq_id: str) -> dict[str, str]:
    """
    Delete a headquarters record.

    Args:
        hq_id: The unique identifier of the HQ to delete

    Returns:
        Success confirmation message

    Raises:
        HTTPException: 404 if HQ not found
    """
    success = await storage_service.delete_hq(hq_id)
    if not success:
        raise NotFoundException("HQ", hq_id)
    return create_success_response()


# =============================================================================
# System Status
# =============================================================================

@router.get("/status")
async def get_system_status() -> dict[str, Any]:
    """
    Retrieve system configuration and service status.

    Checks the configuration status of all required services:
    - Zoom API credentials
    - Speech-to-Text (STT) service
    - OpenAI/Classifier service
    - Storage backend type

    Returns:
        Dictionary with configuration status for each service
    """
    # Import here to avoid circular imports
    from ..services.classifier import classifier_service
    from ..services.stt import stt_service

    zoom_credentials = await storage_service.get_zoom_credentials()

    return {
        "zoom_configured": zoom_credentials.configured,
        "stt_configured": stt_service.is_configured(),
        "openai_configured": classifier_service.is_configured(),
        "storage_type": "azure" if storage_service.use_azure else "local"
    }
