"""Pydantic models for the ChronologyAI application.

This module defines all data models used throughout the application,
including request/response schemas, database models, and WebSocket messages.
"""

from datetime import date, datetime, timezone
from enum import Enum
from typing import Annotated, Any, Optional
from uuid import uuid4

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    NonNegativeFloat,
    StringConstraints,
    field_serializer,
    field_validator,
)


# ========== Type Aliases ==========
NonEmptyStr = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
UUIDStr = Annotated[str, StringConstraints(pattern=r"^[a-f0-9\-]{36}$|^hq-\d{3}$")]


def generate_uuid() -> str:
    """Generate a new UUID string."""
    return str(uuid4())


def utc_now() -> datetime:
    """Get current UTC datetime."""
    return datetime.now(timezone.utc)


# ========== Enums ==========
class SessionStatus(str, Enum):
    """Status of a session."""

    WAITING = "waiting"
    RUNNING = "running"
    ENDED = "ended"


class SessionKind(str, Enum):
    """Kind/type of session."""

    ACTIVITY_COMMAND = "activity_command"        # 活動指揮
    TRANSPORT_COORDINATION = "transport_coordination"  # 搬送調整
    INFO_ANALYSIS = "info_analysis"              # 情報分析
    LOGISTICS_SUPPORT = "logistics_support"      # 物資支援
    EXTRA = "extra"                              # 追加（臨時/特別Zoomなど）


class Category(str, Enum):
    """Category types for chronology entries."""

    INSTRUCTION = "指示"
    REQUEST = "依頼"
    REPORT = "報告"
    DECISION = "決定"
    CONFIRMATION = "確認"
    RISK = "リスク"
    OTHER = "その他"


class ConnectionStatus(str, Enum):
    """Participant connection status."""

    JOINED = "参加中"
    LEFT = "退出"


class IdentificationStatus(str, Enum):
    """HQ identification status for participants."""

    CONFIRMED = "確定"
    UNCONFIRMED = "未確定"


class WSMessageType(str, Enum):
    """WebSocket message types."""

    NEW_ENTRY = "new_entry"
    PARTICIPANT_UPDATE = "participant_update"
    SESSION_UPDATE = "session_update"


# ========== Base Models ==========
class BaseSchema(BaseModel):
    """Base model with common configuration."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        validate_assignment=True,
        str_strip_whitespace=True,
    )


class TimestampMixin(BaseModel):
    """Mixin for models with timestamp fields."""

    @field_serializer("start_at", "end_at", "join_at", "leave_at", "timestamp", "last_speech_at", check_fields=False)
    def serialize_datetime(self, dt: Optional[datetime]) -> Optional[str]:
        """Serialize datetime to ISO format string."""
        if dt is None:
            return None
        return dt.isoformat()


# ========== Session Models ==========
class SessionCreate(BaseSchema):
    """Schema for creating a new session."""

    session_kind: SessionKind = Field(
        ...,
        description="Session kind (fixed 4 options)",
    )
    incident_name: NonEmptyStr = Field(
        ...,
        description="Incident/disaster name (free text, e.g. 能登半島地震)",
        examples=["能登半島地震"],
    )
    zoom_meeting_id: Optional[str] = Field(
        default=None,
        description="Zoom meeting ID to connect to",
    )
    incident_date: Optional[date] = Field(
        default=None,
        description="Incident date (e.g. 発災日). If omitted, title/date defaults to today.",
    )
    incident_id: Optional[str] = Field(
        default=None,
        description="Optional incident (parent) identifier",
    )


class Session(BaseSchema, TimestampMixin):
    """Session model representing a disaster response session."""

    session_id: str = Field(
        default_factory=generate_uuid,
        description="Unique session identifier",
    )
    title: NonEmptyStr = Field(..., description="Session title")
    session_kind: SessionKind = Field(
        default=SessionKind.ACTIVITY_COMMAND,
        description="Session kind (fixed 4 options)",
    )
    incident_name: Optional[str] = Field(
        default=None,
        description="Incident/disaster name (free text)",
    )
    incident_date: Optional[date] = Field(
        default=None,
        description="Incident date (e.g. 発災日)",
    )
    incident_id: Optional[str] = Field(
        default=None,
        description="Parent incident identifier (for grouping 4 department sessions)",
    )
    start_at: datetime = Field(
        default_factory=utc_now,
        description="Session start timestamp",
    )
    end_at: Optional[datetime] = Field(
        default=None,
        description="Session end timestamp",
    )
    status: SessionStatus = Field(
        default=SessionStatus.WAITING,
        description="Current session status",
    )
    zoom_meeting_id: Optional[str] = Field(
        default=None,
        description="Associated Zoom meeting ID",
    )

    @field_validator("end_at")
    @classmethod
    def validate_end_after_start(cls, v: Optional[datetime], info) -> Optional[datetime]:
        """Validate that end_at is after start_at."""
        if v is not None and info.data.get("start_at"):
            start_at = info.data["start_at"]
            if v < start_at:
                raise ValueError("end_at must be after start_at")
        return v


class SessionUpdate(BaseSchema):
    """Schema for updating a session."""

    title: Optional[NonEmptyStr] = None
    session_kind: Optional[SessionKind] = None
    incident_name: Optional[NonEmptyStr] = None
    incident_date: Optional[date] = None
    incident_id: Optional[str] = None
    status: Optional[SessionStatus] = None
    zoom_meeting_id: Optional[str] = None
    end_at: Optional[datetime] = None


# ========== HQ Master Models ==========
class HQMasterBase(BaseSchema):
    """Base schema for HQ Master."""

    hq_name: NonEmptyStr = Field(
        ...,
        description="HQ display name",
        examples=["本部長", "統括DMAT"],
    )
    zoom_pattern: NonEmptyStr = Field(
        ...,
        description="Pattern to match in Zoom display names",
    )
    active: bool = Field(
        default=True,
        description="Whether this HQ is active",
    )
    # Participation flags (default: all on)
    include_activity_command: bool = Field(default=True, description="Participates in 活動指揮")
    include_transport_coordination: bool = Field(default=True, description="Participates in 搬送調整")
    include_info_analysis: bool = Field(default=True, description="Participates in 情報分析")
    include_logistics_support: bool = Field(default=True, description="Participates in 物資支援")


class IncidentStatus(str, Enum):
    """Incident lifecycle status."""

    ACTIVE = "active"
    ENDED = "ended"


class IncidentCreate(BaseSchema):
    """Schema for creating an incident (parent box)."""

    incident_name: NonEmptyStr = Field(..., description="Incident/disaster name (free text)")
    incident_date: date = Field(..., description="Incident date (e.g. 発災日)")


class Incident(BaseSchema, TimestampMixin):
    """Incident model that groups 4 department sessions."""

    incident_id: str = Field(default_factory=generate_uuid, description="Unique incident identifier")
    incident_name: NonEmptyStr = Field(..., description="Incident/disaster name (free text)")
    incident_date: date = Field(..., description="Incident date (e.g. 発災日)")
    status: IncidentStatus = Field(default=IncidentStatus.ACTIVE, description="Incident status")
    sessions: dict[SessionKind, str] = Field(
        default_factory=dict,
        description="Mapping from session_kind to session_id",
    )
    extra_sessions: list[dict[str, str]] = Field(
        default_factory=list,
        description="Extra Zoom rooms as session records: items are {label, session_id}",
    )


class IncidentUpdate(BaseSchema):
    """Schema for updating an incident."""

    incident_name: Optional[NonEmptyStr] = None
    incident_date: Optional[date] = None
    status: Optional[IncidentStatus] = None


class IncidentExtraSessionCreate(BaseSchema):
    """Add an extra Zoom room (creates an extra session under the incident)."""

    label: NonEmptyStr = Field(..., description="Room label (e.g., 医療連携, 広報, 現地連絡)")
    zoom_meeting_id: Optional[str] = Field(default=None, description="Zoom meeting ID for this extra room")


class HQMasterCreate(HQMasterBase):
    """Schema for creating a new HQ Master entry."""

    pass


class HQMaster(HQMasterBase):
    """HQ Master model representing a headquarters unit."""

    hq_id: str = Field(
        default_factory=generate_uuid,
        description="Unique HQ identifier",
    )


# ========== Participant Models ==========
class Participant(BaseSchema, TimestampMixin):
    """Participant model representing a session participant."""

    participant_id: str = Field(
        default_factory=generate_uuid,
        description="Unique participant identifier",
    )
    hq_id: Optional[str] = Field(
        default=None,
        description="Associated HQ identifier",
    )
    zoom_display_name: NonEmptyStr = Field(
        ...,
        description="Display name from Zoom",
    )
    join_at: datetime = Field(
        default_factory=utc_now,
        description="Join timestamp",
    )
    leave_at: Optional[datetime] = Field(
        default=None,
        description="Leave timestamp",
    )
    is_declared: bool = Field(
        default=False,
        description="Whether participant has made a declaration",
    )
    connection_status: ConnectionStatus = Field(
        default=ConnectionStatus.JOINED,
        description="Current connection status",
    )


class ParticipantCreate(BaseSchema):
    """Schema for creating a new participant."""

    zoom_display_name: NonEmptyStr = Field(
        ...,
        description="Display name (from Zoom or manual entry)",
    )
    hq_id: Optional[str] = Field(
        default=None,
        description="Associated HQ identifier (optional, can be auto-matched)",
    )


class ParticipantUpdate(BaseSchema):
    """Schema for updating a participant."""

    hq_id: Optional[str] = None
    is_declared: Optional[bool] = None
    leave_at: Optional[datetime] = None
    connection_status: Optional[ConnectionStatus] = None


# ========== Segment Models ==========
class Segment(BaseSchema, TimestampMixin):
    """Segment model representing a speech segment."""

    segment_id: str = Field(
        default_factory=generate_uuid,
        description="Unique segment identifier",
    )
    participant_id: str = Field(
        ...,
        description="Associated participant identifier",
    )
    timestamp: datetime = Field(
        default_factory=utc_now,
        description="Segment timestamp",
    )
    text_raw: str = Field(
        ...,
        description="Raw transcribed text",
    )
    confidence: NonNegativeFloat = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Transcription confidence score (0-1)",
    )
    audio_file: Optional[str] = Field(
        default=None,
        description="Path to audio file",
    )


# ========== Chronology Entry Models ==========
class ChronologyEntry(BaseSchema, TimestampMixin):
    """Chronology entry model representing a categorized event."""

    entry_id: str = Field(
        default_factory=generate_uuid,
        description="Unique entry identifier",
    )
    segment_id: str = Field(
        ...,
        description="Associated segment identifier",
    )
    participant_id: Optional[str] = Field(
        default=None,
        description="Associated participant identifier",
    )
    hq_id: Optional[str] = Field(
        default=None,
        description="Associated HQ identifier",
    )
    timestamp: datetime = Field(
        ...,
        description="Entry timestamp",
    )
    category: Category = Field(
        ...,
        description="Entry category",
    )
    summary: NonEmptyStr = Field(
        ...,
        description="Entry summary",
    )
    text_raw: str = Field(
        ...,
        description="Original raw text",
    )
    ai_note: Optional[str] = Field(
        default=None,
        description="AI-generated longer summary/notes derived from text_raw",
    )
    is_hq_confirmed: bool = Field(
        default=False,
        description="Whether HQ association is confirmed",
    )
    has_task: bool = Field(
        default=False,
        description="Whether this entry represents an actionable task",
    )


class ChronologyEntryUpdate(BaseSchema):
    """Schema for updating a chronology entry."""

    category: Optional[Category] = None
    summary: Optional[str] = None
    text_raw: Optional[str] = None
    ai_note: Optional[str] = None
    hq_id: Optional[str] = None
    is_hq_confirmed: Optional[bool] = None
    has_task: Optional[bool] = None


# ========== Zoom Credentials Models ==========
class ZoomCredentials(BaseSchema):
    """Zoom API credentials."""

    client_id: str = Field(
        default="",
        description="Zoom OAuth client ID",
    )
    client_secret: str = Field(
        default="",
        description="Zoom OAuth client secret",
    )
    account_id: str = Field(
        default="",
        description="Zoom account ID",
    )
    configured: bool = Field(
        default=False,
        description="Whether credentials are fully configured",
    )

    @field_validator("configured", mode="before")
    @classmethod
    def compute_configured(cls, v: Any, info) -> bool:
        """Auto-compute configured status if not explicitly set."""
        if isinstance(v, bool):
            return v
        # Check if all required fields have values
        data = info.data if hasattr(info, 'data') else {}
        return bool(
            data.get("client_id")
            and data.get("client_secret")
            and data.get("account_id")
        )


class ZoomCredentialsUpdate(BaseSchema):
    """Schema for updating Zoom credentials."""

    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    account_id: Optional[str] = None


# ========== LLM Settings Models ==========
class LLMSettings(BaseSchema):
    """LLM prompt configuration settings."""

    system_prompt: str = Field(
        default="",
        description="System prompt for the LLM classifier",
    )
    temperature: float = Field(
        default=0.3,
        ge=0.0,
        le=2.0,
        description="LLM temperature (0-2)",
    )
    max_tokens: int = Field(
        default=300,
        ge=1,
        le=4000,
        description="Maximum tokens for LLM response",
    )


class LLMSettingsUpdate(BaseSchema):
    """Schema for updating LLM settings."""

    system_prompt: Optional[str] = None
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=4000)


# ========== User Dictionary Models ==========
class DictionaryEntry(BaseSchema):
    """Single dictionary entry for STT correction."""

    entry_id: str = Field(
        default_factory=generate_uuid,
        description="Unique entry identifier",
    )
    wrong_text: str = Field(
        ...,
        description="Incorrect text (what STT outputs)",
        examples=["ディーマット", "てぃーまっと"],
    )
    correct_text: str = Field(
        ...,
        description="Correct text (what it should be)",
        examples=["DMAT"],
    )
    active: bool = Field(
        default=True,
        description="Whether this entry is active",
    )


class DictionaryEntryCreate(BaseSchema):
    """Schema for creating a dictionary entry."""

    wrong_text: str = Field(..., min_length=1)
    correct_text: str = Field(..., min_length=1)
    active: bool = Field(default=True)


class DictionaryEntryUpdate(BaseSchema):
    """Schema for updating a dictionary entry."""

    wrong_text: Optional[str] = None
    correct_text: Optional[str] = None
    active: Optional[bool] = None


# ========== Response Models ==========
class SessionResponse(Session):
    """Extended session response with counts."""

    participant_count: int = Field(
        default=0,
        ge=0,
        description="Number of participants",
    )
    entry_count: int = Field(
        default=0,
        ge=0,
        description="Number of chronology entries",
    )


class ParticipantResponse(Participant):
    """Extended participant response with HQ info."""

    hq_name: Optional[str] = Field(
        default=None,
        description="HQ display name",
    )
    identification_status: IdentificationStatus = Field(
        default=IdentificationStatus.UNCONFIRMED,
        description="HQ identification status",
    )
    last_speech_at: Optional[datetime] = Field(
        default=None,
        description="Timestamp of last speech",
    )


class ChronologyResponse(ChronologyEntry):
    """Extended chronology entry response with HQ info."""

    hq_name: Optional[str] = Field(
        default=None,
        description="HQ display name",
    )


# ========== WebSocket Messages ==========
class WSMessage(BaseSchema):
    """WebSocket message model."""

    type: WSMessageType = Field(
        ...,
        description="Message type",
    )
    data: dict[str, Any] = Field(
        ...,
        description="Message payload",
    )


# ========== Chat Models ==========
class ChatMessageRole(str, Enum):
    """Role of a chat message."""

    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatMessage(BaseSchema, TimestampMixin):
    """Chat message model."""

    message_id: str = Field(
        default_factory=generate_uuid,
        description="Unique message identifier",
    )
    thread_id: str = Field(
        ...,
        description="Parent thread identifier",
    )
    role: ChatMessageRole = Field(
        ...,
        description="Message role (user/assistant/system)",
    )
    content: str = Field(
        ...,
        description="Message content",
    )
    timestamp: datetime = Field(
        default_factory=utc_now,
        description="Message timestamp",
    )
    chronology_snapshot: Optional[list[str]] = Field(
        default=None,
        description="List of entry IDs referenced at time of message",
    )


class ChatThread(BaseSchema, TimestampMixin):
    """Chat thread model."""

    thread_id: str = Field(
        default_factory=generate_uuid,
        description="Unique thread identifier",
    )
    session_id: str = Field(
        ...,
        description="Parent session identifier",
    )
    creator_hq_id: str = Field(
        ...,
        description="HQ ID of thread creator",
    )
    creator_hq_name: str = Field(
        ...,
        description="HQ name of thread creator (for display)",
    )
    title: str = Field(
        default="新規相談",
        description="Thread title (auto-generated from first message)",
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        description="Thread creation timestamp",
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        description="Last update timestamp",
    )
    messages: list[ChatMessage] = Field(
        default_factory=list,
        description="Messages in this thread",
    )


class ChatThreadSummary(BaseSchema):
    """Summary of a chat thread (for list view)."""

    thread_id: str = Field(..., description="Thread identifier")
    session_id: str = Field(..., description="Session identifier")
    creator_hq_id: str = Field(..., description="Creator HQ ID")
    creator_hq_name: str = Field(..., description="Creator HQ name")
    title: str = Field(..., description="Thread title")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    message_count: int = Field(default=0, description="Number of messages")
    can_write: bool = Field(
        default=False,
        description="Whether requesting user can write to this thread",
    )


class ChatThreadCreate(BaseSchema):
    """Schema for creating a new chat thread."""

    hq_id: str = Field(..., description="Creator's HQ ID")
    hq_name: str = Field(..., description="Creator's HQ name")
    message: str = Field(..., description="First message content")
    include_chronology: bool = Field(
        default=True,
        description="Whether to include chronology context",
    )


class ChatMessageCreate(BaseSchema):
    """Schema for sending a message to a thread."""

    hq_id: str = Field(..., description="Sender's HQ ID (for authorization)")
    message: str = Field(..., description="Message content")
    include_chronology: bool = Field(
        default=True,
        description="Whether to include chronology context",
    )


class ChatThreadResponse(BaseSchema):
    """Response for thread detail."""

    thread: ChatThread = Field(..., description="Thread with messages")
    can_write: bool = Field(..., description="Whether user can write")
