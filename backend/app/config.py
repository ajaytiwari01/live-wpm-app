import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = Path(os.getenv("VOSK_MODEL_PATH", str(BASE_DIR / "models" / "vosk-model-small-en-us-0.15")))
SAMPLE_RATE = 16_000
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5173")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
MAX_AUDIO_BYTES = 16_000 * 2 * 2  # two seconds of mono PCM16
