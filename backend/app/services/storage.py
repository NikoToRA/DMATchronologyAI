"""
Storage Service Module

Provides a unified storage interface supporting both local filesystem
and Azure Blob Storage backends for session, participant, segment,
chronology, and configuration data.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import aiofiles
from azure.core.exceptions import AzureError, ResourceNotFoundError
from azure.storage.blob.aio import BlobServiceClient, ContainerClient

from ..config import settings
from ..models.schemas import (
    ChronologyEntry,
    DictionaryEntry,
    HQMaster,
    Incident,
    LLMSettings,
    Participant,
    Segment,
    Session,
    ZoomCredentials,
)

logger = logging.getLogger(__name__)


class StorageError(Exception):
    """Base exception for storage operations."""

    pass


class StorageReadError(StorageError):
    """Exception raised when reading from storage fails."""

    pass


class StorageWriteError(StorageError):
    """Exception raised when writing to storage fails."""

    pass


class StorageService:
    """
    Storage service that supports both local filesystem and Azure Blob Storage.

    This service provides a unified API for storing and retrieving session data,
    participant information, audio segments, chronology entries, and configuration
    files. It automatically selects between Azure Blob Storage and local filesystem
    based on configuration.

    Attributes:
        use_azure: Whether Azure Blob Storage is being used.
        local_path: Path for local storage.
        config_path: Path for configuration files.
    """

    def __init__(self) -> None:
        """Initialize the storage service with configured backend."""
        self.use_azure: bool = bool(settings.azure_storage_connection_string)
        self.local_path: Path = Path(settings.local_storage_path)
        self.config_path: Path = Path(settings.config_path)
        self._blob_service_client: Optional[BlobServiceClient] = None
        self._container_client: Optional[ContainerClient] = None

        backend = "Azure Blob Storage" if self.use_azure else "Local filesystem"
        logger.info(f"StorageService initialized with backend: {backend}")

    async def _get_container_client(self) -> ContainerClient:
        """
        Get or create an Azure Blob Storage container client.

        Creates the container if it doesn't exist.

        Returns:
            ContainerClient: The Azure container client instance.

        Raises:
            StorageError: If Azure connection fails.
        """
        if self._container_client is None:
            try:
                self._blob_service_client = BlobServiceClient.from_connection_string(
                    settings.azure_storage_connection_string
                )
                self._container_client = self._blob_service_client.get_container_client(
                    settings.azure_storage_container_name
                )
                # Create container if it doesn't exist
                try:
                    await self._container_client.create_container()
                    logger.info(
                        f"Created Azure container: {settings.azure_storage_container_name}"
                    )
                except AzureError as create_error:
                    # Container already exists - this is fine
                    if "ContainerAlreadyExists" not in str(create_error):
                        logger.debug(f"Container exists or creation skipped: {create_error}")
                logger.debug(
                    f"Connected to Azure container: {settings.azure_storage_container_name}"
                )
            except AzureError as e:
                logger.error(f"Failed to connect to Azure Blob Storage: {e}")
                raise StorageError(f"Azure connection failed: {e}") from e
        return self._container_client

    def _get_local_path(self, *parts: str) -> Path:
        """
        Get a local filesystem path, creating parent directories if needed.

        Args:
            *parts: Path components to join.

        Returns:
            Path: The complete local filesystem path.
        """
        path = self.local_path.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    async def _read_json(self, path: str) -> Optional[Dict[str, Any]]:
        """
        Read and parse a JSON file from storage.

        Args:
            path: The storage path to read from.

        Returns:
            Parsed JSON data as a dictionary, or None if not found.

        Raises:
            StorageReadError: If reading fails (except for not found).
        """
        if self.use_azure:
            return await self._read_json_azure(path)
        return await self._read_json_local(path)

    async def _read_json_azure(self, path: str) -> Optional[Dict[str, Any]]:
        """Read JSON from Azure Blob Storage."""
        try:
            container = await self._get_container_client()
            blob = container.get_blob_client(path)
            data = await blob.download_blob()
            content = await data.readall()
            return json.loads(content)
        except ResourceNotFoundError:
            logger.debug(f"Resource not found in Azure: {path}")
            return None
        except AzureError as e:
            logger.error(f"Azure read error for {path}: {e}")
            raise StorageReadError(f"Failed to read {path} from Azure: {e}") from e
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error for {path}: {e}")
            raise StorageReadError(f"Invalid JSON in {path}: {e}") from e

    async def _read_json_local(self, path: str) -> Optional[Dict[str, Any]]:
        """Read JSON from local filesystem."""
        local_path = self._get_local_path(path)
        if not local_path.exists():
            logger.debug(f"Local file not found: {local_path}")
            return None
        try:
            async with aiofiles.open(local_path, "r", encoding="utf-8") as f:
                content = await f.read()
                return json.loads(content)
        except OSError as e:
            logger.error(f"File read error for {local_path}: {e}")
            raise StorageReadError(f"Failed to read {local_path}: {e}") from e
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error for {local_path}: {e}")
            raise StorageReadError(f"Invalid JSON in {local_path}: {e}") from e

    async def _write_json(self, path: str, data: Dict[str, Any]) -> None:
        """
        Write data as JSON to storage.

        Args:
            path: The storage path to write to.
            data: Dictionary data to serialize and write.

        Raises:
            StorageWriteError: If writing fails.
        """
        content = json.dumps(data, ensure_ascii=False, indent=2, default=str)
        if self.use_azure:
            await self._write_json_azure(path, content)
        else:
            await self._write_json_local(path, content)

    async def _write_json_azure(self, path: str, content: str) -> None:
        """Write JSON content to Azure Blob Storage."""
        try:
            container = await self._get_container_client()
            blob = container.get_blob_client(path)
            await blob.upload_blob(content, overwrite=True)
            logger.debug(f"Wrote JSON to Azure: {path}")
        except AzureError as e:
            logger.error(f"Azure write error for {path}: {e}")
            raise StorageWriteError(f"Failed to write {path} to Azure: {e}") from e

    async def _write_json_local(self, path: str, content: str) -> None:
        """Write JSON content to local filesystem."""
        local_path = self._get_local_path(path)
        try:
            async with aiofiles.open(local_path, "w", encoding="utf-8") as f:
                await f.write(content)
            logger.debug(f"Wrote JSON to local: {local_path}")
        except OSError as e:
            logger.error(f"File write error for {local_path}: {e}")
            raise StorageWriteError(f"Failed to write {local_path}: {e}") from e

    async def _write_binary(self, path: str, data: bytes) -> None:
        """
        Write binary data to storage.

        Args:
            path: The storage path to write to.
            data: Binary data to write.

        Raises:
            StorageWriteError: If writing fails.
        """
        if self.use_azure:
            await self._write_binary_azure(path, data)
        else:
            await self._write_binary_local(path, data)

    async def _write_binary_azure(self, path: str, data: bytes) -> None:
        """Write binary data to Azure Blob Storage."""
        try:
            container = await self._get_container_client()
            blob = container.get_blob_client(path)
            await blob.upload_blob(data, overwrite=True)
            logger.debug(f"Wrote binary to Azure: {path} ({len(data)} bytes)")
        except AzureError as e:
            logger.error(f"Azure binary write error for {path}: {e}")
            raise StorageWriteError(
                f"Failed to write binary {path} to Azure: {e}"
            ) from e

    async def _write_binary_local(self, path: str, data: bytes) -> None:
        """Write binary data to local filesystem."""
        local_path = self._get_local_path(path)
        try:
            async with aiofiles.open(local_path, "wb") as f:
                await f.write(data)
            logger.debug(f"Wrote binary to local: {local_path} ({len(data)} bytes)")
        except OSError as e:
            logger.error(f"File binary write error for {local_path}: {e}")
            raise StorageWriteError(f"Failed to write binary {local_path}: {e}") from e

    async def _list_blobs(self, prefix: str) -> List[str]:
        """
        List all blob/file paths with a given prefix.

        Args:
            prefix: The path prefix to filter by.

        Returns:
            List of matching blob/file paths.

        Raises:
            StorageReadError: If listing fails.
        """
        if self.use_azure:
            return await self._list_blobs_azure(prefix)
        return self._list_blobs_local(prefix)

    async def _list_blobs_azure(self, prefix: str) -> List[str]:
        """List blobs in Azure Blob Storage."""
        try:
            container = await self._get_container_client()
            blobs: List[str] = []
            async for blob in container.list_blobs(name_starts_with=prefix):
                blobs.append(blob.name)
            return blobs
        except AzureError as e:
            logger.error(f"Azure list error for prefix {prefix}: {e}")
            raise StorageReadError(f"Failed to list blobs with prefix {prefix}: {e}") from e

    def _list_blobs_local(self, prefix: str) -> List[str]:
        """List files in local filesystem."""
        local_path = self._get_local_path(prefix)
        if local_path.exists() and local_path.is_dir():
            return [
                str(f.relative_to(self.local_path))
                for f in local_path.rglob("*.json")
            ]
        return []

    # ========== Session Operations ==========

    async def create_session(self, session: Session) -> Session:
        """
        Create a new session with its metadata and empty participants list.

        Args:
            session: The session object to create.

        Returns:
            The created session object.

        Raises:
            StorageWriteError: If session creation fails.
        """
        path = f"{session.session_id}/meta.json"
        logger.info(f"Creating session: {session.session_id}")
        await self._write_json(path, session.model_dump())
        await self._write_json(f"{session.session_id}/participants.json", [])
        # Initialize session-scoped HQ master from global template for isolation (legacy path)
        # NOTE: When session has incident_id, effective HQ master is incident-scoped.
        try:
            template_hqs = await self.get_hq_master()
            await self.save_session_hq_master(session.session_id, template_hqs)
        except Exception as e:
            logger.error(f"Failed to initialize session HQ master for {session.session_id}: {e}")
        return session

    # ========== Incident Operations ==========

    async def create_incident(self, incident: Incident) -> Incident:
        """Create a new incident (parent box)."""
        await self._write_json(f"incidents/{incident.incident_id}/meta.json", incident.model_dump())
        # Ensure incident HQ master exists by copying from global template
        try:
            template = await self.get_hq_master()
            await self.save_incident_hq_master(incident.incident_id, template)
        except Exception as e:
            logger.error(f"Failed to initialize incident HQ master for {incident.incident_id}: {e}")
        return incident

    async def get_incident(self, incident_id: str) -> Optional[Incident]:
        data = await self._read_json(f"incidents/{incident_id}/meta.json")
        if data:
            return Incident(**data)
        return None

    async def update_incident(self, incident_id: str, updates: Dict[str, Any]) -> Optional[Incident]:
        incident = await self.get_incident(incident_id)
        if incident is None:
            return None
        for key, value in updates.items():
            if value is not None:
                setattr(incident, key, value)
        await self._write_json(f"incidents/{incident_id}/meta.json", incident.model_dump())
        return incident

    async def list_incidents(self) -> List[Incident]:
        """List incidents by scanning incident meta files."""
        incidents: List[Incident] = []
        if self.use_azure:
            try:
                container = await self._get_container_client()
                async for blob in container.list_blobs(name_starts_with="incidents/"):
                    if blob.name.endswith("/meta.json"):
                        parts = blob.name.split("/")
                        if len(parts) >= 3:
                            inc_id = parts[1]
                            inc = await self.get_incident(inc_id)
                            if inc:
                                incidents.append(inc)
            except AzureError as e:
                logger.error(f"Failed to list incidents from Azure: {e}")
        else:
            base = self._get_local_path("incidents")
            if base.exists():
                for meta in base.rglob("meta.json"):
                    try:
                        rel = meta.relative_to(base)
                        inc_id = rel.parts[0]
                        inc = await self.get_incident(inc_id)
                        if inc:
                            incidents.append(inc)
                    except Exception:
                        continue
        # Sort newest first by incident_date then id
        return sorted(incidents, key=lambda i: (i.incident_date, i.incident_id), reverse=True)

    async def delete_incident(self, incident_id: str) -> bool:
        """
        Delete an incident and all its associated data.

        Args:
            incident_id: The unique identifier of the incident to delete.

        Returns:
            True if deleted, False if not found.
        """
        incident = await self.get_incident(incident_id)
        if incident is None:
            return False

        incident_path = f"incidents/{incident_id}"
        session_ids: set[str] = set()
        try:
            session_ids.update((incident.sessions or {}).values())
        except Exception:
            pass
        try:
            for x in incident.extra_sessions or []:
                sid = x.get("session_id") if isinstance(x, dict) else None
                if sid:
                    session_ids.add(sid)
        except Exception:
            pass

        try:
            if self.use_azure:
                container = await self._get_container_client()
                # Delete incident blobs
                blobs_to_delete: list[str] = []
                async for blob in container.list_blobs(name_starts_with=f"{incident_path}/"):
                    blobs_to_delete.append(blob.name)

                # Delete child session blobs
                for sid in session_ids:
                    async for blob in container.list_blobs(name_starts_with=f"{sid}/"):
                        blobs_to_delete.append(blob.name)

                # De-dup and delete
                deleted_any = False
                for blob_name in sorted(set(blobs_to_delete)):
                    try:
                        blob = container.get_blob_client(blob_name)
                        await blob.delete_blob()
                        deleted_any = True
                    except Exception as e:
                        logger.warning(f"Failed to delete blob {blob_name}: {e}")
                return deleted_any
            else:
                import shutil

                deleted_any = False

                # Delete incident directory
                local_incident_path = self._get_local_path(incident_path)
                if local_incident_path.exists():
                    shutil.rmtree(local_incident_path)
                    logger.info(f"Deleted incident directory: {local_incident_path}")
                    deleted_any = True

                # Delete child session directories
                for sid in session_ids:
                    local_session_path = self._get_local_path(sid)
                    if local_session_path.exists():
                        shutil.rmtree(local_session_path)
                        logger.info(f"Deleted session directory: {local_session_path}")
                        deleted_any = True

                return deleted_any
        except Exception as e:
            logger.error(f"Failed to delete incident {incident_id}: {e}")
            return False

    async def get_session(self, session_id: str) -> Optional[Session]:
        """
        Retrieve a session by its ID.

        Args:
            session_id: The unique session identifier.

        Returns:
            The Session object if found, None otherwise.
        """
        data = await self._read_json(f"{session_id}/meta.json")
        if data:
            return Session(**data)
        return None

    async def update_session(
        self, session_id: str, updates: Dict[str, Any]
    ) -> Optional[Session]:
        """
        Update session metadata with the provided fields.

        Args:
            session_id: The unique session identifier.
            updates: Dictionary of fields to update.

        Returns:
            The updated Session object if found, None otherwise.

        Raises:
            StorageWriteError: If update fails.
        """
        session = await self.get_session(session_id)
        if session is None:
            logger.warning(f"Session not found for update: {session_id}")
            return None

        for key, value in updates.items():
            if value is not None:
                setattr(session, key, value)

        logger.info(f"Updating session: {session_id}")
        await self._write_json(f"{session_id}/meta.json", session.model_dump())
        return session

    async def list_sessions(self) -> List[Session]:
        """
        List all sessions, sorted by start time (newest first).

        Returns:
            List of Session objects sorted by start_at in descending order.
        """
        sessions: List[Session] = []
        if self.use_azure:
            sessions = await self._list_sessions_azure()
        else:
            sessions = await self._list_sessions_local()
        return sorted(sessions, key=lambda s: s.start_at, reverse=True)

    async def _list_sessions_azure(self) -> List[Session]:
        """List sessions from Azure Blob Storage."""
        sessions: List[Session] = []
        try:
            container = await self._get_container_client()
            seen_sessions: set[str] = set()
            async for blob in container.list_blobs():
                parts = blob.name.split("/")
                if len(parts) >= 2 and parts[1] == "meta.json":
                    session_id = parts[0]
                    if session_id not in seen_sessions:
                        seen_sessions.add(session_id)
                        session = await self.get_session(session_id)
                        if session:
                            sessions.append(session)
        except AzureError as e:
            logger.error(f"Failed to list sessions from Azure: {e}")
        return sessions

    async def _list_sessions_local(self) -> List[Session]:
        """List sessions from local filesystem."""
        sessions: List[Session] = []
        if self.local_path.exists():
            for session_dir in self.local_path.iterdir():
                if session_dir.is_dir():
                    session = await self.get_session(session_dir.name)
                    if session:
                        sessions.append(session)
        return sessions

    async def delete_session(self, session_id: str) -> bool:
        """
        Delete a session and all its associated data.

        Args:
            session_id: The unique identifier of the session to delete.

        Returns:
            True if the session was deleted, False if it wasn't found.
        """
        session = await self.get_session(session_id)
        if not session:
            return False

        if self.use_azure:
            return await self._delete_session_azure(session_id)
        return await self._delete_session_local(session_id)

    async def _delete_session_azure(self, session_id: str) -> bool:
        """Delete a session from Azure Blob Storage."""
        try:
            container = await self._get_container_client()
            deleted_count = 0
            async for blob in container.list_blobs(name_starts_with=f"{session_id}/"):
                await container.delete_blob(blob.name)
                deleted_count += 1
            logger.info(f"Deleted session {session_id} from Azure ({deleted_count} blobs)")
            return True
        except AzureError as e:
            logger.error(f"Failed to delete session {session_id} from Azure: {e}")
            return False

    async def _delete_session_local(self, session_id: str) -> bool:
        """Delete a session from local filesystem."""
        import shutil
        session_path = self.local_path / session_id
        if session_path.exists():
            try:
                shutil.rmtree(session_path)
                logger.info(f"Deleted session {session_id} from local storage")
                return True
            except OSError as e:
                logger.error(f"Failed to delete session {session_id}: {e}")
                return False
        return False

    async def clear_session_data(self, session_id: str) -> bool:
        """
        Clear all participants and chronology entries from a session.

        Args:
            session_id: The unique identifier of the session.

        Returns:
            True if cleared successfully.
        """
        session = await self.get_session(session_id)
        if not session:
            return False

        # Clear participants
        await self._write_json(f"{session_id}/participants.json", [])

        # Clear chronology entries (stored as individual files)
        await self._delete_blobs_with_prefix(f"{session_id}/chronology/")

        # Clear segments
        await self._delete_blobs_with_prefix(f"{session_id}/segments/")

        logger.info(f"Cleared all data for session {session_id}")
        return True

    async def _delete_blobs_with_prefix(self, prefix: str) -> int:
        """Delete all blobs with a given prefix."""
        if self.use_azure:
            return await self._delete_blobs_azure(prefix)
        return await self._delete_blobs_local(prefix)

    async def _delete_blobs_azure(self, prefix: str) -> int:
        """Delete blobs from Azure with prefix."""
        try:
            container = await self._get_container_client()
            count = 0
            async for blob in container.list_blobs(name_starts_with=prefix):
                await container.delete_blob(blob.name)
                count += 1
            logger.debug(f"Deleted {count} blobs with prefix {prefix}")
            return count
        except AzureError as e:
            logger.error(f"Failed to delete blobs with prefix {prefix}: {e}")
            return 0

    async def _delete_blobs_local(self, prefix: str) -> int:
        """Delete local files with prefix."""
        import shutil
        local_dir = self.local_path / prefix.rstrip("/")
        if local_dir.exists():
            try:
                count = sum(1 for _ in local_dir.iterdir())
                shutil.rmtree(local_dir)
                logger.debug(f"Deleted {count} files in {local_dir}")
                return count
            except OSError as e:
                logger.error(f"Failed to delete {local_dir}: {e}")
                return 0
        return 0

    # ========== Participant Operations ==========

    async def get_participants(self, session_id: str) -> List[Participant]:
        """
        Get all participants for a session.

        Args:
            session_id: The unique session identifier.

        Returns:
            List of Participant objects for the session.
        """
        data = await self._read_json(f"{session_id}/participants.json")
        if data:
            return [Participant(**p) for p in data]
        return []

    async def add_participant(
        self, session_id: str, participant: Participant
    ) -> Participant:
        """
        Add a new participant to a session.

        Args:
            session_id: The unique session identifier.
            participant: The Participant object to add.

        Returns:
            The added Participant object.

        Raises:
            StorageWriteError: If adding participant fails.
        """
        participants = await self.get_participants(session_id)
        participants.append(participant)
        logger.info(
            f"Adding participant {participant.participant_id} to session {session_id}"
        )
        await self._write_json(
            f"{session_id}/participants.json",
            [p.model_dump() for p in participants],
        )
        return participant

    async def update_participant(
        self, session_id: str, participant_id: str, updates: Dict[str, Any]
    ) -> Optional[Participant]:
        """
        Update a participant's information.

        Args:
            session_id: The unique session identifier.
            participant_id: The unique participant identifier.
            updates: Dictionary of fields to update.

        Returns:
            The updated Participant object if found, None otherwise.

        Raises:
            StorageWriteError: If update fails.
        """
        participants = await self.get_participants(session_id)
        for i, p in enumerate(participants):
            if p.participant_id == participant_id:
                for key, value in updates.items():
                    if value is not None:
                        setattr(p, key, value)
                participants[i] = p
                logger.debug(f"Updating participant: {participant_id}")
                await self._write_json(
                    f"{session_id}/participants.json",
                    [p.model_dump() for p in participants],
                )
                return p
        logger.warning(f"Participant not found: {participant_id}")
        return None

    async def get_participant(
        self, session_id: str, participant_id: str
    ) -> Optional[Participant]:
        """
        Get a specific participant by ID.

        Args:
            session_id: The unique session identifier.
            participant_id: The unique participant identifier.

        Returns:
            The Participant object if found, None otherwise.
        """
        participants = await self.get_participants(session_id)
        for p in participants:
            if p.participant_id == participant_id:
                return p
        return None

    # ========== Segment Operations ==========

    async def save_segment(self, session_id: str, segment: Segment) -> Segment:
        """
        Save a speech segment.

        Args:
            session_id: The unique session identifier.
            segment: The Segment object to save.

        Returns:
            The saved Segment object.

        Raises:
            StorageWriteError: If saving fails.
        """
        timestamp_str = segment.timestamp.strftime("%Y-%m-%dT%H-%M-%S")
        path = f"{session_id}/segments/{timestamp_str}_{segment.segment_id}.json"
        logger.debug(f"Saving segment: {segment.segment_id}")
        await self._write_json(path, segment.model_dump())
        return segment

    async def save_audio(
        self, session_id: str, segment: Segment, audio_data: bytes
    ) -> str:
        """
        Save audio data for a segment.

        Args:
            session_id: The unique session identifier.
            segment: The associated Segment object.
            audio_data: The raw audio bytes to save.

        Returns:
            The storage path where audio was saved.

        Raises:
            StorageWriteError: If saving fails.
        """
        timestamp_str = segment.timestamp.strftime("%Y-%m-%dT%H-%M-%S")
        audio_path = f"{session_id}/audio/{timestamp_str}_{segment.segment_id}.wav"
        logger.debug(f"Saving audio: {audio_path} ({len(audio_data)} bytes)")
        await self._write_binary(audio_path, audio_data)
        return audio_path

    async def get_segments(self, session_id: str) -> List[Segment]:
        """
        Get all segments for a session, sorted by timestamp.

        Args:
            session_id: The unique session identifier.

        Returns:
            List of Segment objects sorted by timestamp.
        """
        prefix = f"{session_id}/segments/"
        blob_names = await self._list_blobs(prefix)
        segments: List[Segment] = []
        for blob_name in blob_names:
            data = await self._read_json(blob_name)
            if data:
                segments.append(Segment(**data))
        return sorted(segments, key=lambda s: s.timestamp)

    # ========== Chronology Operations ==========

    async def save_chronology_entry(
        self, session_id: str, entry: ChronologyEntry
    ) -> ChronologyEntry:
        """
        Save a chronology entry.

        Args:
            session_id: The unique session identifier.
            entry: The ChronologyEntry object to save.

        Returns:
            The saved ChronologyEntry object.

        Raises:
            StorageWriteError: If saving fails.
        """
        timestamp_str = entry.timestamp.strftime("%Y-%m-%dT%H-%M-%S")
        path = f"{session_id}/chronology/{timestamp_str}_{entry.entry_id}.json"
        logger.debug(f"Saving chronology entry: {entry.entry_id}")
        await self._write_json(path, entry.model_dump())
        return entry

    async def get_chronology_entries(self, session_id: str) -> List[ChronologyEntry]:
        """
        Get all chronology entries for a session, sorted by timestamp.

        Args:
            session_id: The unique session identifier.

        Returns:
            List of ChronologyEntry objects sorted by timestamp.
        """
        prefix = f"{session_id}/chronology/"
        blob_names = await self._list_blobs(prefix)
        entries: List[ChronologyEntry] = []
        for blob_name in blob_names:
            data = await self._read_json(blob_name)
            if data:
                entries.append(ChronologyEntry(**data))
        return sorted(entries, key=lambda e: e.timestamp)

    async def update_chronology_entry(
        self, session_id: str, entry_id: str, updates: Dict[str, Any]
    ) -> Optional[ChronologyEntry]:
        """
        Update a chronology entry.

        Args:
            session_id: The unique session identifier.
            entry_id: The unique entry identifier.
            updates: Dictionary of fields to update.

        Returns:
            The updated ChronologyEntry object if found, None otherwise.

        Raises:
            StorageWriteError: If update fails.
        """
        entries = await self.get_chronology_entries(session_id)
        for entry in entries:
            if entry.entry_id == entry_id:
                for key, value in updates.items():
                    if value is not None:
                        setattr(entry, key, value)
                timestamp_str = entry.timestamp.strftime("%Y-%m-%dT%H-%M-%S")
                path = f"{session_id}/chronology/{timestamp_str}_{entry.entry_id}.json"
                logger.debug(f"Updating chronology entry: {entry_id}")
                await self._write_json(path, entry.model_dump())
                return entry
        logger.warning(f"Chronology entry not found: {entry_id}")
        return None

    # ========== HQ Master Operations ==========

    async def get_hq_master(self) -> List[HQMaster]:
        """
        Get the HQ master list from configuration.

        Returns:
            List of HQMaster objects.
        """
        config_file = self.config_path / "hq_master.json"
        hq_list: List[HQMaster] = []

        if not config_file.exists():
            logger.debug("HQ master config not found, will seed default HQ")
        else:
            try:
                async with aiofiles.open(config_file, "r", encoding="utf-8") as f:
                    content = await f.read()
                    data = json.loads(content)
                    if isinstance(data, list):
                        hq_list = [HQMaster(**hq) for hq in data]
            except (OSError, json.JSONDecodeError) as e:
                logger.error(f"Failed to read HQ master config: {e}")

        # Seed minimal default: 都道府県調整本部
        if not hq_list:
            default_hq = HQMaster(
                hq_name="都道府県調整本部",
                zoom_pattern="都道府県調整本部",
                active=True,
            )
            try:
                await self.save_hq_master([default_hq])
                hq_list = [default_hq]
            except Exception as e:
                logger.error(f"Failed to seed default HQ master: {e}")

        return hq_list

    # ========== Session HQ Master Operations ==========

    async def get_session_hq_master(self, session_id: str) -> List[HQMaster]:
        """
        Get HQ master list scoped to a specific session.

        If the session-scoped HQ master does not exist yet, it is initialized
        from the global HQ master (template) and persisted under the session.
        """
        # If session belongs to an incident, HQ master is incident-scoped (shared across 4 sessions)
        session = await self.get_session(session_id)
        if session and session.incident_id:
            hqs = await self.get_incident_hq_master(session.incident_id)
            # Filter by session_kind participation flags
            return self._filter_hqs_for_kind(hqs, session.session_kind)

        path = f"{session_id}/hq_master.json"
        data = await self._read_json(path)
        if isinstance(data, list):
            try:
                return [HQMaster(**hq) for hq in data]
            except Exception as e:
                logger.error(f"Failed to parse session HQ master for {session_id}: {e}")

        # Backward compat / initialization: copy from global HQ master
        hq_list = await self.get_hq_master()
        try:
            await self.save_session_hq_master(session_id, hq_list)
        except Exception as e:
            logger.error(f"Failed to initialize session HQ master for {session_id}: {e}")
        return hq_list

    async def save_session_hq_master(self, session_id: str, hq_list: List[HQMaster]) -> None:
        """Save the session-scoped HQ master list."""
        await self._write_json(
            f"{session_id}/hq_master.json",
            [hq.model_dump() for hq in hq_list],
        )

    async def add_session_hq(self, session_id: str, hq: HQMaster) -> HQMaster:
        """Add a new HQ to a session-scoped HQ master list."""
        session = await self.get_session(session_id)
        if session and session.incident_id:
            return await self.add_incident_hq(session.incident_id, hq)
        hq_list = await self.get_session_hq_master(session_id)
        hq_list.append(hq)
        await self.save_session_hq_master(session_id, hq_list)
        return hq

    async def update_session_hq(
        self, session_id: str, hq_id: str, updates: Dict[str, Any]
    ) -> Optional[HQMaster]:
        """Update a session-scoped HQ master entry."""
        session = await self.get_session(session_id)
        if session and session.incident_id:
            return await self.update_incident_hq(session.incident_id, hq_id, updates)
        hq_list = await self.get_session_hq_master(session_id)
        for hq in hq_list:
            if hq.hq_id == hq_id:
                for key, value in updates.items():
                    if value is not None and hasattr(hq, key):
                        setattr(hq, key, value)
                await self.save_session_hq_master(session_id, hq_list)
                return hq
        return None

    async def delete_session_hq(self, session_id: str, hq_id: str) -> bool:
        """Delete a session-scoped HQ master entry."""
        session = await self.get_session(session_id)
        if session and session.incident_id:
            return await self.delete_incident_hq(session.incident_id, hq_id)
        hq_list = await self.get_session_hq_master(session_id)
        next_list = [hq for hq in hq_list if hq.hq_id != hq_id]
        if len(next_list) == len(hq_list):
            return False
        await self.save_session_hq_master(session_id, next_list)
        return True

    def _filter_hqs_for_kind(self, hqs: List[HQMaster], kind: Any) -> List[HQMaster]:
        """Filter HQs by participation flags for a session kind."""
        try:
            from ..models.schemas import SessionKind as _K
            if kind == _K.ACTIVITY_COMMAND:
                return [h for h in hqs if h.include_activity_command]
            if kind == _K.TRANSPORT_COORDINATION:
                return [h for h in hqs if h.include_transport_coordination]
            if kind == _K.INFO_ANALYSIS:
                return [h for h in hqs if h.include_info_analysis]
            if kind == _K.LOGISTICS_SUPPORT:
                return [h for h in hqs if h.include_logistics_support]
        except Exception:
            pass
        return hqs

    # ========== Incident HQ Master Operations ==========

    _LEGACY_HQ_NAMES: set[str] = {
        "本部長",
        "統括DMAT",
        "医療班本部",
        "活動拠点本部",
        "患者搬送本部",
        "情報班本部",
        "ロジスティクス本部",
        "通信班本部",
    }

    def _remove_legacy_hqs(self, hq_list: List[HQMaster]) -> List[HQMaster]:
        """Remove legacy/demo HQ entries that shouldn't appear in incident-scoped member lists."""
        return [hq for hq in hq_list if getattr(hq, "hq_name", "") not in self._LEGACY_HQ_NAMES]

    async def get_incident_hq_master(self, incident_id: str) -> List[HQMaster]:
        data = await self._read_json(f"incidents/{incident_id}/hq_master.json")
        if isinstance(data, list):
            try:
                parsed = [HQMaster(**hq) for hq in data]
                cleaned = self._remove_legacy_hqs(parsed)
                # If we removed anything, persist back (best-effort) so UIs stay consistent.
                if len(cleaned) != len(parsed):
                    try:
                        await self.save_incident_hq_master(incident_id, cleaned)
                    except Exception as e:
                        logger.error(f"Failed to persist cleaned incident HQ master for {incident_id}: {e}")
                return cleaned
            except Exception as e:
                logger.error(f"Failed to parse incident HQ master for {incident_id}: {e}")
        # Initialize from global template if missing
        template = await self.get_hq_master()
        template = self._remove_legacy_hqs(template)
        try:
            await self.save_incident_hq_master(incident_id, template)
        except Exception as e:
            logger.error(f"Failed to seed incident HQ master for {incident_id}: {e}")
        return template

    async def save_incident_hq_master(self, incident_id: str, hq_list: List[HQMaster]) -> None:
        await self._write_json(
            f"incidents/{incident_id}/hq_master.json",
            [hq.model_dump() for hq in hq_list],
        )

    async def add_incident_hq(self, incident_id: str, hq: HQMaster) -> HQMaster:
        hq_list = await self.get_incident_hq_master(incident_id)
        hq_list.append(hq)
        await self.save_incident_hq_master(incident_id, hq_list)
        return hq

    async def update_incident_hq(self, incident_id: str, hq_id: str, updates: Dict[str, Any]) -> Optional[HQMaster]:
        hq_list = await self.get_incident_hq_master(incident_id)
        for hq in hq_list:
            if hq.hq_id == hq_id:
                for key, value in updates.items():
                    if value is not None and hasattr(hq, key):
                        setattr(hq, key, value)
                await self.save_incident_hq_master(incident_id, hq_list)
                return hq
        return None

    async def delete_incident_hq(self, incident_id: str, hq_id: str) -> bool:
        hq_list = await self.get_incident_hq_master(incident_id)
        next_list = [hq for hq in hq_list if hq.hq_id != hq_id]
        if len(next_list) == len(hq_list):
            return False
        await self.save_incident_hq_master(incident_id, next_list)
        return True

    async def save_hq_master(self, hq_list: List[HQMaster]) -> None:
        """
        Save the HQ master list to configuration.

        Args:
            hq_list: List of HQMaster objects to save.

        Raises:
            StorageWriteError: If saving fails.
        """
        config_file = self.config_path / "hq_master.json"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(
            [hq.model_dump() for hq in hq_list], ensure_ascii=False, indent=2
        )
        try:
            async with aiofiles.open(config_file, "w", encoding="utf-8") as f:
                await f.write(content)
            logger.info(f"Saved HQ master config with {len(hq_list)} entries")
        except OSError as e:
            logger.error(f"Failed to save HQ master config: {e}")
            raise StorageWriteError(f"Failed to save HQ master: {e}") from e

    async def add_hq(self, hq: HQMaster) -> HQMaster:
        """
        Add a new HQ to the master list.

        Args:
            hq: The HQMaster object to add.

        Returns:
            The added HQMaster object.

        Raises:
            StorageWriteError: If adding fails.
        """
        hq_list = await self.get_hq_master()
        hq_list.append(hq)
        logger.info(f"Adding HQ: {hq.hq_id} ({hq.hq_name})")
        await self.save_hq_master(hq_list)
        return hq

    async def update_hq(
        self, hq_id: str, updates: Dict[str, Any]
    ) -> Optional[HQMaster]:
        """
        Update an HQ entry.

        Args:
            hq_id: The unique HQ identifier.
            updates: Dictionary of fields to update.

        Returns:
            The updated HQMaster object if found, None otherwise.

        Raises:
            StorageWriteError: If update fails.
        """
        hq_list = await self.get_hq_master()
        for i, hq in enumerate(hq_list):
            if hq.hq_id == hq_id:
                for key, value in updates.items():
                    if value is not None:
                        setattr(hq, key, value)
                hq_list[i] = hq
                logger.info(f"Updating HQ: {hq_id}")
                await self.save_hq_master(hq_list)
                return hq
        logger.warning(f"HQ not found for update: {hq_id}")
        return None

    async def delete_hq(self, hq_id: str) -> bool:
        """
        Delete an HQ from the master list.

        Args:
            hq_id: The unique HQ identifier.

        Returns:
            True if deleted, False if not found.

        Raises:
            StorageWriteError: If deletion fails.
        """
        hq_list = await self.get_hq_master()
        for i, hq in enumerate(hq_list):
            if hq.hq_id == hq_id:
                hq_list.pop(i)
                logger.info(f"Deleting HQ: {hq_id}")
                await self.save_hq_master(hq_list)
                return True
        logger.warning(f"HQ not found for deletion: {hq_id}")
        return False

    # ========== Zoom Credentials Operations ==========

    async def get_zoom_credentials(self) -> ZoomCredentials:
        """
        Get Zoom API credentials from configuration.

        Returns:
            ZoomCredentials object (may be unconfigured).
        """
        config_file = self.config_path / "zoom_credentials.json"
        if not config_file.exists():
            logger.debug("Zoom credentials config not found, returning defaults")
            return ZoomCredentials()
        try:
            async with aiofiles.open(config_file, "r", encoding="utf-8") as f:
                content = await f.read()
                data = json.loads(content)
                return ZoomCredentials(**data)
        except (OSError, json.JSONDecodeError) as e:
            logger.error(f"Failed to read Zoom credentials config: {e}")
            return ZoomCredentials()

    async def save_zoom_credentials(self, credentials: ZoomCredentials) -> None:
        """
        Save Zoom API credentials to configuration.

        Args:
            credentials: The ZoomCredentials object to save.

        Raises:
            StorageWriteError: If saving fails.
        """
        config_file = self.config_path / "zoom_credentials.json"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(credentials.model_dump(), ensure_ascii=False, indent=2)
        try:
            async with aiofiles.open(config_file, "w", encoding="utf-8") as f:
                await f.write(content)
            logger.info("Saved Zoom credentials config")
        except OSError as e:
            logger.error(f"Failed to save Zoom credentials config: {e}")
            raise StorageWriteError(f"Failed to save Zoom credentials: {e}") from e

    # ========== LLM Settings Operations ==========

    async def get_llm_settings(self) -> LLMSettings:
        """
        Get LLM settings from configuration.

        Returns:
            LLMSettings object with custom prompt or defaults.
        """
        config_file = self.config_path / "llm_settings.json"
        if not config_file.exists():
            logger.debug("LLM settings config not found, returning defaults")
            return LLMSettings()
        try:
            async with aiofiles.open(config_file, "r", encoding="utf-8") as f:
                content = await f.read()
                data = json.loads(content)
                return LLMSettings(**data)
        except (OSError, json.JSONDecodeError) as e:
            logger.error(f"Failed to read LLM settings config: {e}")
            return LLMSettings()

    async def save_llm_settings(self, settings_data: LLMSettings) -> None:
        """
        Save LLM settings to configuration.

        Args:
            settings_data: The LLMSettings object to save.

        Raises:
            StorageWriteError: If saving fails.
        """
        config_file = self.config_path / "llm_settings.json"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(settings_data.model_dump(), ensure_ascii=False, indent=2)
        try:
            async with aiofiles.open(config_file, "w", encoding="utf-8") as f:
                await f.write(content)
            logger.info("Saved LLM settings config")
        except OSError as e:
            logger.error(f"Failed to save LLM settings config: {e}")
            raise StorageWriteError(f"Failed to save LLM settings: {e}") from e

    # ========== User Dictionary Operations ==========

    async def get_dictionary_entries(self) -> List[DictionaryEntry]:
        """
        Get user dictionary entries for STT correction.

        Returns:
            List of DictionaryEntry objects.
        """
        config_file = self.config_path / "user_dictionary.json"
        if not config_file.exists():
            logger.debug("User dictionary config not found, returning empty list")
            return []
        try:
            async with aiofiles.open(config_file, "r", encoding="utf-8") as f:
                content = await f.read()
                data = json.loads(content)
                if isinstance(data, list):
                    return [DictionaryEntry(**entry) for entry in data]
        except (OSError, json.JSONDecodeError) as e:
            logger.error(f"Failed to read user dictionary config: {e}")
        return []

    async def save_dictionary_entries(self, entries: List[DictionaryEntry]) -> None:
        """
        Save user dictionary entries.

        Args:
            entries: List of DictionaryEntry objects to save.

        Raises:
            StorageWriteError: If saving fails.
        """
        config_file = self.config_path / "user_dictionary.json"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(
            [e.model_dump() for e in entries], ensure_ascii=False, indent=2
        )
        try:
            async with aiofiles.open(config_file, "w", encoding="utf-8") as f:
                await f.write(content)
            logger.info(f"Saved user dictionary with {len(entries)} entries")
        except OSError as e:
            logger.error(f"Failed to save user dictionary config: {e}")
            raise StorageWriteError(f"Failed to save user dictionary: {e}") from e

    async def add_dictionary_entry(self, entry: DictionaryEntry) -> DictionaryEntry:
        """
        Add a new dictionary entry.

        Args:
            entry: The DictionaryEntry object to add.

        Returns:
            The added DictionaryEntry object.
        """
        entries = await self.get_dictionary_entries()
        entries.append(entry)
        logger.info(f"Adding dictionary entry: {entry.wrong_text} -> {entry.correct_text}")
        await self.save_dictionary_entries(entries)
        return entry

    async def update_dictionary_entry(
        self, entry_id: str, updates: Dict[str, Any]
    ) -> Optional[DictionaryEntry]:
        """
        Update a dictionary entry.

        Args:
            entry_id: The unique entry identifier.
            updates: Dictionary of fields to update.

        Returns:
            The updated DictionaryEntry if found, None otherwise.
        """
        entries = await self.get_dictionary_entries()
        for i, entry in enumerate(entries):
            if entry.entry_id == entry_id:
                for key, value in updates.items():
                    if value is not None:
                        setattr(entry, key, value)
                entries[i] = entry
                logger.info(f"Updating dictionary entry: {entry_id}")
                await self.save_dictionary_entries(entries)
                return entry
        logger.warning(f"Dictionary entry not found for update: {entry_id}")
        return None

    async def delete_dictionary_entry(self, entry_id: str) -> bool:
        """
        Delete a dictionary entry.

        Args:
            entry_id: The unique entry identifier.

        Returns:
            True if deleted, False if not found.
        """
        entries = await self.get_dictionary_entries()
        for i, entry in enumerate(entries):
            if entry.entry_id == entry_id:
                entries.pop(i)
                logger.info(f"Deleting dictionary entry: {entry_id}")
                await self.save_dictionary_entries(entries)
                return True
        logger.warning(f"Dictionary entry not found for deletion: {entry_id}")
        return False

    # ========== Cleanup ==========

    async def close(self) -> None:
        """
        Close the storage service and release resources.

        Should be called when the application shuts down.
        """
        if self._blob_service_client:
            logger.info("Closing Azure Blob Storage connection")
            await self._blob_service_client.close()
            self._blob_service_client = None
            self._container_client = None


# Singleton instance
storage_service = StorageService()
