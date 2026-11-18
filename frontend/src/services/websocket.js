
const WS_URL = import.meta.env.VITE_WS_URL ||
  (import.meta.env.DEV
    ? 'ws://127.0.0.1:8000/ws/live'
    : '');

export function createLiveSocket(onMessage, onError) {
  if (!WS_URL) {
    const message = 'WebSocket URL is not configured. Please set VITE_WS_URL.';
    onError?.(message);
    throw new Error(message);
  }

  const socket = new WebSocket(WS_URL);

  // Receive binary audio data as ArrayBuffer
  socket.binaryType = 'arraybuffer';

  // Connection established
  socket.onopen = () => {
    console.log('WebSocket connected:', WS_URL);
  };

  // Receive messages from FastAPI
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      onMessage?.(message);
    } catch (error) {
      console.error('WebSocket message parsing error:', error);
      onError?.('Received an invalid message from the backend.');
    }
  };

  // Connection error
  socket.onerror = (event) => {
    console.error('WebSocket connection error:', event);
    onError?.('Could not connect to the backend. Check the server and WebSocket URL.');
  };

  // Connection closed
  socket.onclose = (event) => {
    console.log(
      'WebSocket disconnected:',
      event.code,
      event.reason
    );
  };

  return socket;
}
