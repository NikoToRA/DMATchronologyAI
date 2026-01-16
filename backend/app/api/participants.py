"""
Participant management API endpoints.

This module provides endpoints for managing session participants including
listing, adding, updating, and handling participant leave events.
Participants are automatically matched to headquarters based on their
Zoom display names.
"""

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter

from ..models.schemas import (
    ConnectionStatus,
    HQMaster,
    IdentificationStatus,
    Participant,
    ParticipantCreate,
    ParticipantResponse,
    ParticipantUpdate,
    Session,
)
from ..services.hq_matcher import hq_matcher_service
from ..services.storage import storage_service
from ..websocket.manager import connection_manager
from .exceptions import NotFoundException, create_success_response


router = APIRouter(
    prefix="/sessions/{session_id}/participants",
    tags=["participants"]
)


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


def _determine_identification_status(hq_id: Optional[str]) -> IdentificationStatus:
    """
    Determine identification status based on HQ assignment.

    Args:
        hq_id: The headquarters ID if assigned

    Returns:
        CONFIRMED if HQ is assigned, UNCONFIRMED otherwise
    """
    return (
        IdentificationStatus.CONFIRMED if hq_id
        else IdentificationStatus.UNCONFIRMED
    )


def _build_participant_response(
    participant: Participant,
    hq_master: list[HQMaster],
    last_speech_at: Optional[datetime] = None
) -> ParticipantResponse:
    """
    Build a ParticipantResponse with resolved HQ information.

    Args:
        participant: The participant object to build response for
        hq_master: List of HQ master records for name lookup
        last_speech_at: Optional timestamp of participant's last speech

    Returns:
        ParticipantResponse with HQ name and identification status
    """
    hq_name = hq_matcher_service.get_hq_name(participant.hq_id, hq_master)
    identification_status = _determine_identification_status(participant.hq_id)

    return ParticipantResponse(
        **participant.model_dump(),
        hq_name=hq_name,
        identification_status=identification_status,
        last_speech_at=last_speech_at
    )


async def _notify_participant_update(
    session_id: str,
    data: dict[str, Any]
) -> None:
    """
    Send WebSocket notification for participant updates.

    Args:
        session_id: The session ID for the notification channel
        data: The participant data to broadcast
    """
    await connection_manager.notify_participant_update(session_id, data)


@router.get("", response_model=list[ParticipantResponse])
async def list_participants(session_id: str) -> list[ParticipantResponse]:
    """
    Retrieve all participants for a session.

    Returns participants with their HQ assignments, identification status,
    and last speech timestamps calculated from chronology entries.

    Args:
        session_id: The unique identifier of the session

    Returns:
        List of participants with enriched metadata

    Raises:
        HTTPException: 404 if session not found
    """
    await _get_session_or_raise(session_id)

    participants = await storage_service.get_participants(session_id)
    hq_master = await storage_service.get_session_hq_master(session_id)
    entries = await storage_service.get_chronology_entries(session_id)

    response: list[ParticipantResponse] = []
    for participant in participants:
        # Calculate last speech timestamp from entries
        participant_entries = [
            e for e in entries if e.hq_id == participant.hq_id
        ]
        last_speech_at: Optional[datetime] = None
        if participant_entries:
            last_speech_at = max(e.timestamp for e in participant_entries)

        response.append(_build_participant_response(
            participant, hq_master, last_speech_at
        ))

    return response


@router.post("", response_model=ParticipantResponse, status_code=201)
async def add_participant(
    session_id: str,
    data: ParticipantCreate
) -> ParticipantResponse:
    """
    Add a new participant to a session.

    Typically called when a user joins the Zoom meeting or when manually
    adding a participant for browser-based recording. The participant
    is automatically matched to an HQ based on their display name pattern
    unless an hq_id is explicitly provided.

    Args:
        session_id: The unique identifier of the session
        data: Participant data including zoom_display_name and optional hq_id

    Returns:
        The created participant with HQ matching results

    Raises:
        HTTPException: 404 if session not found
    """
    await _get_session_or_raise(session_id)

    # Use provided hq_id or attempt HQ matching based on display name
    hq_master = await storage_service.get_session_hq_master(session_id)
    hq_id = data.hq_id
    if not hq_id:
        hq_id = hq_matcher_service.match_hq(data.zoom_display_name, hq_master)

    participant = Participant(
        zoom_display_name=data.zoom_display_name,
        hq_id=hq_id,
        connection_status=ConnectionStatus.JOINED
    )

    created = await storage_service.add_participant(session_id, participant)
    response = _build_participant_response(created, hq_master)

    await _notify_participant_update(session_id, response.model_dump())

    return response


@router.patch("/{participant_id}", response_model=ParticipantResponse)
async def update_participant(
    session_id: str,
    participant_id: str,
    data: ParticipantUpdate
) -> ParticipantResponse:
    """
    Update participant information.

    Allows modification of HQ assignment, declaration status, and
    connection status. Only provided fields are updated.

    Args:
        session_id: The unique identifier of the session
        participant_id: The unique identifier of the participant
        data: Fields to update (hq_id, is_declared, leave_at, connection_status)

    Returns:
        The updated participant information

    Raises:
        HTTPException: 404 if session or participant not found
    """
    await _get_session_or_raise(session_id)

    updates = data.model_dump(exclude_unset=True)
    participant = await storage_service.update_participant(
        session_id, participant_id, updates
    )
    if not participant:
        raise NotFoundException("Participant", participant_id)

    hq_master = await storage_service.get_session_hq_master(session_id)
    response = _build_participant_response(participant, hq_master)

    await _notify_participant_update(session_id, response.model_dump())

    return response


@router.post("/{participant_id}/leave")
async def participant_leave(
    session_id: str,
    participant_id: str
) -> dict[str, str]:
    """
    Mark a participant as having left the session.

    Updates the participant's connection status to LEFT and records
    the leave timestamp.

    Args:
        session_id: The unique identifier of the session
        participant_id: The unique identifier of the participant

    Returns:
        Success confirmation

    Raises:
        HTTPException: 404 if participant not found
    """
    updates = {
        "leave_at": datetime.utcnow(),
        "connection_status": ConnectionStatus.LEFT
    }
    participant = await storage_service.update_participant(
        session_id, participant_id, updates
    )
    if not participant:
        raise NotFoundException("Participant", participant_id)

    # Send WebSocket notification
    hq_master = await storage_service.get_session_hq_master(session_id)
    hq_name = hq_matcher_service.get_hq_name(participant.hq_id, hq_master)

    await _notify_participant_update(
        session_id,
        {
            **participant.model_dump(),
            "hq_name": hq_name
        }
    )

    return create_success_response()
