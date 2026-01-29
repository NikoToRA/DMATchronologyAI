"""
Speech-to-Text Service Module

Provides speech-to-text transcription functionality using Azure Speech Services.
Supports both single-shot and continuous recognition modes.
"""

import asyncio
import io
import json
import logging
import threading
import wave
from typing import Any, AsyncIterator, Callable, List, Optional, Tuple

from ..config import settings
from .audio_converter import audio_converter, AudioConversionError

logger = logging.getLogger(__name__)

# Conditional import for Azure Speech SDK
try:
    import azure.cognitiveservices.speech as speechsdk

    SPEECH_SDK_AVAILABLE = True
except ImportError:
    speechsdk = None  # type: ignore
    SPEECH_SDK_AVAILABLE = False
    logger.warning("Azure Speech SDK not available - STT features will be limited")


class STTError(Exception):
    """Base exception for STT operations."""

    pass


class STTConfigurationError(STTError):
    """Exception raised when STT is not properly configured."""

    pass


class STTTranscriptionError(STTError):
    """Exception raised when transcription fails."""

    pass


class STTService:
    """
    Azure Speech Services speech-to-text transcription service.

    This service provides speech recognition capabilities using Azure Cognitive
    Services Speech SDK. It supports both single-shot recognition for short
    audio clips and continuous recognition for streaming audio.

    Attributes:
        speech_key: Azure Speech Services subscription key.
        speech_region: Azure region for the Speech Services resource.

    Example:
        >>> stt = STTService()
        >>> if stt.is_configured():
        ...     text, confidence = await stt.transcribe_audio(audio_bytes)
    """

    # Default recognition language
    DEFAULT_LANGUAGE = "ja-JP"

    def __init__(self) -> None:
        """Initialize the STT service with Azure credentials from settings."""
        self.speech_key: str = settings.azure_speech_key
        self.speech_region: str = settings.azure_speech_region
        self._speech_config: Optional[Any] = None

        if self.is_configured():
            logger.info(
                f"STTService initialized with region: {self.speech_region}"
            )
        else:
            logger.warning("STTService initialized without valid credentials")

    def _get_speech_config(self) -> Optional[Any]:
        """
        Get or create the Speech SDK configuration (lazy initialization).

        Returns:
            SpeechConfig instance if SDK is available and configured, None otherwise.
        """
        if not SPEECH_SDK_AVAILABLE:
            logger.debug("Speech SDK not available")
            return None

        if not self.speech_key:
            logger.debug("Speech key not configured")
            return None

        if self._speech_config is None:
            try:
                self._speech_config = speechsdk.SpeechConfig(
                    subscription=self.speech_key,
                    region=self.speech_region,
                )
                # Set recognition language to Japanese
                self._speech_config.speech_recognition_language = self.DEFAULT_LANGUAGE
                # Enable detailed output for confidence scores
                self._speech_config.output_format = speechsdk.OutputFormat.Detailed

                # Disable silence-based segmentation to process entire audio
                # User controls start/end via recording button, not silence detection
                # Set very long timeouts (10 minutes = 600000ms) to effectively disable
                self._speech_config.set_property(
                    speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
                    "600000"
                )
                self._speech_config.set_property(
                    speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
                    "600000"
                )
                # Also extend initial silence timeout for delayed speech start
                self._speech_config.set_property(
                    speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
                    "600000"
                )
                # Use time-based segmentation instead of silence-based
                # This prevents early termination due to pauses in speech
                self._speech_config.set_property_by_name(
                    "Speech_SegmentationStrategy",
                    "Time"
                )
                # Set segment size to 10 minutes (maximum practical length)
                self._speech_config.set_property_by_name(
                    "Speech_SegmentationMaximumTimeMs",
                    "600000"
                )
                logger.debug(
                    f"Speech config initialized with language: {self.DEFAULT_LANGUAGE}, "
                    "silence timeouts disabled (user-controlled recording)"
                )
            except Exception as e:
                logger.error(f"Failed to create speech config: {e}")
                return None

        return self._speech_config

    def is_configured(self) -> bool:
        """
        Check if the STT service is properly configured.

        Returns:
            True if Azure Speech SDK is available and credentials are set.
        """
        return SPEECH_SDK_AVAILABLE and bool(self.speech_key)

    async def transcribe_audio(
        self,
        audio_data: bytes,
        audio_format: str = "wav",
    ) -> Tuple[str, float]:
        """
        Transcribe audio data to text.

        Args:
            audio_data: Audio bytes to transcribe.
            audio_format: Audio format (wav, webm, mp3, ogg, m4a, raw).

        Returns:
            Tuple containing:
                - Transcribed text (empty string if no speech detected)
                - Confidence score (0.0 to 1.0)

        Raises:
            STTConfigurationError: If STT is not properly configured.

        Note:
            If STT is not configured, returns mock transcription for development.
            Non-WAV formats are automatically converted before transcription.
        """
        if not self.is_configured():
            logger.debug("STT not configured, returning mock transcription")
            return self._mock_transcription()

        speech_config = self._get_speech_config()
        if speech_config is None:
            logger.warning("Failed to get speech config, returning mock transcription")
            return self._mock_transcription()

        # Convert to WAV if needed
        wav_data = audio_data
        if audio_format != "wav":
            try:
                logger.debug(f"Converting {audio_format} to WAV for STT")
                wav_data = audio_converter.convert_to_wav(audio_data, audio_format)
            except AudioConversionError as e:
                logger.error(f"Audio conversion failed: {e}")
                return "", 0.0

        # Run synchronous SDK call in executor to avoid blocking
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(
                None,
                lambda: self._sync_transcribe(wav_data, speech_config),
            )
            return result
        except Exception as e:
            logger.error(f"Transcription executor error: {e}")
            return "", 0.0

    def _sync_transcribe(
        self,
        audio_data: bytes,
        speech_config: Any,
    ) -> Tuple[str, float]:
        """
        Perform synchronous speech recognition using continuous recognition.

        Uses continuous recognition to capture all speech in the audio,
        including speech after silence periods.

        Args:
            audio_data: Audio bytes to transcribe.
            speech_config: Azure Speech SDK configuration.

        Returns:
            Tuple of (transcribed_text, confidence_score).
        """
        try:
            # Azure Speech PushAudioInputStream expects raw PCM frames (not WAV container bytes).
            # Parse WAV bytes and push only frames with explicit stream format.
            with wave.open(io.BytesIO(audio_data), "rb") as wf:
                channels = wf.getnchannels()
                sample_rate = wf.getframerate()
                sample_width = wf.getsampwidth()  # bytes (expect 2)
                frames = wf.readframes(wf.getnframes())

            bits_per_sample = sample_width * 8
            stream_format = speechsdk.audio.AudioStreamFormat(
                samples_per_second=sample_rate,
                bits_per_sample=bits_per_sample,
                channels=channels,
            )
            audio_stream = speechsdk.audio.PushAudioInputStream(stream_format=stream_format)

            audio_config = speechsdk.audio.AudioConfig(stream=audio_stream)
            recognizer = speechsdk.SpeechRecognizer(
                speech_config=speech_config,
                audio_config=audio_config,
            )
            # Bias recognition for domain terms (helps acronyms like DMAT).
            try:
                phrase_list = speechsdk.PhraseListGrammar.from_recognizer(recognizer)
                for p in [
                    "DMAT",
                    "調整本部",
                    "活動拠点本部",
                    "支援指揮所",
                    "徳洲会",
                    "札幌",
                    "搬送",
                    "物資",
                ]:
                    phrase_list.addPhrase(p)
            except Exception:
                pass

            # Use continuous recognition to capture all speech (including after silence)
            results: List[Tuple[str, float]] = []
            done_event = threading.Event()
            error_message: Optional[str] = None

            def on_recognized(evt: Any) -> None:
                """Collect recognized speech segments."""
                if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                    confidence = self._extract_confidence(evt.result)
                    results.append((evt.result.text, confidence))
                    logger.debug(
                        f"Recognized segment: {len(evt.result.text)} chars, "
                        f"confidence: {confidence:.2f}"
                    )

            def on_canceled(evt: Any) -> None:
                """Handle cancellation."""
                nonlocal error_message
                cancellation = speechsdk.CancellationDetails(evt.result)
                if cancellation.reason == speechsdk.CancellationReason.Error:
                    error_message = cancellation.error_details
                    logger.warning(f"Recognition canceled: {error_message}")
                done_event.set()

            def on_session_stopped(evt: Any) -> None:
                """Signal completion when session stops."""
                logger.info(f"Recognition session stopped, collected {len(results)} segments")
                done_event.set()

            def on_session_started(evt: Any) -> None:
                """Log when session starts."""
                logger.info("Recognition session started")

            def on_recognizing(evt: Any) -> None:
                """Log intermediate recognition results (for debugging)."""
                if evt.result.text:
                    logger.debug(f"Recognizing (intermediate): {evt.result.text[:50]}...")

            # Connect event handlers
            recognizer.recognized.connect(on_recognized)
            recognizer.canceled.connect(on_canceled)
            recognizer.session_stopped.connect(on_session_stopped)
            recognizer.session_started.connect(on_session_started)
            recognizer.recognizing.connect(on_recognizing)

            # Calculate audio duration for logging
            audio_duration_sec = len(frames) / (sample_rate * sample_width * channels)
            logger.info(
                f"Starting recognition: {audio_duration_sec:.1f}s audio, "
                f"{len(frames)} bytes, {sample_rate}Hz {bits_per_sample}bit {channels}ch"
            )

            # Start continuous recognition
            recognizer.start_continuous_recognition()

            # Push audio data and close stream to signal end
            audio_stream.write(frames)
            audio_stream.close()
            logger.debug("Audio stream closed, waiting for recognition to complete")

            # Wait for recognition to complete
            # Timeout set to 10 minutes to handle long recordings
            # (user controls recording duration via button, not silence detection)
            if not done_event.wait(timeout=600.0):
                logger.warning("Recognition timeout (10min) - stopping")
                recognizer.stop_continuous_recognition()

            # Stop recognition
            recognizer.stop_continuous_recognition()

            # Combine results
            if not results:
                if error_message:
                    logger.warning(f"No speech recognized, error: {error_message}")
                else:
                    logger.debug("No speech recognized in audio")
                return "", 0.0

            # Concatenate all recognized text
            combined_text = "".join(text for text, _ in results)
            # Average confidence across all segments
            avg_confidence = sum(conf for _, conf in results) / len(results)

            logger.debug(
                f"Transcription complete: {len(results)} segments, "
                f"{len(combined_text)} chars, avg confidence: {avg_confidence:.2f}"
            )
            return combined_text, avg_confidence

        except Exception as e:
            logger.error(f"STT transcription error: {e}", exc_info=True)
            return "", 0.0

    def _extract_confidence(self, result: Any) -> float:
        """
        Extract confidence score from recognition result.

        Args:
            result: Azure Speech recognition result.

        Returns:
            Confidence score between 0.0 and 1.0.
        """
        try:
            details = json.loads(result.json)
            if "NBest" in details and len(details["NBest"]) > 0:
                confidence = details["NBest"][0].get("Confidence", 0.0)
                return float(confidence)
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.debug(f"Could not extract confidence from result: {e}")

        # Default confidence for successful recognition
        return 0.9

    def _mock_transcription(self) -> Tuple[str, float]:
        """
        Return mock transcription for development/testing.

        Used when Azure Speech Services is not configured.

        Returns:
            Tuple of (mock_text, mock_confidence).
        """
        return "[STT not configured: test text]", 0.5

    async def transcribe_continuous(
        self,
        audio_stream: AsyncIterator[bytes],
        on_result_callback: Callable[[str, float], Any],
    ) -> None:
        """
        Perform continuous speech recognition on streaming audio.

        This method is designed for use with Zoom Bot or similar streaming
        audio sources. It processes audio chunks as they arrive and calls
        the callback function for each recognized speech segment.

        Args:
            audio_stream: Async iterator yielding audio chunks.
            on_result_callback: Async callback function called with
                (transcribed_text, confidence) for each recognized segment.

        Note:
            The callback will be invoked for each recognized speech segment.
            Call is made using asyncio.create_task to avoid blocking.

        Example:
            >>> async def handle_result(text: str, confidence: float):
            ...     print(f"Recognized: {text} ({confidence:.2f})")
            >>> await stt.transcribe_continuous(audio_gen, handle_result)
        """
        if not self.is_configured():
            logger.warning("Continuous transcription unavailable: STT not configured")
            return

        speech_config = self._get_speech_config()
        if speech_config is None:
            logger.warning("Continuous transcription unavailable: no speech config")
            return

        # Create push stream for continuous audio
        push_stream = speechsdk.audio.PushAudioInputStream()
        audio_config = speechsdk.audio.AudioConfig(stream=push_stream)

        recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
        )

        # Set up event handler for recognized speech
        def on_recognized(evt: Any) -> None:
            """Handle recognized speech event."""
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                confidence = self._extract_confidence(evt.result)
                logger.debug(
                    f"Continuous recognition: {len(evt.result.text)} chars"
                )
                # Schedule callback as async task
                asyncio.create_task(on_result_callback(evt.result.text, confidence))

        def on_canceled(evt: Any) -> None:
            """Handle recognition canceled event."""
            cancellation = speechsdk.CancellationDetails(evt.result)
            if cancellation.reason == speechsdk.CancellationReason.Error:
                logger.error(
                    f"Continuous recognition error: {cancellation.error_details}"
                )

        recognizer.recognized.connect(on_recognized)
        recognizer.canceled.connect(on_canceled)

        # Start continuous recognition
        logger.info("Starting continuous recognition")
        recognizer.start_continuous_recognition()

        try:
            async for chunk in audio_stream:
                push_stream.write(chunk)
        except Exception as e:
            logger.error(f"Error processing audio stream: {e}")
        finally:
            push_stream.close()
            recognizer.stop_continuous_recognition()
            logger.info("Stopped continuous recognition")


# Singleton instance
stt_service = STTService()
