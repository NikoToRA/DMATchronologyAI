"""
Session management API endpoints.

This module provides endpoints for creating, reading, updating, and managing
training sessions including lifecycle operations (start, end).
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query

from ..models.schemas import (
    Session,
    SessionCreate,
    SessionResponse,
    SessionKind,
    SessionStatus,
    SessionUpdate,
)
from ..services.storage import storage_service
from .exceptions import NotFoundException


router = APIRouter(prefix="/sessions", tags=["sessions"])


async def _get_session_or_raise(session_id: str) -> Session:
    """
    Retrieve a session by ID or raise NotFoundException.

    Args:
        session_id: The unique identifier of the session

    Returns:
        The session object if found

    Raises:
        NotFoundException: If the session does not exist
    """
    session = await storage_service.get_session(session_id)
    if not session:
        raise NotFoundException("Session", session_id)
    return session


async def _build_session_response(session: Session) -> SessionResponse:
    """
    Build a SessionResponse with participant and entry counts.

    Args:
        session: The session object to build response for

    Returns:
        SessionResponse with aggregated counts
    """
    participants = await storage_service.get_participants(session.session_id)
    entries = await storage_service.get_chronology_entries(session.session_id)
    return SessionResponse(
        **session.model_dump(),
        participant_count=len(participants),
        entry_count=len(entries)
    )


@router.get("", response_model=list[SessionResponse])
async def list_sessions(
    status: Optional[SessionStatus] = Query(
        None,
        description="Filter sessions by status (waiting, running, ended)"
    )
) -> list[SessionResponse]:
    """
    Retrieve a list of all sessions with optional status filtering.

    Returns sessions with their associated participant and entry counts.
    Sessions are returned in creation order.

    Args:
        status: Optional filter to only return sessions with a specific status

    Returns:
        List of sessions with participant_count and entry_count included
    """
    sessions = await storage_service.list_sessions()

    if status:
        sessions = [s for s in sessions if s.status == status]

    response: list[SessionResponse] = []
    for session in sessions:
        session_response = await _build_session_response(session)
        response.append(session_response)

    return response


@router.post("", response_model=Session, status_code=201)
async def create_session(data: SessionCreate) -> Session:
    """
    Create a new training session.

    A new session starts in 'waiting' status and can be started
    using the /start endpoint when ready.

    Args:
        data: Session creation data including title and optional fields

    Returns:
        The newly created session object with generated session_id
    """
    # Compose a human-friendly title: "<incident_name> <YYYY/MM/DD> <kind label>"
    kind_label_map: dict[SessionKind, str] = {
        SessionKind.ACTIVITY_COMMAND: "活動指揮",
        SessionKind.TRANSPORT_COORDINATION: "搬送調整",
        SessionKind.INFO_ANALYSIS: "情報分析",
        SessionKind.LOGISTICS_SUPPORT: "物資支援",
    }
    local_date = (data.incident_date or datetime.utcnow().date()).strftime("%Y/%m/%d")
    title = f"{data.incident_name} {local_date} {kind_label_map[data.session_kind]}"

    session = Session(
        title=title,
        session_kind=data.session_kind,
        incident_name=data.incident_name,
        incident_date=data.incident_date,
        incident_id=data.incident_id,
        zoom_meeting_id=data.zoom_meeting_id,
    )
    created = await storage_service.create_session(session)
    return created


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str) -> SessionResponse:
    """
    Retrieve detailed information about a specific session.

    Args:
        session_id: The unique identifier of the session to retrieve

    Returns:
        Session details including participant and entry counts

    Raises:
        HTTPException: 404 if session not found
    """
    session = await _get_session_or_raise(session_id)
    return await _build_session_response(session)


@router.patch("/{session_id}", response_model=Session)
async def update_session(session_id: str, data: SessionUpdate) -> Session:
    """
    Update session properties.

    Only provided fields will be updated; omitted fields remain unchanged.

    Args:
        session_id: The unique identifier of the session to update
        data: Fields to update (title, disaster_type, status, zoom_meeting_id, end_at)

    Returns:
        The updated session object

    Raises:
        HTTPException: 404 if session not found
    """
    updates = data.model_dump(exclude_unset=True)
    session = await storage_service.update_session(session_id, updates)
    if not session:
        raise NotFoundException("Session", session_id)
    return session


@router.post("/{session_id}/start", response_model=Session)
async def start_session(session_id: str) -> Session:
    """
    Start a training session.

    Transitions the session from 'waiting' to 'running' status
    and records the start timestamp.

    Args:
        session_id: The unique identifier of the session to start

    Returns:
        The updated session with status='running' and start_at timestamp

    Raises:
        HTTPException: 404 if session not found
    """
    session = await storage_service.update_session(
        session_id,
        {"status": SessionStatus.RUNNING, "start_at": datetime.utcnow()}
    )
    if not session:
        raise NotFoundException("Session", session_id)
    return session


@router.post("/{session_id}/end", response_model=Session)
async def end_session(session_id: str) -> Session:
    """
    End a training session.

    Transitions the session to 'ended' status and records the end timestamp.

    Args:
        session_id: The unique identifier of the session to end

    Returns:
        The updated session with status='ended' and end_at timestamp

    Raises:
        HTTPException: 404 if session not found
    """
    session = await storage_service.update_session(
        session_id,
        {"status": SessionStatus.ENDED, "end_at": datetime.utcnow()}
    )
    if not session:
        raise NotFoundException("Session", session_id)
    return session


@router.delete("/{session_id}")
async def delete_session(session_id: str) -> dict[str, str]:
    """
    Delete a session and all its associated data.

    This permanently removes the session, including all participants,
    chronology entries, and segments.

    Args:
        session_id: The unique identifier of the session to delete

    Returns:
        Confirmation message

    Raises:
        HTTPException: 404 if session not found
    """
    success = await storage_service.delete_session(session_id)
    if not success:
        raise NotFoundException("Session", session_id)
    return {"message": f"Session {session_id} deleted successfully"}


@router.post("/{session_id}/clear")
async def clear_session_data(session_id: str) -> dict[str, str]:
    """
    Clear all participants and chronology entries from a session.

    The session itself is preserved, only the data within is removed.

    Args:
        session_id: The unique identifier of the session

    Returns:
        Confirmation message

    Raises:
        HTTPException: 404 if session not found
    """
    success = await storage_service.clear_session_data(session_id)
    if not success:
        raise NotFoundException("Session", session_id)
    return {"message": f"Session {session_id} data cleared successfully"}
