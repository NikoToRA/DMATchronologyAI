"""
Chat Service Module

Provides AI chat functionality using Azure OpenAI.
Enables users to discuss chronology entries with an AI assistant.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from openai import AsyncAzureOpenAI, APIError, APIConnectionError, RateLimitError

from ..config import settings
from ..models.schemas import (
    ChatThread,
    ChatMessage,
    ChatMessageRole,
    ChatThreadSummary,
    ChronologyEntry,
    generate_uuid,
)

logger = logging.getLogger(__name__)


class ChatServiceError(Exception):
    """Base exception for chat service operations."""
    pass


class ChatService:
    """
    Azure OpenAI-based chat service for chronology discussions.

    Allows users to ask questions about chronology entries and
    receive AI-powered responses with context awareness.
    """

    # OpenAI API configuration
    _API_VERSION: str = "2024-02-15-preview"
    _DEFAULT_TEMPERATURE: float = 0.7
    _DEFAULT_MAX_TOKENS: int = 1000

    # System prompt template
    SYSTEM_PROMPT_TEMPLATE: str = """あなたは災害対応本部のAIアシスタントです。
物資支援班のクロノロジー（活動記録）を分析し、質問に回答します。

## あなたの役割
- クロノロジーの内容を踏まえて、状況把握や意思決定を支援する
- 質問に対して、クロノロジーの情報を引用しながら回答する
- 必要に応じて、追加の確認事項や提案を行う

## 回答のガイドライン
- 簡潔かつ明確に回答する
- クロノロジーに記載されている事実と、あなたの推測を区別する
- 不明な点は正直に「クロノロジーには記載がありません」と伝える

## コンテキスト情報
- 災害名: {incident_name}
- 本部名: {hq_name}
- セッション: 物資支援班

{chronology_context}
"""

    def __init__(self) -> None:
        """Initialize the chat service with Azure OpenAI credentials."""
        self.endpoint: str = settings.azure_openai_endpoint
        self.api_key: str = settings.azure_openai_key
        self.deployment: str = settings.azure_openai_deployment
        self._client: Optional[AsyncAzureOpenAI] = None

        if self.is_configured():
            logger.info(f"ChatService initialized with deployment: {self.deployment}")
        else:
            logger.warning("ChatService initialized without Azure OpenAI")

    def _get_client(self) -> Optional[AsyncAzureOpenAI]:
        """Get or create the Azure OpenAI client (lazy initialization)."""
        if not self.endpoint or not self.api_key:
            return None

        if self._client is None:
            try:
                self._client = AsyncAzureOpenAI(
                    azure_endpoint=self.endpoint,
                    api_key=self.api_key,
                    api_version=self._API_VERSION,
                )
                logger.debug("Azure OpenAI client initialized for chat")
            except Exception as e:
                logger.error(f"Failed to create Azure OpenAI client: {e}")
                return None

        return self._client

    def is_configured(self) -> bool:
        """Check if the chat service is properly configured."""
        return bool(self.endpoint and self.api_key)

    def _format_chronology_context(
        self,
        entries: list[ChronologyEntry],
        max_entries: int = 100,
    ) -> str:
        """
        Format chronology entries as context for the AI.

        Args:
            entries: List of chronology entries.
            max_entries: Maximum number of entries to include.

        Returns:
            Formatted string of chronology entries.
        """
        if not entries:
            return "## クロノロジー\n（まだエントリがありません）"

        # Sort by timestamp descending, take most recent
        sorted_entries = sorted(
            entries,
            key=lambda e: e.timestamp,
            reverse=True,
        )[:max_entries]

        # Reverse to show oldest first in context
        sorted_entries.reverse()

        lines = ["## クロノロジー（直近の活動記録）"]
        for entry in sorted_entries:
            timestamp_str = entry.timestamp.strftime("%H:%M") if entry.timestamp else "??:??"
            hq_name = getattr(entry, 'hq_name', None) or "不明"
            lines.append(
                f"- [{timestamp_str}] [{entry.category.value}] ({hq_name}) {entry.summary}"
            )
            if entry.ai_note:
                lines.append(f"  詳細: {entry.ai_note[:100]}...")

        return "\n".join(lines)

    def _build_system_prompt(
        self,
        incident_name: str,
        hq_name: str,
        entries: list[ChronologyEntry],
    ) -> str:
        """Build the system prompt with context."""
        chronology_context = self._format_chronology_context(entries)
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            incident_name=incident_name or "不明",
            hq_name=hq_name or "不明",
            chronology_context=chronology_context,
        )

    def _build_messages_for_api(
        self,
        thread: ChatThread,
        system_prompt: str,
    ) -> list[dict]:
        """Build the messages array for OpenAI API."""
        messages = [{"role": "system", "content": system_prompt}]

        for msg in thread.messages:
            if msg.role == ChatMessageRole.USER:
                messages.append({"role": "user", "content": msg.content})
            elif msg.role == ChatMessageRole.ASSISTANT:
                messages.append({"role": "assistant", "content": msg.content})

        return messages

    async def generate_response(
        self,
        thread: ChatThread,
        user_message: str,
        entries: list[ChronologyEntry],
        incident_name: str = "",
        hq_name: str = "",
    ) -> str:
        """
        Generate an AI response for the chat thread.

        Args:
            thread: The chat thread with message history.
            user_message: The new user message.
            entries: Current chronology entries for context.
            incident_name: Name of the incident/disaster.
            hq_name: Name of the user's HQ.

        Returns:
            AI-generated response text.

        Raises:
            ChatServiceError: If AI generation fails.
        """
        if not self.is_configured():
            return "申し訳ありません。AIサービスが設定されていません。管理者にお問い合わせください。"

        client = self._get_client()
        if client is None:
            return "申し訳ありません。AIサービスに接続できません。しばらく経ってからお試しください。"

        try:
            # Build system prompt with chronology context
            system_prompt = self._build_system_prompt(incident_name, hq_name, entries)

            # Build messages array
            messages = self._build_messages_for_api(thread, system_prompt)
            messages.append({"role": "user", "content": user_message})

            # Call OpenAI
            response = await client.chat.completions.create(
                model=self.deployment,
                messages=messages,
                temperature=self._DEFAULT_TEMPERATURE,
                max_tokens=self._DEFAULT_MAX_TOKENS,
            )

            content = response.choices[0].message.content
            if content is None:
                logger.warning("OpenAI returned empty response")
                return "申し訳ありません。回答を生成できませんでした。"

            return content.strip()

        except RateLimitError as e:
            logger.warning(f"OpenAI rate limit exceeded: {e}")
            return "申し訳ありません。リクエストが集中しています。しばらく経ってからお試しください。"

        except APIConnectionError as e:
            logger.error(f"OpenAI connection error: {e}")
            return "申し訳ありません。AIサービスに接続できません。ネットワーク状態を確認してください。"

        except APIError as e:
            logger.error(f"OpenAI API error: {e}")
            return "申し訳ありません。AIサービスでエラーが発生しました。"

        except Exception as e:
            logger.error(f"Unexpected chat error: {e}", exc_info=True)
            return "申し訳ありません。予期せぬエラーが発生しました。"

    async def generate_thread_title(self, first_message: str) -> str:
        """
        Generate a short title for a thread based on the first message.

        Args:
            first_message: The first user message in the thread.

        Returns:
            A short title (max 30 chars).
        """
        if not self.is_configured():
            # Fallback: truncate the message
            return first_message[:30] + "..." if len(first_message) > 30 else first_message

        client = self._get_client()
        if client is None:
            return first_message[:30] + "..." if len(first_message) > 30 else first_message

        try:
            response = await client.chat.completions.create(
                model=self.deployment,
                messages=[
                    {
                        "role": "system",
                        "content": "以下のメッセージの内容を10文字以内の日本語タイトルにまとめてください。タイトルのみを出力してください。",
                    },
                    {"role": "user", "content": first_message},
                ],
                temperature=0.3,
                max_tokens=50,
            )

            title = response.choices[0].message.content
            if title:
                title = title.strip().replace('"', '').replace("「", "").replace("」", "")
                return title[:30] if len(title) > 30 else title

        except Exception as e:
            logger.warning(f"Failed to generate title: {e}")

        # Fallback
        return first_message[:30] + "..." if len(first_message) > 30 else first_message


# Singleton instance
chat_service = ChatService()
