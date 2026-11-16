"""Transcribe a received voice note locally; stdout contains only the transcript."""
import os
import sys
from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get('EXECUTOR_WHISPER_MODEL', 'small'), device='cpu', compute_type='int8', cpu_threads=2)
segments, info = model.transcribe(sys.argv[1], beam_size=5, vad_filter=True)
print(' '.join(segment.text.strip() for segment in segments))
