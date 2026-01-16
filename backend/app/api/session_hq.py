"""
Session-scoped HQ master API endpoints.

HQ master differs per disaster/session in real operations. This router provides
CRUD endpoints for an HQ list that is isolated per session.
"""

from typing import Any

from fastapi import APIRouter

from ..models.schemas import HQMaster, HQMasterCreate, Session
from ..services.storage import storage_service
from .exceptions import NotFoundException, create_success_response


router = APIRouter(prefix="/sessions/{session_id}/hq", tags=["hq"])


async def _get_session_or_raise(session_id: str) -> Session:
    session = await storage_service.get_session(session_id)
    if not session:
        raise NotFoundException("Session", session_id)
    return session


@router.get("", response_model=list[HQMaster])
async def list_session_hq_master(session_id: str) -> list[HQMaster]:
    """List session-scoped HQ master."""
    await _get_session_or_raise(session_id)
    return await storage_service.get_session_hq_master(session_id)


@router.post("", response_model=HQMaster, status_code=201)
async def create_session_hq(session_id: str, data: HQMasterCreate) -> HQMaster:
    """Create a new HQ in this session's HQ master."""
    await _get_session_or_raise(session_id)
    hq = HQMaster(hq_name=data.hq_name, zoom_pattern=data.zoom_pattern, active=data.active)
    return await storage_service.add_session_hq(session_id, hq)


@router.patch("/{hq_id}", response_model=HQMaster)
async def update_session_hq(session_id: str, hq_id: str, data: dict[str, Any]) -> HQMaster:
    """Update a session-scoped HQ."""
    await _get_session_or_raise(session_id)
    hq = await storage_service.update_session_hq(session_id, hq_id, data)
    if not hq:
        raise NotFoundException("HQ", hq_id)
    return hq


@router.delete("/{hq_id}")
async def delete_session_hq(session_id: str, hq_id: str) -> dict[str, str]:
    """Delete a session-scoped HQ."""
    await _get_session_or_raise(session_id)
    success = await storage_service.delete_session_hq(session_id, hq_id)
    if not success:
        raise NotFoundException("HQ", hq_id)
    return create_success_response()

