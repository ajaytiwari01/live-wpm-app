import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from vosk import Model

from app.config import FRONTEND_ORIGIN, MODEL_PATH, SAMPLE_RATE, MAX_AUDIO_BYTES
from app.session_manager import SessionManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("live-wpm")
manager: SessionManager | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global manager
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Vosk model not found at {MODEL_PATH}."
        )
    logger.info("Loading local Vosk model from %s", MODEL_PATH)
    model = await asyncio.to_thread(Model, str(MODEL_PATH))
    manager = SessionManager(model)
    logger.info("Vosk model loaded")
    yield
    manager = None

app = FastAPI(title="Live WPM Monitor", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": manager is not None, "sample_rate": SAMPLE_RATE}

@app.websocket("/ws/live")
async def live_socket(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    allowed_origins = {FRONTEND_ORIGIN, "http://127.0.0.1:5000", "http://localhost:5000"}
    if origin and origin not in allowed_origins:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    if manager is None:
        await websocket.send_json({"type": "error", "message": "Speech model is not loaded."})
        await websocket.close(code=1011)
        return

    session = manager.create()
    await websocket.send_json({"type": "status", "status": "listening", "session_id": session.session_id})

    async def metrics_pulse():
        while True:
            await asyncio.sleep(1)
            await websocket.send_json({"type": "metrics", "metrics": session.calculator.metrics()})

    pulse_task = asyncio.create_task(metrics_pulse())
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            raw = message.get("bytes")
            if raw is not None:
                if not raw or len(raw) > MAX_AUDIO_BYTES or len(raw) % 2:
                    await websocket.send_json({"type": "error", "message": "Invalid PCM16 audio chunk."})
                    continue
                events = await asyncio.to_thread(session.engine.accept, raw)
                for event in events:
                    if event["type"] == "partial":
                        metrics = session.calculator.update_partial(event["text"])
                        await websocket.send_json({"type": "transcript_partial", "text": event["text"], "metrics": metrics})
                    elif event["type"] == "transcript_final":
                        metrics = session.calculator.add_final(event["text"], event.get("words"))
                        await websocket.send_json({"type": "transcript_final", "text": event["text"], "metrics": metrics})
            elif message.get("text"):
                # Explicit control messages keep the protocol extensible.
                if message["text"] == "STOP":
                    final_event = await asyncio.to_thread(session.engine.finish)
                    if final_event:
                        metrics = session.calculator.add_final(final_event["text"], final_event.get("words"))
                        await websocket.send_json({"type": "transcript_final", "text": final_event["text"], "metrics": metrics})
                    await websocket.send_json({"type": "status", "status": "stopped"})
                    break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Live session failed")
        try:
            await websocket.send_json({"type": "error", "message": "The local transcription session encountered an error."})
        except Exception:
            pass
    finally:
        pulse_task.cancel()
        try:
            await pulse_task
        except (asyncio.CancelledError, Exception):
            pass
        manager.remove(session.session_id)
        try:
            await websocket.close()
        except Exception:
            pass
