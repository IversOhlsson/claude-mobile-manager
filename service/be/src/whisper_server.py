#!/usr/bin/env python3
"""Persistent Whisper server - model stays loaded in memory for fast transcription."""
import sys
import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from faster_whisper import WhisperModel

print("[whisper] Loading model...", flush=True)
model = WhisperModel("tiny", device="cpu", compute_type="int8")
print("[whisper] Model ready, listening on port 9876", flush=True)

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        audio = self.rfile.read(length)

        tmp = f"/tmp/voice-{os.getpid()}.webm"
        with open(tmp, "wb") as f:
            f.write(audio)

        try:
            segments, _ = model.transcribe(tmp, beam_size=1, vad_filter=True)
            text = " ".join(seg.text.strip() for seg in segments)
        except Exception as e:
            text = ""
            print(f"[whisper] Error: {e}", flush=True)
        finally:
            try: os.unlink(tmp)
            except: pass

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"text": text}).encode())

    def log_message(self, fmt, *args):
        pass  # quiet

HTTPServer(("127.0.0.1", 9876), Handler).serve_forever()
