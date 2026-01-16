"""
Audio Converter Module

Provides audio format conversion functionality for various input formats
to the standard format expected by Azure Speech Services.
"""

import io
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Conditional import for pydub
try:
    from pydub import AudioSegment

    PYDUB_AVAILABLE = True
except ImportError:
    AudioSegment = None  # type: ignore
    PYDUB_AVAILABLE = False
    logger.warning("pydub not available - audio conversion will be limited")


class AudioConversionError(Exception):
    """Exception raised when audio conversion fails."""

    pass


class AudioConverter:
    """
    Audio format converter for speech processing.

    Converts various audio formats (WebM, MP3, OGG, etc.) to WAV format
    suitable for Azure Speech Services. The output is always mono 16kHz
    16-bit PCM WAV.

    Supported input formats:
        - webm (from browser MediaRecorder)
        - mp3
        - ogg
        - m4a
        - wav
        - raw PCM

    Example:
        >>> converter = AudioConverter()
        >>> wav_data = converter.convert_to_wav(webm_bytes, "webm")
    """

    # Target format for Azure Speech Services
    TARGET_SAMPLE_RATE = 16000
    TARGET_CHANNELS = 1
    TARGET_SAMPLE_WIDTH = 2  # 16-bit

    def __init__(self) -> None:
        """Initialize the audio converter."""
        if PYDUB_AVAILABLE:
            logger.info("AudioConverter initialized with pydub support")
        else:
            logger.warning("AudioConverter initialized without pydub - limited functionality")

    def is_available(self) -> bool:
        """Check if audio conversion is available."""
        return PYDUB_AVAILABLE

    def convert_to_wav(
        self,
        audio_data: bytes,
        input_format: str = "webm",
    ) -> bytes:
        """
        Convert audio data to WAV format suitable for Azure Speech Services.

        Args:
            audio_data: Raw audio bytes in the input format.
            input_format: Format of input audio (webm, mp3, ogg, m4a, wav).

        Returns:
            WAV audio bytes (mono, 16kHz, 16-bit PCM).

        Raises:
            AudioConversionError: If conversion fails or format not supported.
        """
        if not PYDUB_AVAILABLE:
            logger.warning("pydub not available, returning original data")
            return audio_data

        if not audio_data:
            raise AudioConversionError("Empty audio data provided")

        try:
            # Load audio based on format
            audio = self._load_audio(audio_data, input_format)

            # Convert to target format
            audio = audio.set_frame_rate(self.TARGET_SAMPLE_RATE)
            audio = audio.set_channels(self.TARGET_CHANNELS)
            audio = audio.set_sample_width(self.TARGET_SAMPLE_WIDTH)

            # Export as WAV
            output_buffer = io.BytesIO()
            audio.export(output_buffer, format="wav")
            wav_data = output_buffer.getvalue()

            logger.debug(
                f"Converted {input_format} ({len(audio_data)} bytes) to WAV ({len(wav_data)} bytes)"
            )
            return wav_data

        except AudioConversionError:
            raise
        except Exception as e:
            logger.error(f"Audio conversion failed: {e}", exc_info=True)
            raise AudioConversionError(f"Failed to convert {input_format} to WAV: {e}")

    def _load_audio(self, audio_data: bytes, input_format: str) -> "AudioSegment":
        """
        Load audio data into AudioSegment based on format.

        Args:
            audio_data: Raw audio bytes.
            input_format: Format string.

        Returns:
            AudioSegment instance.

        Raises:
            AudioConversionError: If format is not supported or loading fails.
        """
        buffer = io.BytesIO(audio_data)

        try:
            if input_format in ("webm", "ogg"):
                # WebM with Opus codec and OGG share similar handling
                return AudioSegment.from_file(buffer, format=input_format)
            elif input_format == "mp3":
                return AudioSegment.from_mp3(buffer)
            elif input_format == "m4a":
                return AudioSegment.from_file(buffer, format="m4a")
            elif input_format == "wav":
                return AudioSegment.from_wav(buffer)
            elif input_format == "raw":
                return AudioSegment.from_raw(
                    buffer,
                    sample_width=self.TARGET_SAMPLE_WIDTH,
                    frame_rate=self.TARGET_SAMPLE_RATE,
                    channels=self.TARGET_CHANNELS,
                )
            else:
                # Try generic loading for unknown formats
                logger.warning(f"Unknown format '{input_format}', attempting generic load")
                return AudioSegment.from_file(buffer)
        except Exception as e:
            raise AudioConversionError(f"Failed to load {input_format} audio: {e}")

    def get_audio_info(self, audio_data: bytes, input_format: str = "wav") -> dict:
        """
        Get information about audio data.

        Args:
            audio_data: Raw audio bytes.
            input_format: Format of the audio.

        Returns:
            Dictionary with audio information:
                - duration_ms: Duration in milliseconds
                - channels: Number of channels
                - sample_rate: Sample rate in Hz
                - sample_width: Sample width in bytes
        """
        if not PYDUB_AVAILABLE:
            return {
                "duration_ms": 0,
                "channels": 0,
                "sample_rate": 0,
                "sample_width": 0,
            }

        try:
            audio = self._load_audio(audio_data, input_format)
            return {
                "duration_ms": len(audio),
                "channels": audio.channels,
                "sample_rate": audio.frame_rate,
                "sample_width": audio.sample_width,
            }
        except Exception as e:
            logger.error(f"Failed to get audio info: {e}")
            return {
                "duration_ms": 0,
                "channels": 0,
                "sample_rate": 0,
                "sample_width": 0,
            }

    def detect_format(self, audio_data: bytes) -> Optional[str]:
        """
        Attempt to detect audio format from data.

        Args:
            audio_data: Raw audio bytes.

        Returns:
            Detected format string or None if unknown.
        """
        if len(audio_data) < 12:
            return None

        # Check for common audio signatures
        if audio_data[:4] == b"RIFF" and audio_data[8:12] == b"WAVE":
            return "wav"
        elif audio_data[:4] == b"OggS":
            return "ogg"
        elif audio_data[:3] == b"ID3" or audio_data[:2] == b"\xff\xfb":
            return "mp3"
        elif audio_data[4:8] == b"ftyp":
            return "m4a"
        elif audio_data[:4] == b"\x1a\x45\xdf\xa3":
            return "webm"

        return None


# Singleton instance
audio_converter = AudioConverter()
