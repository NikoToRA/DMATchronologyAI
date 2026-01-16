"""
Classifier Service Module

Provides speech classification and summarization using Azure OpenAI.
Categorizes disaster response meeting statements into predefined types
and extracts key summaries.
"""

import json
import logging
import re
from typing import Dict, List, Optional, Tuple

from openai import AsyncAzureOpenAI, APIError, APIConnectionError, RateLimitError

from ..config import settings
from ..models.schemas import Category

logger = logging.getLogger(__name__)


class ClassifierError(Exception):
    """Base exception for classifier operations."""

    pass


class ClassifierConfigurationError(ClassifierError):
    """Exception raised when classifier is not properly configured."""

    pass


class ClassificationError(ClassifierError):
    """Exception raised when classification fails."""

    pass


class ClassifierService:
    """
    Azure OpenAI-based speech classification and summarization service.

    This service classifies disaster response meeting statements into
    predefined categories (instruction, request, report, decision,
    confirmation, risk, other) and generates concise summaries.

    When Azure OpenAI is not configured, falls back to keyword-based
    classification.

    Attributes:
        endpoint: Azure OpenAI endpoint URL.
        api_key: Azure OpenAI API key.
        deployment: Azure OpenAI deployment name.

    Example:
        >>> classifier = ClassifierService()
        >>> category, summary = await classifier.classify_and_summarize(
        ...     "医療班本部です。救急車の配備が完了しました。"
        ... )
        >>> print(f"{category.value}: {summary}")
        報告: 救急車の配備が完了
    """

    # Keyword mappings for fallback classification
    CATEGORY_KEYWORDS: Dict[Category, List[str]] = {
        Category.INSTRUCTION: [
            "してください",
            "指示します",
            "命じます",
            "やってください",
            "実施せよ",
        ],
        Category.REQUEST: [
            "お願いします",
            "依頼",
            "頼みます",
            "していただけ",
            "できますか",
        ],
        Category.REPORT: ["報告します", "完了", "現状", "状況", "報告"],
        Category.DECISION: ["決定", "とします", "決まり", "合意", "方針"],
        Category.CONFIRMATION: ["ですか？", "確認", "でしょうか", "ますか？", "認識で"],
        Category.RISK: ["問題", "リスク", "懸念", "危険", "注意", "課題"],
    }

    # System prompt for OpenAI classification
    SYSTEM_PROMPT: str = """あなたは災害医療のクロノロジー作成のエキスパートです。音声入力（文字起こし）を読み、災害対応会議の発言を分類し、クロノロジー用に要約します。

発言を以下の7種別のいずれかに分類し、簡潔な要点を抽出してください。

## 種別
- 指示: 上位→下位への命令（例：「してください」「指示します」）
- 依頼: 横の連携、お願い（例：「お願いします」「依頼」）
- 報告: 状況共有（例：「報告します」「完了」「現状」）
- 決定: 合意・決定事項（例：「決定」「とします」）
- 確認: 質問・確認（例：「ですか？」「確認」）
- リスク: 問題・懸念（例：「問題」「リスク」「懸念」）
- その他: 上記に該当しない

## 出力形式
必ず以下のJSON形式で出力してください：
{
  "category": "種別名",
  "summary": "表題（1行・短め）",
  "ai_note": "要約（2〜4文。固有名詞や数量・時間は残す）"
}
"""

    # Category name mapping (Japanese to enum)
    _CATEGORY_MAP: Dict[str, Category] = {
        "指示": Category.INSTRUCTION,
        "依頼": Category.REQUEST,
        "報告": Category.REPORT,
        "決定": Category.DECISION,
        "確認": Category.CONFIRMATION,
        "リスク": Category.RISK,
        "その他": Category.OTHER,
    }

    # OpenAI API configuration
    _API_VERSION: str = "2024-02-15-preview"
    _DEFAULT_TEMPERATURE: float = 0.3
    _DEFAULT_MAX_TOKENS: int = 100

    def __init__(self) -> None:
        """Initialize the classifier service with Azure OpenAI credentials."""
        self.endpoint: str = settings.azure_openai_endpoint
        self.api_key: str = settings.azure_openai_key
        self.deployment: str = settings.azure_openai_deployment
        self._client: Optional[AsyncAzureOpenAI] = None

        if self.is_configured():
            logger.info(
                f"ClassifierService initialized with deployment: {self.deployment}"
            )
        else:
            logger.warning(
                "ClassifierService initialized without Azure OpenAI - "
                "using keyword-based classification"
            )

    def _get_client(self) -> Optional[AsyncAzureOpenAI]:
        """
        Get or create the Azure OpenAI client (lazy initialization).

        Returns:
            AsyncAzureOpenAI client if configured, None otherwise.
        """
        if not self.endpoint or not self.api_key:
            return None

        if self._client is None:
            try:
                self._client = AsyncAzureOpenAI(
                    azure_endpoint=self.endpoint,
                    api_key=self.api_key,
                    api_version=self._API_VERSION,
                )
                logger.debug("Azure OpenAI client initialized")
            except Exception as e:
                logger.error(f"Failed to create Azure OpenAI client: {e}")
                return None

        return self._client

    def is_configured(self) -> bool:
        """
        Check if the classifier service is properly configured.

        Returns:
            True if Azure OpenAI endpoint and API key are set.
        """
        return bool(self.endpoint and self.api_key)

    def _keyword_classify(self, text: str) -> Optional[Category]:
        """
        Classify text using keyword matching.

        Args:
            text: Text to classify.

        Returns:
            Matched Category if keywords found, None otherwise.
        """
        for category, keywords in self.CATEGORY_KEYWORDS.items():
            for keyword in keywords:
                if keyword in text:
                    return category
        return None

    def _extract_summary_simple(self, text: str, max_length: int = 20) -> str:
        """
        Extract a simple summary from text.

        Removes common prefixes like "〇〇本部です" and truncates to max length.

        Args:
            text: Text to summarize.
            max_length: Maximum summary length.

        Returns:
            Truncated summary string.
        """
        # Remove common HQ announcement prefix
        cleaned = re.sub(r"^.{1,10}本部です[。、]?\s*", "", text)
        if len(cleaned) <= max_length:
            return cleaned
        return cleaned[:max_length] + "..."

    async def classify_and_summarize(
        self,
        text: str,
        hq_name: Optional[str] = None,
    ) -> Tuple[Category, str, str]:
        """
        Classify a statement and extract its summary.

        Uses Azure OpenAI when configured, otherwise falls back to
        keyword-based classification.

        Args:
            text: The statement text to classify.
            hq_name: Optional HQ name for context (currently unused but
                reserved for future prompt enhancement).

        Returns:
            Tuple of (category, summary).

        Note:
            Returns (Category.OTHER, "") for empty text.
            Falls back to keyword classification on API errors.
        """
        # Handle empty text
        if not text or not text.strip():
            logger.debug("Empty text provided, returning OTHER category")
            return Category.OTHER, "", ""

        # Use keyword classification if OpenAI not configured
        if not self.is_configured():
            logger.debug("Using keyword-based classification (OpenAI not configured)")
            return self._fallback_classify(text)

        client = self._get_client()
        if client is None:
            logger.warning("Failed to get OpenAI client, using fallback")
            return self._fallback_classify(text)

        try:
            result = await self._classify_with_openai(client, text)
            if result is not None:
                return result

            # OpenAI response couldn't be parsed
            logger.warning("Failed to parse OpenAI response, using fallback")
            return self._fallback_classify(text)

        except RateLimitError as e:
            logger.warning(f"OpenAI rate limit exceeded: {e}")
            return self._fallback_classify(text)

        except APIConnectionError as e:
            logger.error(f"OpenAI connection error: {e}")
            return self._fallback_classify(text)

        except APIError as e:
            logger.error(f"OpenAI API error: {e}")
            return self._fallback_classify(text)

        except Exception as e:
            logger.error(f"Unexpected classification error: {e}", exc_info=True)
            return self._fallback_classify(text)

    async def _classify_with_openai(
        self,
        client: AsyncAzureOpenAI,
        text: str,
    ) -> Optional[Tuple[Category, str, str]]:
        """
        Classify text using Azure OpenAI.

        Args:
            client: Azure OpenAI client.
            text: Text to classify.

        Returns:
            Tuple of (category, summary) if successful, None on parse failure.

        Raises:
            APIError: On OpenAI API errors.
            APIConnectionError: On connection failures.
            RateLimitError: On rate limit exceeded.
        """
        response = await client.chat.completions.create(
            model=self.deployment,
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": f"発言: {text}"},
            ],
            temperature=self._DEFAULT_TEMPERATURE,
            max_tokens=self._DEFAULT_MAX_TOKENS,
        )

        content = response.choices[0].message.content
        if content is None:
            logger.warning("OpenAI returned empty response content")
            return None

        return self._parse_response(content)

    def _parse_response(self, content: str) -> Optional[Tuple[Category, str, str]]:
        """
        Parse OpenAI response JSON.

        Args:
            content: Raw response content from OpenAI.

        Returns:
            Tuple of (category, summary) if parsing succeeds, None otherwise.
        """
        try:
            # Extract JSON object from response
            json_match = re.search(r"\{[^}]+\}", content)
            if json_match is None:
                logger.debug(f"No JSON found in response: {content[:100]}")
                return None

            data = json.loads(json_match.group())
            category_str = data.get("category", "")
            summary = data.get("summary", "")
            ai_note = data.get("ai_note", "")

            # Map Japanese category name to enum
            category = self._CATEGORY_MAP.get(category_str, Category.OTHER)

            logger.debug(f"Parsed classification: {category.value}, summary: {summary}")
            return category, summary, ai_note

        except json.JSONDecodeError as e:
            logger.debug(f"JSON parse error: {e}, content: {content[:100]}")
            return None
        except (KeyError, TypeError) as e:
            logger.debug(f"Response structure error: {e}")
            return None

    def _fallback_classify(self, text: str) -> Tuple[Category, str, str]:
        """
        Perform fallback classification using keywords and simple summarization.

        Args:
            text: Text to classify.

        Returns:
            Tuple of (category, summary).
        """
        category = self._keyword_classify(text) or Category.OTHER
        summary = self._extract_summary_simple(text)
        ai_note = text.strip()
        if len(ai_note) > 200:
            ai_note = ai_note[:200] + "..."
        logger.debug(f"Fallback classification: {category.value}")
        return category, summary, ai_note


# Singleton instance
classifier_service = ClassifierService()
