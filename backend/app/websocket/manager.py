from typing import Dict, List, Set
from fastapi import WebSocket
import json
import asyncio

from ..models.schemas import WSMessage, WSMessageType


class ConnectionManager:
    """
    WebSocket接続を管理するクラス
    セッションごとに接続を管理し、リアルタイム更新を配信
    """

    def __init__(self):
        # session_id -> set of WebSocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # 全体通知用
        self.global_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket, session_id: str = None):
        """
        WebSocket接続を受け入れる

        Args:
            websocket: WebSocket接続
            session_id: セッションID（指定しない場合は全体通知のみ）
        """
        await websocket.accept()

        if session_id:
            if session_id not in self.active_connections:
                self.active_connections[session_id] = set()
            self.active_connections[session_id].add(websocket)
        else:
            self.global_connections.add(websocket)

    def disconnect(self, websocket: WebSocket, session_id: str = None):
        """
        WebSocket接続を切断

        Args:
            websocket: WebSocket接続
            session_id: セッションID
        """
        if session_id and session_id in self.active_connections:
            self.active_connections[session_id].discard(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]
        else:
            self.global_connections.discard(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        """個別メッセージ送信"""
        try:
            await websocket.send_text(message)
        except Exception:
            pass

    async def broadcast_to_session(self, session_id: str, message: WSMessage):
        """
        特定セッションの全クライアントにブロードキャスト

        Args:
            session_id: セッションID
            message: 送信メッセージ
        """
        if session_id not in self.active_connections:
            return

        message_json = message.model_dump_json()
        disconnected = []

        for connection in self.active_connections[session_id]:
            try:
                await connection.send_text(message_json)
            except Exception:
                disconnected.append(connection)

        # 切断された接続を削除
        for conn in disconnected:
            self.active_connections[session_id].discard(conn)

    async def broadcast_global(self, message: WSMessage):
        """
        全クライアントにブロードキャスト（セッション一覧更新など）

        Args:
            message: 送信メッセージ
        """
        message_json = message.model_dump_json()
        disconnected = []

        for connection in self.global_connections:
            try:
                await connection.send_text(message_json)
            except Exception:
                disconnected.append(connection)

        # 切断された接続を削除
        for conn in disconnected:
            self.global_connections.discard(conn)

    async def notify_new_entry(self, session_id: str, entry_data: dict):
        """新しいクロノロジーエントリを通知"""
        message = WSMessage(
            type=WSMessageType.NEW_ENTRY,
            data=entry_data
        )
        await self.broadcast_to_session(session_id, message)

    async def notify_participant_update(self, session_id: str, participant_data: dict):
        """参加者更新を通知"""
        message = WSMessage(
            type=WSMessageType.PARTICIPANT_UPDATE,
            data=participant_data
        )
        await self.broadcast_to_session(session_id, message)

    async def notify_session_update(self, session_id: str, session_data: dict):
        """セッション更新を通知"""
        message = WSMessage(
            type=WSMessageType.SESSION_UPDATE,
            data=session_data
        )
        await self.broadcast_to_session(session_id, message)
        await self.broadcast_global(message)

    def get_connection_count(self, session_id: str = None) -> int:
        """接続数を取得"""
        if session_id:
            return len(self.active_connections.get(session_id, set()))
        return sum(len(conns) for conns in self.active_connections.values()) + len(self.global_connections)


# Singleton instance
connection_manager = ConnectionManager()
