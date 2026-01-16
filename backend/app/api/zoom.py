"""
Zoom integration API endpoints.

This module provides endpoints for Zoom Meeting Bot operations including
joining/leaving meetings, receiving audio data, handling participant events,
and generating SDK tokens.
"""

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, File, Form, UploadFile

from ..models.schemas import Participant
from ..services.zoom_bot import zoom_bot_service
from .exceptions import (
    BadRequestException,
    ServiceUnavailableException,
    create_success_response,
)


router = APIRouter(prefix="/zoom", tags=["zoom"])


def _parse_timestamp(timestamp_str: Optional[str]) -> Optional[datetime]:
    """
    Parse an ISO format timestamp string.

    Args:
        timestamp_str: Optional ISO format timestamp string

    Returns:
        Parsed datetime or None if parsing fails or input is None
    """
    if not timestamp_str:
        return None
    try:
        return datetime.fromisoformat(timestamp_str)
    except ValueError:
        return None


# =============================================================================
# Meeting Management
# =============================================================================

@router.post("/join/{session_id}")
async def join_meeting(
    session_id: str,
    meeting_id: str
) -> dict[str, str]:
    """
    Initiate joining a Zoom meeting.

    Starts the process of joining a Zoom meeting via the SDK.
    The actual SDK connection happens in a separate process.

    Args:
        session_id: The session ID to associate with this meeting
        meeting_id: The Zoom meeting ID to join

    Returns:
        Status confirmation with session and meeting IDs

    Raises:
        HTTPException: 400 if joining fails (usually credential issues)
    """
    success = await zoom_bot_service.join_meeting(session_id, meeting_id)
    if not success:
        raise BadRequestException(
            "Failed to join meeting. Check Zoom credentials."
        )
    return create_success_response(
        message="joining",
        session_id=session_id,
        meeting_id=meeting_id
    )


@router.post("/leave/{session_id}")
async def leave_meeting(session_id: str) -> dict[str, str]:
    """
    Leave a Zoom meeting.

    Gracefully disconnects the bot from the Zoom meeting.

    Args:
        session_id: The session ID associated with the meeting

    Returns:
        Status confirmation with session ID
    """
    await zoom_bot_service.leave_meeting(session_id)
    return create_success_response(message="left", session_id=session_id)


# =============================================================================
# Audio Processing
# =============================================================================

def _detect_audio_format(filename: Optional[str], content_type: Optional[str]) -> str:
    """
    Detect audio format from filename or content type.

    Args:
        filename: Original filename of the upload.
        content_type: MIME content type of the upload.

    Returns:
        Audio format string (wav, webm, mp3, etc.).
    """
    # Check filename extension first
    if filename:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext in ("wav", "webm", "mp3", "ogg", "m4a"):
            return ext

    # Fallback to content type
    if content_type:
        type_map = {
            "audio/wav": "wav",
            "audio/wave": "wav",
            "audio/x-wav": "wav",
            "audio/webm": "webm",
            "audio/mp3": "mp3",
            "audio/mpeg": "mp3",
            "audio/ogg": "ogg",
            "audio/mp4": "m4a",
            "audio/x-m4a": "m4a",
        }
        return type_map.get(content_type, "wav")

    return "wav"


@router.post("/audio/{session_id}")
async def receive_audio(
    session_id: str,
    participant_id: str = Form(..., description="ID of the speaking participant"),
    audio: UploadFile = File(..., description="Audio chunk file (10-20 seconds)"),
    timestamp: Optional[str] = Form(
        None,
        description="ISO format timestamp of the audio chunk"
    )
) -> dict[str, Any]:
    """
    Receive and process audio data from Zoom SDK client or browser recording.

    Receives 10-20 second audio chunks from the Zoom SDK client or browser,
    processes them through STT (Speech-to-Text), classifies the content,
    and stores the resulting chronology entry.

    Supported audio formats: WAV, WebM, MP3, OGG, M4A.
    Non-WAV formats are automatically converted.

    Args:
        session_id: The session ID for this audio
        participant_id: ID of the participant who is speaking
        audio: The audio file data
        timestamp: Optional timestamp when the audio was recorded

    Returns:
        Processing status confirmation
    """
    audio_data = await audio.read()
    parsed_timestamp = _parse_timestamp(timestamp)

    # Detect audio format
    audio_format = _detect_audio_format(audio.filename, audio.content_type)

    result = await zoom_bot_service.process_audio_chunk(
        session_id=session_id,
        audio_data=audio_data,
        participant_id=participant_id,
        timestamp=parsed_timestamp,
        audio_format=audio_format,
    )

    # Return structured debug info so caller can see where it stalled
    return {"message": "processed" if result.get("ok") else "skipped", **result}


# =============================================================================
# Participant Events
# =============================================================================

@router.post("/participant/join/{session_id}")
async def participant_joined(
    session_id: str,
    zoom_display_name: str,
    zoom_user_id: str = ""
) -> dict[str, Any]:
    """
    Handle participant join event webhook.

    Called when a participant joins the Zoom meeting. Creates a participant
    record and attempts to match them to an HQ based on display name patterns.

    Args:
        session_id: The session ID for this meeting
        zoom_display_name: The participant's Zoom display name
        zoom_user_id: Optional Zoom user ID

    Returns:
        Status with the created participant's ID
    """
    participant: Participant = await zoom_bot_service.handle_participant_join(
        session_id=session_id,
        zoom_display_name=zoom_display_name,
        zoom_user_id=zoom_user_id
    )
    return create_success_response(participant_id=participant.participant_id)


@router.post("/participant/leave/{session_id}")
async def participant_left(
    session_id: str,
    participant_id: str
) -> dict[str, str]:
    """
    Handle participant leave event webhook.

    Called when a participant leaves the Zoom meeting. Updates the
    participant's status and records the leave timestamp.

    Args:
        session_id: The session ID for this meeting
        participant_id: The ID of the participant who left

    Returns:
        Status confirmation
    """
    await zoom_bot_service.handle_participant_leave(session_id, participant_id)
    return create_success_response()


# =============================================================================
# SDK Token Generation
# =============================================================================

@router.get("/sdk-token")
async def get_sdk_token(
    meeting_number: str,
    role: int = 0
) -> dict[str, str]:
    """
    Generate a Meeting SDK JWT token.

    Creates a JWT token for authenticating with the Zoom Meeting SDK.

    Args:
        meeting_number: The Zoom meeting number to generate token for
        role: SDK role (0 = participant, 1 = host)

    Returns:
        Dictionary containing the generated JWT token

    Raises:
        HTTPException: 503 if Zoom credentials are not configured
    """
    token = zoom_bot_service.generate_sdk_jwt(meeting_number, role)
    if not token:
        raise ServiceUnavailableException(
            "Zoom SDK",
            "Zoom credentials not configured"
        )
    return {"token": token}
