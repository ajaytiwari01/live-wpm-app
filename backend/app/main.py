
import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from vosk import Model

from app.config import (
    FRONTEND_ORIGIN,
    MODEL_PATH,
    SAMPLE_RATE,
    MAX_AUDIO_BYTES,
)
from app.session_manager import SessionManager


# --------------------------------------------------
# Logging configuration
# --------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
)

logger = logging.getLogger("live-wpm")


# --------------------------------------------------
# Global application state
# --------------------------------------------------

manager: SessionManager | None = None


# --------------------------------------------------
# Allowed frontend origins
# --------------------------------------------------

def normalize_origin(origin: str | None) -> str:
    if not origin:
        return ""

    return origin.strip().rstrip("/")


ALLOWED_ORIGINS = {
    normalize_origin(FRONTEND_ORIGIN),

    # Production frontend
    "https://live-wpm-app.onrender.com",

    # Local development
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
}

ALLOWED_ORIGINS.discard("")


# --------------------------------------------------
# Application lifespan
# Load Vosk model once when backend starts
# --------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global manager

    logger.info("Starting Live WPM Monitor backend")

    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Vosk model not found at: {MODEL_PATH}"
        )

    logger.info("Loading Vosk model from: %s", MODEL_PATH)

    try:
        model = await asyncio.to_thread(
            Model,
            str(MODEL_PATH),
        )

        manager = SessionManager(model)

        logger.info("Vosk model loaded successfully")

    except Exception:
        logger.exception("Failed to load Vosk model")
        raise

    yield

    logger.info("Shutting down Live WPM Monitor backend")

    manager = None


# --------------------------------------------------
# FastAPI application
# --------------------------------------------------

app = FastAPI(
    title="Live WPM Monitor",
    version="1.0.0",
    description="Real-time speech transcription and speaking speed monitoring",
    lifespan=lifespan,
)


# --------------------------------------------------
# CORS configuration
# Applies to HTTP requests
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Root endpoint
# --------------------------------------------------

@app.get("/")
async def root():
    return {
        "message": "Live WPM Monitor backend is running",
        "status": "online",
    }


# --------------------------------------------------
# Health check endpoint
# --------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": manager is not None,
        "sample_rate": SAMPLE_RATE,
    }


# --------------------------------------------------
# WebSocket endpoint
# --------------------------------------------------

@app.websocket("/ws/live")
async def live_socket(websocket: WebSocket):

    # ----------------------------------------------
    # 1. Validate frontend origin
    # ----------------------------------------------

    origin = normalize_origin(
        websocket.headers.get("origin")
    )

    logger.info(
        "Incoming WebSocket connection from origin: %s",
        origin or "No Origin header",
    )

    if origin and origin not in ALLOWED_ORIGINS:

        logger.warning(
            "WebSocket connection rejected. "
            "Origin not allowed: %s",
            origin,
        )

        # Rejection before accept results in HTTP 403.
        await websocket.close(code=1008)
        return

    # ----------------------------------------------
    # 2. Accept WebSocket connection
    # ----------------------------------------------

    await websocket.accept()

    logger.info(
        "WebSocket connection accepted from: %s",
        origin or "Unknown origin",
    )

    # ----------------------------------------------
    # 3. Verify Vosk model availability
    # ----------------------------------------------

    if manager is None:

        logger.error("Vosk model is not initialized")

        await websocket.send_json({
            "type": "error",
            "message": "Speech recognition model is not loaded.",
        })

        await websocket.close(code=1011)
        return

    # ----------------------------------------------
    # 4. Create independent session
    # ----------------------------------------------

    session = manager.create()

    logger.info(
        "Live session created: %s",
        session.session_id,
    )

    # Protect WebSocket writes from concurrent tasks.
    send_lock = asyncio.Lock()

    async def send_json_safe(data: dict) -> bool:
        try:
            async with send_lock:
                await websocket.send_json(data)

            return True

        except (WebSocketDisconnect, RuntimeError, OSError):
            return False

    await send_json_safe({
        "type": "status",
        "status": "listening",
        "session_id": session.session_id,
    })

    # ----------------------------------------------
    # 5. Periodically send live WPM metrics
    # ----------------------------------------------

    async def metrics_pulse():

        try:
            while True:

                await asyncio.sleep(1)

                metrics = session.calculator.metrics()

                sent = await send_json_safe({
                    "type": "metrics",
                    "metrics": metrics,
                })

                if not sent:
                    break

        except asyncio.CancelledError:
            raise

        except Exception:
            logger.exception(
                "Metrics update failed for session %s",
                session.session_id,
            )

    pulse_task = asyncio.create_task(metrics_pulse())

    # ----------------------------------------------
    # 6. Process incoming audio and control messages
    # ----------------------------------------------

    try:

        while True:

            message = await websocket.receive()

            # --------------------------------------
            # Client disconnected
            # --------------------------------------

            if message.get("type") == "websocket.disconnect":

                logger.info(
                    "Client disconnected: %s",
                    session.session_id,
                )

                break

            # --------------------------------------
            # Incoming binary audio
            # --------------------------------------

            raw = message.get("bytes")

            if raw is not None:

                # Validate incoming PCM16 audio
                if (
                    not raw
                    or len(raw) > MAX_AUDIO_BYTES
                    or len(raw) % 2 != 0
                ):

                    await send_json_safe({
                        "type": "error",
                        "message": "Invalid PCM16 audio chunk.",
                    })

                    continue

                # Run synchronous Vosk processing outside
                # the FastAPI event loop.
                events = await asyncio.to_thread(
                    session.engine.accept,
                    raw,
                )

                # ----------------------------------
                # Process recognition events
                # ----------------------------------

                for event in events:

                    event_type = event.get("type")

                    # Partial transcription
                    if event_type == "partial":

                        metrics = (
                            session.calculator.update_partial(
                                event["text"]
                            )
                        )

                        await send_json_safe({
                            "type": "transcript_partial",
                            "text": event["text"],
                            "metrics": metrics,
                        })

                    # Final transcription
                    elif event_type == "transcript_final":

                        metrics = session.calculator.add_final(
                            event["text"],
                            event.get("words"),
                        )

                        await send_json_safe({
                            "type": "transcript_final",
                            "text": event["text"],
                            "metrics": metrics,
                        })

            # --------------------------------------
            # Incoming text control messages
            # --------------------------------------

            text_message = message.get("text")

            if text_message == "STOP":

                logger.info(
                    "Stopping session: %s",
                    session.session_id,
                )

                # Finalize any remaining speech
                final_event = await asyncio.to_thread(
                    session.engine.finish
                )

                if final_event:

                    metrics = session.calculator.add_final(
                        final_event["text"],
                        final_event.get("words"),
                    )

                    await send_json_safe({
                        "type": "transcript_final",
                        "text": final_event["text"],
                        "metrics": metrics,
                    })

                await send_json_safe({
                    "type": "status",
                    "status": "stopped",
                })

                break

    # ----------------------------------------------
    # 7. Handle client disconnection
    # ----------------------------------------------

    except WebSocketDisconnect:

        logger.info(
            "WebSocket disconnected: %s",
            session.session_id,
        )

    # ----------------------------------------------
    # 8. Handle unexpected errors
    # ----------------------------------------------

    except Exception:

        logger.exception(
            "Live session failed: %s",
            session.session_id,
        )

        await send_json_safe({
            "type": "error",
            "message": "Live transcription encountered an internal error.",
        })

    # ----------------------------------------------
    # 9. Clean up session resources
    # ----------------------------------------------

    finally:

        pulse_task.cancel()

        with suppress(asyncio.CancelledError):
            await pulse_task

        manager.remove(session.session_id)

        with suppress(Exception):
            await websocket.close()

        logger.info(
            "Session cleaned up: %s",
            session.session_id,
        )
