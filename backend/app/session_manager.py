import uuid
from dataclasses import dataclass
from vosk import Model
from app.transcription import VoskEngine
from app.wpm_calculator import WPMCalculator

@dataclass
class LiveSession:
    session_id: str
    engine: VoskEngine
    calculator: WPMCalculator

class SessionManager:
    def __init__(self, model: Model):
        self.model = model
        self.sessions: dict[str, LiveSession] = {}

    def create(self) -> LiveSession:
        session = LiveSession(str(uuid.uuid4()), VoskEngine(self.model), WPMCalculator())
        self.sessions[session.session_id] = session
        return session

    def remove(self, session_id: str) -> None:
        self.sessions.pop(session_id, None)
