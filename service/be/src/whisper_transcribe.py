#!/usr/bin/env python3
"""Transcribe audio file using faster-whisper (offline, local)."""
import sys
from faster_whisper import WhisperModel

# Use tiny model - fast, ~75MB download on first run
model = WhisperModel("tiny", device="cpu", compute_type="int8")

audio_path = sys.argv[1]
segments, _ = model.transcribe(audio_path, beam_size=1)
text = " ".join(seg.text.strip() for seg in segments)
print(text)
