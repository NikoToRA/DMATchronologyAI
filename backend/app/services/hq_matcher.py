"""
HQ Matcher Service Module

Provides automatic headquarters (HQ) identification from Zoom display names
and speech text analysis for disaster response meetings.
"""

import logging
import re
from typing import List, Optional, Pattern

from ..models.schemas import HQMaster

logger = logging.getLogger(__name__)


class HQMatcherError(Exception):
    """Base exception for HQ matcher operations."""

    pass


class InvalidPatternError(HQMatcherError):
    """Exception raised when a regex pattern is invalid."""

    pass


class HQMatcherService:
    """
    Service for matching Zoom users to headquarters (HQ) entities.

    This service provides two matching mechanisms:
    1. Zoom display name matching against configured patterns
    2. Speech text analysis for HQ declaration detection

    The display name matching supports:
    - Exact match
    - Substring match
    - Regular expression match (patterns wrapped in /)

    Example:
        >>> matcher = HQMatcherService()
        >>> hq_id = matcher.match_hq("医療班本部 田中", hq_master_list)
        >>> print(f"Matched HQ: {hq_id}")
    """

    # Patterns for detecting HQ declaration at the start of speech
    _DECLARATION_PATTERNS: List[str] = [
        r"^(.+?本部)です",
        r"^(.+?班)です",
        r"^こちら(.+?本部)",
        r"^(.+?本部)から",
    ]

    def __init__(self) -> None:
        """Initialize the HQ matcher service."""
        # Pre-compile declaration patterns for efficiency
        self._compiled_declaration_patterns: List[Pattern[str]] = [
            re.compile(pattern) for pattern in self._DECLARATION_PATTERNS
        ]
        logger.debug(
            f"HQMatcherService initialized with {len(self._DECLARATION_PATTERNS)} "
            "declaration patterns"
        )

    def match_hq(
        self,
        zoom_display_name: str,
        hq_master_list: List[HQMaster],
    ) -> Optional[str]:
        """
        Match a Zoom display name to an HQ entity.

        Checks the display name against patterns defined in the HQ master list.
        Only active HQ entries are considered.

        Args:
            zoom_display_name: The Zoom user's display name.
            hq_master_list: List of HQ master entries to match against.

        Returns:
            The matching HQ ID if found, None otherwise.

        Note:
            Matching is performed in order of the master list.
            First match wins.
        """
        if not zoom_display_name:
            logger.debug("Empty display name provided")
            return None

        # Filter to active HQs only
        active_hqs = [hq for hq in hq_master_list if hq.active]
        logger.debug(
            f"Matching '{zoom_display_name}' against {len(active_hqs)} active HQs"
        )

        for hq in active_hqs:
            if self._is_match(zoom_display_name, hq.zoom_pattern):
                logger.info(
                    f"Display name '{zoom_display_name}' matched HQ: "
                    f"{hq.hq_id} ({hq.hq_name})"
                )
                return hq.hq_id

        logger.debug(f"No HQ match found for '{zoom_display_name}'")
        return None

    def _is_match(self, display_name: str, pattern: str) -> bool:
        """
        Check if display name matches the given pattern.

        Matching methods (in order):
        1. Exact match
        2. Substring match (pattern contained in display name)
        3. Regex match (if pattern is wrapped in /)

        Args:
            display_name: The display name to check.
            pattern: The pattern to match against.

        Returns:
            True if display name matches the pattern.
        """
        # Exact match
        if display_name == pattern:
            return True

        # Substring match
        if pattern in display_name:
            return True

        # Regex match (pattern wrapped in /)
        if pattern.startswith("/") and pattern.endswith("/") and len(pattern) > 2:
            return self._regex_match(display_name, pattern[1:-1])

        return False

    def _regex_match(self, display_name: str, regex_pattern: str) -> bool:
        """
        Check if display name matches a regex pattern.

        Args:
            display_name: The display name to check.
            regex_pattern: The regex pattern (without / delimiters).

        Returns:
            True if display name matches the regex.

        Note:
            Invalid regex patterns are logged and return False.
        """
        try:
            if re.search(regex_pattern, display_name):
                return True
        except re.error as e:
            logger.warning(f"Invalid regex pattern '{regex_pattern}': {e}")
        return False

    def get_hq_name(
        self,
        hq_id: Optional[str],
        hq_master_list: List[HQMaster],
    ) -> Optional[str]:
        """
        Get the HQ display name from an HQ ID.

        Args:
            hq_id: The HQ identifier to look up.
            hq_master_list: List of HQ master entries.

        Returns:
            The HQ name if found, None otherwise.
        """
        if not hq_id:
            return None

        for hq in hq_master_list:
            if hq.hq_id == hq_id:
                return hq.hq_name

        logger.debug(f"HQ ID '{hq_id}' not found in master list")
        return None

    def detect_declaration(
        self,
        text: str,
        hq_master_list: List[HQMaster],
    ) -> Optional[str]:
        """
        Detect HQ declaration at the start of speech text.

        Japanese meeting conventions often start with the speaker
        announcing their HQ affiliation, such as:
        - "医療班本部です。..." (This is Medical HQ...)
        - "こちら物資班本部。..." (This is Logistics HQ...)

        Args:
            text: The speech text to analyze.
            hq_master_list: List of HQ master entries to match against.

        Returns:
            The detected HQ ID if a declaration is found and matches
            an HQ in the master list, None otherwise.

        Example:
            >>> hq_id = matcher.detect_declaration(
            ...     "医療班本部です。救急車の配備が完了しました。",
            ...     hq_master_list
            ... )
        """
        if not text:
            return None

        for pattern in self._compiled_declaration_patterns:
            match = pattern.match(text)
            if match:
                declared_name = self._normalize_declared_name(match.group(1))
                logger.debug(f"Detected declaration: '{declared_name}'")

                # Search for matching HQ in master list
                hq_id = self._match_declaration_to_hq(declared_name, hq_master_list)
                if hq_id:
                    logger.info(f"Declaration matched to HQ: {hq_id}")
                    return hq_id

        return None

    def _normalize_declared_name(self, declared: str) -> str:
        """
        Normalize declared HQ name text (strip fillers / punctuation).

        Examples:
        - "ええと北海道調整本部" -> "北海道調整本部"
        - "（仮）北海道調整本部" -> "北海道調整本部"
        """
        s = (declared or "").strip()
        # Remove common Japanese fillers at the beginning
        s = re.sub(r"^(ええと|えっと|あの|その|えー|ええ)\s*", "", s)
        # Remove surrounding parentheses fragments
        s = re.sub(r"^[（(].*?[）)]\s*", "", s)
        s = re.sub(r"\s*[（(].*?[）)]\s*$", "", s)
        # Strip punctuation/whitespace
        s = s.strip(" \t　。、，,.・-—_")
        return s

    def extract_declaration_name(self, text: str) -> Optional[str]:
        """
        Extract declared HQ-ish name from the start of text.

        Returns the raw declared name string (e.g., "北海道調整本部") even if it
        doesn't exist in the HQ master yet.
        """
        if not text:
            return None
        for pattern in self._compiled_declaration_patterns:
            match = pattern.match(text)
            if match:
                declared_name = self._normalize_declared_name(match.group(1))
                return declared_name if declared_name else None
        return None

    def _match_declaration_to_hq(
        self,
        declared_name: str,
        hq_master_list: List[HQMaster],
    ) -> Optional[str]:
        """
        Match a declared HQ name to an entry in the master list.

        Uses flexible matching:
        - Exact match on hq_name
        - Declared name contains hq_name
        - HQ name contains declared name

        Args:
            declared_name: The declared HQ name from speech.
            hq_master_list: List of HQ master entries.

        Returns:
            Matching HQ ID if found, None otherwise.
        """
        for hq in hq_master_list:
            if not hq.active:
                continue

            # Exact match
            if hq.hq_name == declared_name:
                return hq.hq_id

            # Partial match (either direction)
            if declared_name in hq.hq_name or hq.hq_name in declared_name:
                return hq.hq_id

        return None


# Singleton instance
hq_matcher_service = HQMatcherService()
