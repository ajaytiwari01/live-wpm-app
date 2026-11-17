import json
from vosk import KaldiRecognizer, Model


class VoskEngine:
    def __init__(self, model: Model, sample_rate: int = 16000):
        self.recognizer = KaldiRecognizer(model, sample_rate)
        self.recognizer.SetWords(True)

    def accept(self, pcm16: bytes) -> list[dict]:
        """Process one PCM16 chunk. Returns zero or more transcript events."""
        events = []
        if self.recognizer.AcceptWaveform(pcm16):
            result = json.loads(self.recognizer.Result())
            text = result.get("text", "").strip()
            if text:
                events.append({"type": "transcript_final", "text": text, "words": result.get("result", [])})
            events.append({"type": "partial", "text": ""})
        else:
            result = json.loads(self.recognizer.PartialResult())
            events.append({"type": "partial", "text": result.get("partial", "")})
        return events

    def finish(self) -> dict | None:
        result = json.loads(self.recognizer.FinalResult())
        text = result.get("text", "").strip()
        if text:
            return {"type": "transcript_final", "text": text, "words": result.get("result", [])}
        return None
