import re
import time
from collections import deque
from typing import Deque

_WORD_RE = re.compile(r"[\w]+(?:['’][\w]+)*", re.UNICODE)


def tokenize(text: str) -> list[str]:
    return _WORD_RE.findall(text or "")


class WPMCalculator:
    """Session-local WPM calculator. Partial text replaces, never accumulates."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self.started_at = clock()
        self.total_final_words = 0
        self._word_times: Deque[float] = deque()
        self._partial_text = ""
        self._partial_updated_at = self.started_at

    def update_partial(self, text: str) -> dict:
        self._partial_text = text or ""
        self._partial_updated_at = self._clock()
        return self.metrics()

    def add_final(self, text: str, word_timings: list[dict] | None = None) -> dict:
        words = tokenize(text)
        now = self._clock()
        self.total_final_words += len(words)
        if word_timings and len(word_timings) == len(words):
            # Vosk word end times are relative to the start of the audio stream.
            for timing in word_timings:
                try:
                    event_time = self.started_at + float(timing["end"])
                except (KeyError, TypeError, ValueError):
                    event_time = now
                self._word_times.append(min(event_time, now))
        else:
            for _ in words:
                self._word_times.append(now)
        self._word_times = deque(sorted(self._word_times))
        self._partial_text = ""
        self._partial_updated_at = now
        self._prune(now)
        return self.metrics()

    def _prune(self, now: float) -> None:
        while self._word_times and now - self._word_times[0] > 60:
            self._word_times.popleft()

    def metrics(self) -> dict:
        now = self._clock()
        self._prune(now)
        elapsed = max(0.0, now - self.started_at)
        partial_count = len(tokenize(self._partial_text))
        # Provisional words are included in the live display, but are not
        # committed to the session total until Vosk finalizes the utterance.
        live_count = len(self._word_times) + partial_count
        displayed_total = self.total_final_words + partial_count
        average = displayed_total / (elapsed / 60) if elapsed > 0 else 0.0
        return {
            "live_wpm": live_count,
            "average_wpm": round(average),
            "total_words": displayed_total,
            "final_words": self.total_final_words,
            "duration_seconds": int(elapsed),
        }
