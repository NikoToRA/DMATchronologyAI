"""
Silence Filter Module

Provides audio analysis to detect silence/no-speech segments.
Uses RMS (Root Mean Square) analysis to determine if audio contains speech.
"""

import io
import logging
from typing import Tuple

import numpy as np
from numpy.typing import NDArray

logger = logging.getLogger(__name__)

# Conditional import for pydub
try:
    from pydub import AudioSegment

    PYDUB_AVAILABLE = True
except ImportError:
    AudioSegment = None  # type: ignore
    PYDUB_AVAILABLE = False
    logger.warning("pydub not available - silence filtering will be limited")


class SilenceFilterError(Exception):
    """Base exception for silence filter operations."""

    pass


class AudioFormatError(SilenceFilterError):
    """Exception raised when audio format is not supported."""

    pass


class SilenceFilter:
    """
    Audio silence detection filter using RMS analysis.

    This filter determines if audio data contains speech by analyzing
    the RMS (Root Mean Square) level. Audio below a threshold is
    considered silence.

    Attributes:
        silence_threshold_db: RMS threshold in dB below which audio is silence.
        min_speech_duration_ms: Minimum duration for valid speech segments.
        sample_rate: Expected audio sample rate in Hz.

    Example:
        >>> filter = SilenceFilter(silence_threshold_db=-40.0)
        >>> is_silent, rms_db = filter.is_silence(audio_bytes)
        >>> if not is_silent:
        ...     process_speech(audio_bytes)
    """

    # Constants for RMS calculation
    _INT16_MAX: float = 32768.0
    _INT32_MAX: float = 2147483648.0
    _SILENCE_RMS_DB: float = -100.0

    def __init__(
        self,
        silence_threshold_db: float = -40.0,
        min_speech_duration_ms: int = 500,
        sample_rate: int = 16000,
    ) -> None:
        """
        Initialize the silence filter with configurable parameters.

        Args:
            silence_threshold_db: RMS threshold in decibels. Audio with RMS
                below this value is considered silence. Default -40.0 dB.
            min_speech_duration_ms: Minimum duration in milliseconds for
                audio to be considered speech. Default 500 ms.
            sample_rate: Expected audio sample rate in Hz. Default 16000.
        """
        self.silence_threshold_db: float = silence_threshold_db
        self.min_speech_duration_ms: int = min_speech_duration_ms
        self.sample_rate: int = sample_rate

        logger.debug(
            f"SilenceFilter initialized: threshold={silence_threshold_db}dB, "
            f"min_duration={min_speech_duration_ms}ms, sample_rate={sample_rate}Hz"
        )

    def _db_to_linear(self, db: float) -> float:
        """
        Convert decibel value to linear amplitude.

        Args:
            db: Value in decibels.

        Returns:
            Linear amplitude value.
        """
        return 10 ** (db / 20)

    def _calculate_rms(self, audio_data: NDArray[np.floating]) -> float:
        """
        Calculate RMS (Root Mean Square) of audio data.

        Args:
            audio_data: Normalized audio samples as numpy array.

        Returns:
            RMS value (0.0 for empty arrays).
        """
        if len(audio_data) == 0:
            return 0.0
        return float(np.sqrt(np.mean(audio_data.astype(np.float64) ** 2)))

    def _normalize_audio(self, audio_data: NDArray[np.integer]) -> NDArray[np.floating]:
        """
        Normalize audio data to range [-1.0, 1.0].

        Args:
            audio_data: Raw audio samples as numpy array.

        Returns:
            Normalized audio samples as float64 array.
        """
        if audio_data.dtype == np.int16:
            return audio_data.astype(np.float64) / self._INT16_MAX
        elif audio_data.dtype == np.int32:
            return audio_data.astype(np.float64) / self._INT32_MAX
        # Assume already normalized if not int16/int32
        return audio_data.astype(np.float64)

    def _rms_to_db(self, rms: float) -> float:
        """
        Convert RMS value to decibels.

        Args:
            rms: RMS amplitude value.

        Returns:
            RMS in decibels, or _SILENCE_RMS_DB for zero/near-zero RMS.
        """
        if rms > 0:
            return 20 * np.log10(rms)
        return self._SILENCE_RMS_DB

    def is_silence(
        self,
        audio_data: bytes,
        audio_format: str = "wav",
    ) -> Tuple[bool, float]:
        """
        Determine if audio data is silence.

        Args:
            audio_data: Audio bytes to analyze.
            audio_format: Audio format - "wav" or "raw". Default "wav".

        Returns:
            Tuple of (is_silence, rms_db):
                - is_silence: True if audio is silent or too short.
                - rms_db: RMS level in decibels.

        Note:
            Returns (False, 0.0) if pydub is unavailable to avoid
            blocking processing pipeline.
        """
        if not PYDUB_AVAILABLE:
            logger.warning("pydub not available, assuming non-silence")
            return False, 0.0

        try:
            # Load audio based on format
            audio = self._load_audio(audio_data, audio_format)
            if audio is None:
                return False, 0.0

            # Check minimum duration
            if len(audio) < self.min_speech_duration_ms:
                logger.debug(
                    f"Audio too short: {len(audio)}ms < {self.min_speech_duration_ms}ms"
                )
                return True, self._SILENCE_RMS_DB

            # Calculate RMS
            samples = np.array(audio.get_array_of_samples())
            normalized = self._normalize_audio(samples)
            rms = self._calculate_rms(normalized)
            rms_db = self._rms_to_db(rms)

            is_silent = rms_db < self.silence_threshold_db
            logger.debug(
                f"Silence check: RMS={rms_db:.1f}dB, threshold={self.silence_threshold_db}dB, "
                f"is_silent={is_silent}"
            )
            return is_silent, rms_db

        except Exception as e:
            # On error, assume not silent to avoid dropping valid audio
            logger.error(f"Silence filter error: {e}", exc_info=True)
            return False, 0.0

    def _load_audio(
        self,
        audio_data: bytes,
        audio_format: str,
    ) -> "AudioSegment | None":
        """
        Load audio data into AudioSegment.

        Args:
            audio_data: Raw audio bytes.
            audio_format: Format string ("wav" or "raw").

        Returns:
            AudioSegment if successful, None on error.
        """
        try:
            if audio_format == "wav":
                return AudioSegment.from_wav(io.BytesIO(audio_data))
            elif audio_format == "raw":
                return AudioSegment.from_raw(
                    io.BytesIO(audio_data),
                    sample_width=2,  # 16-bit
                    frame_rate=self.sample_rate,
                    channels=1,  # mono
                )
            else:
                logger.warning(f"Unsupported audio format: {audio_format}")
                return None
        except Exception as e:
            logger.error(f"Failed to load audio ({audio_format}): {e}")
            return None

    def is_silence_numpy(
        self,
        audio_array: NDArray[np.integer],
    ) -> Tuple[bool, float]:
        """
        Determine if numpy audio array is silence.

        This method is useful when audio is already loaded as numpy array,
        avoiding the overhead of format conversion.

        Args:
            audio_array: Audio samples as numpy array (int16 or int32).

        Returns:
            Tuple of (is_silence, rms_db):
                - is_silence: True if audio is silent or too short.
                - rms_db: RMS level in decibels.
        """
        if len(audio_array) == 0:
            logger.debug("Empty audio array")
            return True, self._SILENCE_RMS_DB

        # Calculate duration from sample count
        duration_ms = (len(audio_array) / self.sample_rate) * 1000

        if duration_ms < self.min_speech_duration_ms:
            logger.debug(
                f"Audio too short: {duration_ms:.0f}ms < {self.min_speech_duration_ms}ms"
            )
            return True, self._SILENCE_RMS_DB

        normalized = self._normalize_audio(audio_array)
        rms = self._calculate_rms(normalized)
        rms_db = self._rms_to_db(rms)

        is_silent = rms_db < self.silence_threshold_db
        logger.debug(
            f"Numpy silence check: RMS={rms_db:.1f}dB, is_silent={is_silent}"
        )
        return is_silent, rms_db


# Singleton instance
# Default threshold tuned for real-world browser/Zoom recordings where RMS can be very low.
# (Example observed: -55.7dB for audible speech). Lower threshold = less aggressive silence skipping.
silence_filter = SilenceFilter(silence_threshold_db=-60.0)
