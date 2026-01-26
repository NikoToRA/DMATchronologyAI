"""
Chat API Router

Provides endpoints for AI chat functionality in the chronology system.
"""

import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Query

from ..models.schemas import (
    ChatMessage,
    ChatMessageCreate,
    ChatMessageRole,
    ChatThread,
    ChatThreadCreate,
    ChatThreadResponse,
    ChatThreadSummary,
    generate_uuid,
)
from ..services.storage import storage_service
from ..services.chat_service import chat_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


@router.get(
    "/sessions/{session_id}/chat/threads",
    response_model=List[ChatThreadSummary],
    summary="List chat threads",
    description="Get all chat threads for a session with write permission info",
)
async def list_threads(
    session_id: str,
    hq_id: str = Query(..., description="Requesting user's HQ ID"),
) -> List[ChatThreadSummary]:
    """List all chat threads for a session."""
    threads = await storage_service.get_chat_threads(session_id)

    summaries = []
    for thread in threads:
        summaries.append(
            ChatThreadSummary(
                thread_id=thread.thread_id,
                session_id=thread.session_id,
                creator_hq_id=thread.creator_hq_id,
                creator_hq_name=thread.creator_hq_name,
                title=thread.title,
                created_at=thread.created_at,
                updated_at=thread.updated_at,
                message_count=len(thread.messages),
                can_write=(thread.creator_hq_id == hq_id),
            )
        )

    return summaries


@router.get(
    "/sessions/{session_id}/chat/threads/{thread_id}",
    response_model=ChatThreadResponse,
    summary="Get chat thread detail",
    description="Get a specific chat thread with all messages",
)
async def get_thread(
    session_id: str,
    thread_id: str,
    hq_id: str = Query(..., description="Requesting user's HQ ID"),
) -> ChatThreadResponse:
    """Get a specific chat thread with all messages."""
    thread = await storage_service.get_chat_thread(session_id, thread_id)

    if thread is None:
        raise HTTPException(status_code=404, detail="スレッドが見つかりません")

    return ChatThreadResponse(
        thread=thread,
        can_write=(thread.creator_hq_id == hq_id),
    )


@router.post(
    "/sessions/{session_id}/chat/threads",
    response_model=dict,
    summary="Create new chat thread",
    description="Create a new chat thread and get AI response",
)
async def create_thread(
    session_id: str,
    request: ChatThreadCreate,
) -> dict:
    """Create a new chat thread with initial message and AI response."""
    # Get session info for context
    session = await storage_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="セッションが見つかりません")

    # Create thread
    thread = ChatThread(
        thread_id=generate_uuid(),
        session_id=session_id,
        creator_hq_id=request.hq_id,
        creator_hq_name=request.hq_name,
        title="新規相談",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        messages=[],
    )

    # Add user message
    user_message = ChatMessage(
        message_id=generate_uuid(),
        thread_id=thread.thread_id,
        role=ChatMessageRole.USER,
        content=request.message,
        timestamp=datetime.now(timezone.utc),
    )
    thread.messages.append(user_message)

    # Get chronology entries for context
    entries = []
    if request.include_chronology:
        entries = await storage_service.get_chronology_entries(session_id)

    # Generate AI response
    ai_response_text = await chat_service.generate_response(
        thread=thread,
        user_message=request.message,
        entries=entries,
        incident_name=session.incident_name or "",
        hq_name=request.hq_name,
    )

    # Add AI response message
    ai_message = ChatMessage(
        message_id=generate_uuid(),
        thread_id=thread.thread_id,
        role=ChatMessageRole.ASSISTANT,
        content=ai_response_text,
        timestamp=datetime.now(timezone.utc),
    )
    thread.messages.append(ai_message)

    # Generate title from first message
    thread.title = await chat_service.generate_thread_title(request.message)
    thread.updated_at = datetime.now(timezone.utc)

    # Save thread
    await storage_service.save_chat_thread(session_id, thread)

    logger.info(
        f"Created chat thread {thread.thread_id} for session {session_id} by {request.hq_name}"
    )

    return {
        "thread": {
            "id": thread.thread_id,
            "creator_hq_id": thread.creator_hq_id,
            "creator_hq_name": thread.creator_hq_name,
            "title": thread.title,
            "can_write": True,
        },
        "message": {
            "id": ai_message.message_id,
            "role": ai_message.role.value,
            "content": ai_message.content,
            "timestamp": ai_message.timestamp.isoformat(),
        },
    }


@router.post(
    "/sessions/{session_id}/chat/threads/{thread_id}/messages",
    response_model=dict,
    summary="Send message to thread",
    description="Send a message to an existing thread (creator only)",
)
async def send_message(
    session_id: str,
    thread_id: str,
    request: ChatMessageCreate,
) -> dict:
    """Send a message to an existing thread and get AI response."""
    # Get thread
    thread = await storage_service.get_chat_thread(session_id, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="スレッドが見つかりません")

    # Check write permission
    if thread.creator_hq_id != request.hq_id:
        raise HTTPException(
            status_code=403,
            detail="このスレッドへの書き込み権限がありません",
        )

    # Get session info for context
    session = await storage_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="セッションが見つかりません")

    # Add user message
    user_message = ChatMessage(
        message_id=generate_uuid(),
        thread_id=thread.thread_id,
        role=ChatMessageRole.USER,
        content=request.message,
        timestamp=datetime.now(timezone.utc),
    )
    thread.messages.append(user_message)

    # Get chronology entries for context
    entries = []
    if request.include_chronology:
        entries = await storage_service.get_chronology_entries(session_id)

    # Generate AI response
    ai_response_text = await chat_service.generate_response(
        thread=thread,
        user_message=request.message,
        entries=entries,
        incident_name=session.incident_name or "",
        hq_name=thread.creator_hq_name,
    )

    # Add AI response message
    ai_message = ChatMessage(
        message_id=generate_uuid(),
        thread_id=thread.thread_id,
        role=ChatMessageRole.ASSISTANT,
        content=ai_response_text,
        timestamp=datetime.now(timezone.utc),
    )
    thread.messages.append(ai_message)

    # Update thread
    thread.updated_at = datetime.now(timezone.utc)
    await storage_service.save_chat_thread(session_id, thread)

    logger.info(
        f"Added message to thread {thread_id} in session {session_id}"
    )

    return {
        "message": {
            "id": ai_message.message_id,
            "role": ai_message.role.value,
            "content": ai_message.content,
            "timestamp": ai_message.timestamp.isoformat(),
        },
    }
