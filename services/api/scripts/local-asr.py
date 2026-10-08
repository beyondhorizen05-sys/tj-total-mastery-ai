"""Persistent local multilingual speech recognition worker for TJ.

Input/output: one JSON object per line. Audio is a local WAV path, deleted by the caller.
"""
import json
import os
import sys

from faster_whisper import WhisperModel

model_name = sys.argv[1] if len(sys.argv) > 1 else "base"
download_root = sys.argv[2] if len(sys.argv) > 2 else None

try:
    model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=3, download_root=download_root)
    print(json.dumps({"ready": True, "model": model_name}), flush=True)
except Exception as error:
    print(json.dumps({"error": f"Local speech model failed to load: {error}"}), flush=True)
    sys.exit(1)

for line in sys.stdin:
    try:
        request = json.loads(line)
        clip = request["path"]
        segments, info = model.transcribe(
            clip,
            task="transcribe",
            beam_size=1 if model_name == "tiny" else 2,
            best_of=1,
            language=None,
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters={"min_speech_duration_ms": 250, "min_silence_duration_ms": 300, "speech_pad_ms": 80},
            without_timestamps=True,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.no_speech_prob < 0.65 and segment.avg_logprob > -1.0).strip()
        probability = float(info.language_probability or 0)
        if probability < 0.45 or len(text) < 3:
            text = ""
        print(json.dumps({"id": request["id"], "text": text, "language_code": info.language, "confidence": probability}), flush=True)
    except Exception as error:
        print(json.dumps({"id": request.get("id"), "error": str(error)}), flush=True)
