"""
Chronology entry management API endpoints.

This module provides endpoints for managing chronology entries within sessions,
including listing, creating, and updating entries with classification and
HQ (headquarters) matching capabilities.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Query

from ..models.schemas import (
    Category,
    ChronologyEntry,
    BaseSchema,
    ChronologyEntryUpdate,
    ChronologyResponse,
    HQMaster,
    Segment,
    Session,
)
from ..services.classifier import classifier_service
from ..services.hq_matcher import hq_matcher_service
from ..services.storage import storage_service
from ..websocket.manager import connection_manager
from .exceptions import NotFoundException


router = APIRouter(
    prefix="/sessions/{session_id}/chronology",
    tags=["chronology"]
)


class ChronologyCreate(BaseSchema):
    """Request body for creating a chronology entry."""

    text_raw: str
    participant_id: Optional[str] = None
    timestamp: Optional[datetime] = None


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


def _build_chronology_response(
    entry: ChronologyEntry,
    hq_master: list[HQMaster]
) -> ChronologyResponse:
    """
    Build a ChronologyResponse with HQ name resolved.

    Args:
        entry: The chronology entry to build response for
        hq_master: List of HQ master records for name lookup

    Returns:
        ChronologyResponse with hq_name included
    """
    hq_name = hq_matcher_service.get_hq_name(entry.hq_id, hq_master)
    return ChronologyResponse(
        **entry.model_dump(),
        hq_name=hq_name
    )


async def _notify_entry_update(
    session_id: str,
    response: ChronologyResponse
) -> None:
    """
    Send WebSocket notification for entry updates.

    Args:
        session_id: The session ID for the notification channel
        response: The chronology response to broadcast
    """
    await connection_manager.notify_new_entry(session_id, response.model_dump())


@router.get("", response_model=list[ChronologyResponse])
async def list_chronology(
    session_id: str,
    category: Optional[Category] = Query(
        None,
        description="Filter by category (e.g., instruction, report, decision)"
    ),
    hq_id: Optional[str] = Query(
        None,
        description="Filter by headquarters ID"
    ),
    unconfirmed_only: bool = Query(
        False,
        description="Show only entries with unconfirmed HQ assignment"
    )
) -> list[ChronologyResponse]:
    """
    Retrieve chronology entries for a session with optional filtering.

    Supports filtering by category, headquarters, and confirmation status.
    Entries are returned with their associated HQ names resolved.

    Args:
        session_id: The unique identifier of the session
        category: Optional filter by entry category
        hq_id: Optional filter by headquarters ID
        unconfirmed_only: If True, only return entries without confirmed HQ

    Returns:
        List of chronology entries matching the filter criteria

    Raises:
        HTTPException: 404 if session not found
    """
    await _get_session_or_raise(session_id)

    entries = await storage_service.get_chronology_entries(session_id)
    hq_master = await storage_service.get_session_hq_master(session_id)

    # Apply filters
    if category:
        entries = [e for e in entries if e.category == category]
    if hq_id:
        entries = [e for e in entries if e.hq_id == hq_id]
    if unconfirmed_only:
        entries = [e for e in entries if not e.is_hq_confirmed]

    return [_build_chronology_response(entry, hq_master) for entry in entries]


@router.post("", response_model=ChronologyResponse, status_code=201)
async def create_chronology_entry(
    session_id: str,
    data: ChronologyCreate = Body(...),
) -> ChronologyResponse:
    """
    Manually create a chronology entry.

    While entries are typically auto-generated from Zoom Bot audio processing,
    this endpoint allows manual entry creation. The entry will be automatically
    classified and summarized using AI services.

    Args:
        session_id: The unique identifier of the session
        text_raw: The raw text content of the entry
        participant_id: Optional participant ID to associate with the entry
        timestamp: Optional timestamp (defaults to current UTC time)

    Returns:
        The newly created chronology entry with classification and summary

    Raises:
        HTTPException: 404 if session not found
    """
    await _get_session_or_raise(session_id)

    # Resolve HQ ID from participant if provided
    hq_id: Optional[str] = None
    if data.participant_id:
        participant = await storage_service.get_participant(session_id, data.participant_id)
        if participant:
            hq_id = participant.hq_id

    # Perform AI classification and summarization
    hq_master = await storage_service.get_session_hq_master(session_id)
    hq_name = hq_matcher_service.get_hq_name(hq_id, hq_master)
    category, summary, ai_note = await classifier_service.classify_and_summarize(
        data.text_raw, hq_name
    )

    # Create and save entry
    entry = ChronologyEntry(
        segment_id="manual",
        hq_id=hq_id,
        timestamp=data.timestamp or datetime.utcnow(),
        category=category,
        summary=summary,
        text_raw=data.text_raw,
        ai_note=ai_note,
        participant_id=data.participant_id,
        is_hq_confirmed=bool(hq_id),
        has_task=category in (Category.INSTRUCTION, Category.REQUEST),
    )
    created = await storage_service.save_chronology_entry(session_id, entry)

    response = _build_chronology_response(created, hq_master)
    await _notify_entry_update(session_id, response)

    return response


@router.patch("/{entry_id}", response_model=ChronologyResponse)
async def update_chronology_entry(
    session_id: str,
    entry_id: str,
    data: ChronologyEntryUpdate
) -> ChronologyResponse:
    """
    Update a chronology entry.

    Allows modification of entry classification, summary, HQ assignment,
    and confirmation status. Only provided fields are updated.

    Args:
        session_id: The unique identifier of the session
        entry_id: The unique identifier of the entry to update
        data: Fields to update (category, summary, hq_id, is_hq_confirmed)

    Returns:
        The updated chronology entry

    Raises:
        HTTPException: 404 if session or entry not found
    """
    await _get_session_or_raise(session_id)

    updates = data.model_dump(exclude_unset=True)
    entry = await storage_service.update_chronology_entry(
        session_id, entry_id, updates
    )
    if not entry:
        raise NotFoundException("Chronology entry", entry_id)

    hq_master = await storage_service.get_session_hq_master(session_id)
    response = _build_chronology_response(entry, hq_master)
    await _notify_entry_update(session_id, response)

    return response


@router.delete("/{entry_id}", status_code=204)
async def delete_chronology_entry(
    session_id: str,
    entry_id: str,
) -> None:
    """
    Delete a chronology entry.

    Args:
        session_id: The unique identifier of the session
        entry_id: The unique identifier of the entry to delete

    Raises:
        HTTPException: 404 if session or entry not found
    """
    await _get_session_or_raise(session_id)

    deleted = await storage_service.delete_chronology_entry(session_id, entry_id)
    if not deleted:
        raise NotFoundException("Chronology entry", entry_id)


@router.get("/segments", response_model=list[Segment])
async def list_segments(session_id: str) -> list[Segment]:
    """
    Retrieve raw audio segments (transcription logs) for a session.

    Segments represent the raw transcribed audio data before processing
    into chronology entries. Useful for debugging or reviewing original
    transcriptions.

    Args:
        session_id: The unique identifier of the session

    Returns:
        List of raw transcription segments

    Raises:
        HTTPException: 404 if session not found
    """
    await _get_session_or_raise(session_id)

    segments = await storage_service.get_segments(session_id)
    return segments
