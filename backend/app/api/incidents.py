"""
Incident (parent box) API endpoints.

An incident groups 4 department sessions (活動指揮/搬送調整/情報分析/物資支援).
"""

from datetime import datetime

from fastapi import APIRouter

from ..models.schemas import (
    Incident,
    IncidentCreate,
    IncidentExtraSessionCreate,
    IncidentUpdate,
    Session,
    SessionKind,
)
from ..services.storage import storage_service
from .exceptions import NotFoundException


router = APIRouter(prefix="/incidents", tags=["incidents"])

REQUIRED_DEPARTMENT_KINDS: tuple[SessionKind, ...] = (
    SessionKind.ACTIVITY_COMMAND,
    SessionKind.TRANSPORT_COORDINATION,
    SessionKind.INFO_ANALYSIS,
    SessionKind.LOGISTICS_SUPPORT,
)


async def _get_incident_or_raise(incident_id: str) -> Incident:
    incident = await storage_service.get_incident(incident_id)
    if not incident:
        raise NotFoundException("Incident", incident_id)
    return incident


def _kind_label(kind: SessionKind) -> str:
    return {
        SessionKind.ACTIVITY_COMMAND: "活動指揮",
        SessionKind.TRANSPORT_COORDINATION: "搬送調整",
        SessionKind.INFO_ANALYSIS: "情報分析",
        SessionKind.LOGISTICS_SUPPORT: "物資支援",
        SessionKind.EXTRA: "追加",
    }[kind]


@router.get("", response_model=list[Incident])
async def list_incidents() -> list[Incident]:
    return await storage_service.list_incidents()


@router.get("/{incident_id}", response_model=Incident)
async def get_incident(incident_id: str) -> Incident:
    return await _get_incident_or_raise(incident_id)


@router.post("", response_model=Incident, status_code=201)
async def create_incident(data: IncidentCreate) -> Incident:
    # Create incident shell first
    incident = Incident(
        incident_name=data.incident_name,
        incident_date=data.incident_date,
    )

    # Auto-create 4 department sessions under this incident (no zoom id by default)
    for kind in REQUIRED_DEPARTMENT_KINDS:
        title = f"{data.incident_name} {data.incident_date.strftime('%Y/%m/%d')} {_kind_label(kind)}"
        session = Session(
            title=title,
            session_kind=kind,
            incident_name=data.incident_name,
            incident_date=data.incident_date,
            incident_id=incident.incident_id,
            zoom_meeting_id=None,
        )
        created = await storage_service.create_session(session)
        incident.sessions[kind] = created.session_id

    created_incident = await storage_service.create_incident(incident)
    return created_incident


@router.patch("/{incident_id}", response_model=Incident)
async def update_incident(incident_id: str, data: IncidentUpdate) -> Incident:
    await _get_incident_or_raise(incident_id)
    updates = data.model_dump(exclude_unset=True)
    incident = await storage_service.update_incident(incident_id, updates)
    if not incident:
        raise NotFoundException("Incident", incident_id)

    # If incident_name/date changed, update titles of child sessions for consistency (best-effort)
    if any(k in updates for k in ("incident_name", "incident_date")):
        inc_name = incident.incident_name
        inc_date = incident.incident_date
        for kind, session_id in incident.sessions.items():
            title = f"{inc_name} {inc_date.strftime('%Y/%m/%d')} {_kind_label(kind)}"
            try:
                await storage_service.update_session(session_id, {"title": title, "incident_name": inc_name, "incident_date": inc_date})
            except Exception:
                # non-fatal
                pass

    return incident


@router.post("/{incident_id}/extra_sessions", response_model=Incident, status_code=201)
async def add_extra_session(incident_id: str, data: IncidentExtraSessionCreate) -> Incident:
    """
    Add an extra Zoom room under an incident.

    Creates a new session with session_kind=extra and attaches it to incident.extra_sessions.
    """
    incident = await _get_incident_or_raise(incident_id)

    title = f"{incident.incident_name} {incident.incident_date.strftime('%Y/%m/%d')} 追加:{data.label}"
    session = Session(
        title=title,
        session_kind=SessionKind.EXTRA,
        incident_name=incident.incident_name,
        incident_date=incident.incident_date,
        incident_id=incident.incident_id,
        zoom_meeting_id=data.zoom_meeting_id,
    )
    created = await storage_service.create_session(session)

    incident.extra_sessions.append({"label": data.label, "session_id": created.session_id})
    updated = await storage_service.update_incident(
        incident.incident_id, {"extra_sessions": incident.extra_sessions}
    )
    if not updated:
        raise NotFoundException("Incident", incident_id)
    return updated


@router.post("/{incident_id}/ensure_department_sessions", response_model=Incident)
async def ensure_department_sessions(incident_id: str) -> Incident:
    """
    Ensure the 4 core department sessions exist for an incident.

    This is mainly for older or partially-created incidents. It creates any missing
    sessions (活動指揮/搬送調整/情報分析/物資支援) and updates incident.sessions accordingly.
    """
    incident = await _get_incident_or_raise(incident_id)

    sessions_updated = False

    for kind in REQUIRED_DEPARTMENT_KINDS:
        session_id = incident.sessions.get(kind)
        if session_id:
            existing = await storage_service.get_session(session_id)
            if existing:
                continue

        title = f"{incident.incident_name} {incident.incident_date.strftime('%Y/%m/%d')} {_kind_label(kind)}"
        session = Session(
            title=title,
            session_kind=kind,
            incident_name=incident.incident_name,
            incident_date=incident.incident_date,
            incident_id=incident.incident_id,
            zoom_meeting_id=None,
        )
        created = await storage_service.create_session(session)
        incident.sessions[kind] = created.session_id
        sessions_updated = True

    if sessions_updated:
        updated = await storage_service.update_incident(incident.incident_id, {"sessions": incident.sessions})
        if updated:
            return updated

    return incident


@router.delete("/{incident_id}")
async def delete_incident(incident_id: str) -> dict[str, str]:
    """
    Delete an incident and all its associated data.

    This removes the incident metadata and all child sessions.
    """
    incident = await _get_incident_or_raise(incident_id)
    success = await storage_service.delete_incident(incident_id)
    if not success:
        raise NotFoundException("Incident", incident_id)
    from .exceptions import create_success_response
    return create_success_response(message="deleted")

