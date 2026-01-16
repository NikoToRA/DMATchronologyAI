"""
Zoom Bot Service Module

Provides Zoom Meeting SDK integration for joining meetings, capturing audio,
and orchestrating the speech-to-text and classification pipeline.
"""

import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

import httpx
import jwt

from ..config import settings
import io
import wave
from ..models.schemas import (
    ChronologyEntry,
    ConnectionStatus,
    Category,
    HQMaster,
    Participant,
    Segment,
    Session,
    SessionStatus,
)
from ..services.audio_converter import audio_converter, AudioConversionError
from ..services.classifier import classifier_service
from ..services.hq_matcher import hq_matcher_service
from ..services.silence_filter import silence_filter
from ..services.storage import storage_service
from ..services.stt import stt_service
from ..websocket.manager import connection_manager

logger = logging.getLogger(__name__)


class ZoomBotError(Exception):
    """Base exception for Zoom Bot operations."""

    pass


class ZoomAuthenticationError(ZoomBotError):
    """Exception raised when Zoom authentication fails."""

    pass


class ZoomMeetingError(ZoomBotError):
    """Exception raised when meeting operations fail."""

    pass


@dataclass
class ZoomBotConfig:
    """
    Configuration for Zoom Bot authentication.

    Attributes:
        client_id: Zoom OAuth client ID.
        client_secret: Zoom OAuth client secret.
        account_id: Zoom account ID for Server-to-Server OAuth.
    """

    client_id: str
    client_secret: str
    account_id: str


class ZoomBotService:
    """
    Zoom Meeting SDK integration service.

    This service manages Zoom meeting participation and orchestrates the
    audio processing pipeline:
    1. Join/leave meetings
    2. Receive audio chunks
    3. Filter silence
    4. Transcribe speech (STT)
    5. Classify and summarize
    6. Store chronology entries
    7. Notify connected clients via WebSocket

    Note:
        The actual Zoom Meeting SDK runs in a separate process (Node.js/Electron).
        This service handles the backend API and data processing logic.

    Attributes:
        active_sessions: Dictionary of currently active meeting sessions.

    Example:
        >>> bot = ZoomBotService()
        >>> await bot.join_meeting(session_id, meeting_id)
        >>> await bot.process_audio_chunk(session_id, audio_bytes, participant_id)
    """

    # JWT token validity duration (2 hours)
    _JWT_EXPIRY_SECONDS: int = 60 * 60 * 2

    # Zoom OAuth token endpoint
    _ZOOM_TOKEN_URL: str = "https://zoom.us/oauth/token"

    def __init__(self) -> None:
        """Initialize the Zoom Bot service."""
        self.active_sessions: Dict[str, Dict[str, Any]] = {}
        self._credentials: Optional[ZoomBotConfig] = None
        logger.info("ZoomBotService initialized")

    async def _get_credentials(self) -> Optional[ZoomBotConfig]:
        """
        Get Zoom API credentials from storage.

        Credentials are cached after first retrieval.

        Returns:
            ZoomBotConfig if configured, None otherwise.
        """
        if self._credentials is None:
            try:
                creds = await storage_service.get_zoom_credentials()
                if creds.configured:
                    self._credentials = ZoomBotConfig(
                        client_id=creds.client_id,
                        client_secret=creds.client_secret,
                        account_id=creds.account_id,
                    )
                    logger.debug("Zoom credentials loaded from storage")
                else:
                    logger.warning("Zoom credentials not configured")
            except Exception as e:
                logger.error(f"Failed to load Zoom credentials: {e}")
        return self._credentials

    async def get_access_token(self) -> Optional[str]:
        """
        Get Zoom API access token using Server-to-Server OAuth.

        Returns:
            Access token string if successful, None otherwise.

        Raises:
            ZoomAuthenticationError: If authentication fails.
        """
        creds = await self._get_credentials()
        if creds is None:
            logger.warning("Cannot get access token: credentials not configured")
            return None

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self._ZOOM_TOKEN_URL,
                    params={
                        "grant_type": "account_credentials",
                        "account_id": creds.account_id,
                    },
                    auth=(creds.client_id, creds.client_secret),
                    timeout=30.0,
                )

                if response.status_code == 200:
                    token = response.json().get("access_token")
                    logger.debug("Successfully obtained Zoom access token")
                    return token
                else:
                    logger.error(
                        f"Zoom OAuth failed: {response.status_code} - {response.text}"
                    )
                    return None

        except httpx.TimeoutException:
            logger.error("Zoom OAuth request timed out")
            return None
        except httpx.RequestError as e:
            logger.error(f"Zoom OAuth request error: {e}")
            return None

    def generate_sdk_jwt(
        self,
        meeting_number: str,
        role: int = 0,
    ) -> Optional[str]:
        """
        Generate JWT for Zoom Meeting SDK authentication.

        Args:
            meeting_number: The Zoom meeting ID.
            role: Participant role (0=participant, 1=host).

        Returns:
            JWT token string if credentials available, None otherwise.

        Note:
            This JWT is used by the Meeting SDK (separate process) to
            join meetings, not for API calls.
        """
        if self._credentials is None:
            logger.warning("Cannot generate SDK JWT: credentials not loaded")
            return None

        iat = int(time.time())
        exp = iat + self._JWT_EXPIRY_SECONDS

        payload = {
            "sdkKey": self._credentials.client_id,
            "mn": meeting_number,
            "role": role,
            "iat": iat,
            "exp": exp,
            "tokenExp": exp,
        }

        try:
            token = jwt.encode(
                payload,
                self._credentials.client_secret,
                algorithm="HS256",
            )
            logger.debug(f"Generated SDK JWT for meeting {meeting_number}")
            return token
        except Exception as e:
            logger.error(f"Failed to generate SDK JWT: {e}")
            return None

    async def join_meeting(
        self,
        session_id: str,
        meeting_id: str,
    ) -> bool:
        """
        Join a Zoom meeting.

        Updates session status and initializes tracking for the meeting.
        The actual Zoom SDK join is performed by a separate process.

        Args:
            session_id: The session ID to associate with this meeting.
            meeting_id: The Zoom meeting ID to join.

        Returns:
            True if successfully prepared for joining, False otherwise.
        """
        creds = await self._get_credentials()
        if creds is None:
            logger.error("Cannot join meeting: Zoom credentials not configured")
            return False

        try:
            # Update session status
            await storage_service.update_session(
                session_id,
                {
                    "status": SessionStatus.RUNNING,
                    "zoom_meeting_id": meeting_id,
                    "start_at": datetime.utcnow(),
                },
            )

            # Initialize active session tracking
            self.active_sessions[session_id] = {
                "meeting_id": meeting_id,
                "started_at": datetime.utcnow(),
                "audio_buffer": bytearray(),
            }

            logger.info(
                f"Prepared to join meeting {meeting_id} for session {session_id}"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to prepare meeting join: {e}")
            return False

    async def leave_meeting(self, session_id: str) -> None:
        """
        Leave a Zoom meeting.

        Cleans up session tracking and updates status.

        Args:
            session_id: The session ID to leave.
        """
        if session_id in self.active_sessions:
            del self.active_sessions[session_id]
            logger.debug(f"Removed active session: {session_id}")

        try:
            await storage_service.update_session(
                session_id,
                {
                    "status": SessionStatus.ENDED,
                    "end_at": datetime.utcnow(),
                },
            )
            logger.info(f"Left meeting for session {session_id}")
        except Exception as e:
            logger.error(f"Error updating session on leave: {e}")

    async def process_audio_chunk(
        self,
        session_id: str,
        audio_data: bytes,
        participant_id: str,
        timestamp: Optional[datetime] = None,
        audio_format: str = "wav",
    ) -> Dict[str, Any]:
        """
        Process an audio chunk through the full pipeline.

        Pipeline steps:
        1. Audio format conversion (if needed)
        2. Silence detection
        3. Participant lookup
        4. Audio storage
        5. Speech-to-text transcription
        6. HQ declaration detection (if HQ not set)
        7. Classification and summarization
        8. Chronology entry creation
        9. WebSocket notification

        Args:
            session_id: The session this audio belongs to.
            audio_data: Audio bytes to process (any supported format).
            participant_id: ID of the speaking participant.
            timestamp: Optional timestamp (defaults to current UTC time).
            audio_format: Format of audio data (wav, webm, mp3, etc.).

        Note:
            This method is designed to be called at 10-20 second intervals.
            Silent segments are filtered out early to avoid unnecessary processing.
        """
        if timestamp is None:
            timestamp = datetime.utcnow()

        def _is_wav(data: bytes) -> bool:
            return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"

        result: Dict[str, Any] = {
            "ok": False,
            "stage": "start",
            "session_id": session_id,
            "participant_id": participant_id,
            "audio_format": audio_format,
            "timestamp": timestamp.isoformat(),
        }
        # Helpful debug flags for callers (frontend)
        try:
            result["stt_configured"] = bool(getattr(stt_service, "is_configured") and stt_service.is_configured())
        except Exception:
            result["stt_configured"] = False

        # Step 0: Convert to WAV if needed (for processing consistency)
        wav_data = audio_data
        if audio_format != "wav":
            try:
                logger.debug(f"Converting {audio_format} to WAV")
                wav_data = audio_converter.convert_to_wav(audio_data, audio_format)
            except AudioConversionError as e:
                logger.error(f"Audio conversion failed: {e}")
                result.update({"stage": "convert", "error": str(e)})
                return result

        # Validate WAV header (conversion may silently no-op if pydub/ffmpeg missing)
        if not _is_wav(wav_data):
            msg = "Audio is not valid WAV after conversion (pydub/ffmpeg may be missing)."
            logger.error(msg)
            result.update({"stage": "convert", "error": msg})
            return result

        # Step 1: Silence detection (using WAV data)
        is_silent, rms_db = silence_filter.is_silence(wav_data)
        if is_silent:
            logger.debug(
                f"Silence detected (RMS: {rms_db:.1f}dB), skipping segment"
            )
            result.update({"stage": "silence", "rms_db": rms_db, "skipped": True})
            return result
        result["rms_db"] = rms_db
        # WAV debug info (helps diagnose STT issues)
        try:
            with wave.open(io.BytesIO(wav_data), "rb") as wf:
                nframes = wf.getnframes()
                fr = wf.getframerate()
                ch = wf.getnchannels()
                sw = wf.getsampwidth()
                dur_ms = int((nframes / float(fr)) * 1000) if fr else 0
            result.update(
                {
                    "wav_sample_rate": fr,
                    "wav_channels": ch,
                    "wav_sample_width": sw,
                    "wav_duration_ms": dur_ms,
                }
            )
        except Exception:
            pass

        # Step 2: Get participant info
        participant = await storage_service.get_participant(session_id, participant_id)
        if participant is None:
            logger.warning(
                f"Participant not found: {participant_id} in session {session_id}"
            )
            result.update({"stage": "participant", "error": "Participant not found"})
            return result

        # Step 3: Create segment and save audio
        segment = Segment(
            participant_id=participant_id,
            timestamp=timestamp,
            text_raw="",
            confidence=0.0,
        )

        try:
            # Save converted WAV data
            audio_path = await storage_service.save_audio(
                session_id, segment, wav_data
            )
            segment.audio_file = audio_path
        except Exception as e:
            logger.error(f"Failed to save audio: {e}")
            result.update({"stage": "save_audio", "error": str(e)})
            return result
        result["audio_path"] = audio_path

        # Step 4: Speech-to-text (using WAV data)
        try:
            text, confidence = await stt_service.transcribe_audio(wav_data, audio_format="wav")
        except Exception as e:
            logger.error(f"STT crashed: {e}", exc_info=True)
            result.update({"stage": "stt", "error": str(e)})
            return result
        if not text.strip():
            logger.debug("No speech detected in STT result")
            result.update({"stage": "stt", "skipped": True, "stt_confidence": confidence, "stt_text_len": 0})
            return result

        segment.text_raw = text
        segment.confidence = confidence
        result.update({"stt_confidence": confidence, "stt_text_len": len(text)})

        # Save segment
        try:
            await storage_service.save_segment(session_id, segment)
        except Exception as e:
            logger.error(f"Failed to save segment: {e}")
            # non-fatal, but record it
            result.update({"stage": "save_segment", "warning": str(e)})
        else:
            result["segment_id"] = segment.segment_id

        # Step 5: HQ declaration detection (if participant HQ not set)
        hq_master = await storage_service.get_session_hq_master(session_id)
        if not participant.hq_id:
            declared_hq_id = hq_matcher_service.detect_declaration(text, hq_master)
            if declared_hq_id:
                try:
                    await storage_service.update_participant(
                        session_id,
                        participant_id,
                        {"hq_id": declared_hq_id, "is_declared": True},
                    )
                    participant.hq_id = declared_hq_id
                    logger.info(
                        f"HQ detected from declaration: {declared_hq_id} "
                        f"for participant {participant_id}"
                    )
                except Exception as e:
                    logger.error(f"Failed to update participant HQ: {e}")
            else:
                # If declaration looks like a HQ name but it's not in master yet,
                # auto-create an HQ entry so it can be selected/filtered later.
                declared_name = hq_matcher_service.extract_declaration_name(text)
                if declared_name:
                    result["declared_hq_name"] = declared_name
                    existing_id: Optional[str] = None
                    for hq in hq_master:
                        if hq.active and hq.hq_name == declared_name:
                            existing_id = hq.hq_id
                            break
                    try:
                        if existing_id is None:
                            new_hq = HQMaster(
                                hq_name=declared_name,
                                zoom_pattern=declared_name,
                                active=True,
                            )
                            created = await storage_service.add_session_hq(session_id, new_hq)
                            existing_id = created.hq_id
                            # refresh local view for later steps
                            hq_master.append(created)
                            result["declared_hq_created"] = True
                        else:
                            result["declared_hq_created"] = False

                        await storage_service.update_participant(
                            session_id,
                            participant_id,
                            {"hq_id": existing_id, "is_declared": True},
                        )
                        participant.hq_id = existing_id
                        logger.info(f"Auto-attached participant to HQ '{declared_name}' ({existing_id})")
                    except Exception as e:
                        logger.error(f"Failed to auto-create/attach declared HQ: {e}")

        # Step 6: Classification and summarization
        hq_name = hq_matcher_service.get_hq_name(participant.hq_id, hq_master)
        try:
            category, summary, ai_note = await classifier_service.classify_and_summarize(text, hq_name)
        except Exception as e:
            # Never block chronology creation on classifier failures.
            logger.error(f"Classifier crashed: {e}", exc_info=True)
            category = Category.OTHER
            summary = (text.strip()[:20] + ("..." if len(text.strip()) > 20 else "")) if text else ""
            ai_note = (text.strip()[:200] + ("..." if len(text.strip()) > 200 else "")) if text else ""
            result.update({"stage": "classify", "warning": str(e), "fallback": True})

        # Step 7: Create chronology entry
        entry = ChronologyEntry(
            segment_id=segment.segment_id,
            participant_id=participant_id,
            hq_id=participant.hq_id,
            timestamp=timestamp,
            category=category,
            summary=summary,
            text_raw=text,
            ai_note=ai_note,
            is_hq_confirmed=bool(participant.hq_id),
            has_task=category in (Category.INSTRUCTION, Category.REQUEST),
        )

        try:
            await storage_service.save_chronology_entry(session_id, entry)
        except Exception as e:
            logger.error(f"Failed to save chronology entry: {e}")
            result.update({"stage": "save_entry", "error": str(e)})
            return result
        result.update({"entry_id": entry.entry_id, "category": getattr(category, "value", str(category)), "summary": summary})

        # Step 8: WebSocket notification
        try:
            await connection_manager.notify_new_entry(
                session_id,
                {
                    **entry.model_dump(),
                    "hq_name": hq_name,
                },
            )
        except Exception as e:
            logger.error(f"Failed to send WebSocket notification: {e}")

        logger.info(
            f"Processed audio: [{category.value}] {hq_name or 'Unknown'}: {summary}"
        )
        result.update({"ok": True, "stage": "done"})
        return result

    async def handle_participant_join(
        self,
        session_id: str,
        zoom_display_name: str,
        zoom_user_id: str,
    ) -> Participant:
        """
        Handle a participant joining the meeting.

        Creates a new participant record and attempts to match them
        to an HQ based on their Zoom display name.

        Args:
            session_id: The session the participant is joining.
            zoom_display_name: The participant's Zoom display name.
            zoom_user_id: The participant's Zoom user ID.

        Returns:
            The created Participant object.

        Raises:
            ZoomBotError: If participant creation fails.
        """
        # Match HQ from display name (session-scoped HQ master)
        hq_master = await storage_service.get_session_hq_master(session_id)
        hq_id = hq_matcher_service.match_hq(zoom_display_name, hq_master)

        participant = Participant(
            zoom_display_name=zoom_display_name,
            hq_id=hq_id,
            connection_status=ConnectionStatus.JOINED,
        )

        try:
            created = await storage_service.add_participant(session_id, participant)
        except Exception as e:
            logger.error(f"Failed to add participant: {e}")
            raise ZoomBotError(f"Failed to add participant: {e}") from e

        # Send WebSocket notification
        hq_name = hq_matcher_service.get_hq_name(hq_id, hq_master)
        try:
            await connection_manager.notify_participant_update(
                session_id,
                {
                    **created.model_dump(),
                    "hq_name": hq_name,
                },
            )
        except Exception as e:
            logger.error(f"Failed to notify participant join: {e}")

        logger.info(
            f"Participant joined: {zoom_display_name} "
            f"(HQ: {hq_name or 'Unknown'}) in session {session_id}"
        )
        return created

    async def handle_participant_leave(
        self,
        session_id: str,
        participant_id: str,
    ) -> None:
        """
        Handle a participant leaving the meeting.

        Updates participant status and sends WebSocket notification.

        Args:
            session_id: The session the participant is leaving.
            participant_id: The participant's ID.
        """
        try:
            await storage_service.update_participant(
                session_id,
                participant_id,
                {
                    "leave_at": datetime.utcnow(),
                    "connection_status": ConnectionStatus.LEFT,
                },
            )
        except Exception as e:
            logger.error(f"Failed to update participant on leave: {e}")
            return

        # Send WebSocket notification
        participant = await storage_service.get_participant(session_id, participant_id)
        if participant:
            hq_master = await storage_service.get_session_hq_master(session_id)
            hq_name = hq_matcher_service.get_hq_name(participant.hq_id, hq_master)
            try:
                await connection_manager.notify_participant_update(
                    session_id,
                    {
                        **participant.model_dump(),
                        "hq_name": hq_name,
                    },
                )
            except Exception as e:
                logger.error(f"Failed to notify participant leave: {e}")

            logger.info(
                f"Participant left: {participant.zoom_display_name} "
                f"in session {session_id}"
            )


# Singleton instance
zoom_bot_service = ZoomBotService()
