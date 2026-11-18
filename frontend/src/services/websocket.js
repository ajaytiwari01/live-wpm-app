
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.DEV
    ? 'ws://127.0.0.1:8000/ws/live'
    : '');

console.log('[Live WPM] WebSocket URL:', WS_URL);

export function createLiveSocket(onMessage, onError) {
  if (!WS_URL) {
    const message = 'WebSocket URL is not configured. Check VITE_WS_URL.';
    onError?.(message);
    throw new Error(message);
  }

  const socket = new WebSocket(WS_URL);
  socket.binaryType = 'arraybuffer';

  socket.onopen = () => {
    console.log('[Live WPM] WebSocket connected:', WS_URL);
  };

  socket.onmessage = (event) => {
    try {
      onMessage?.(JSON.parse(event.data));
    } catch (error) {
      console.error('[Live WPM] Message parsing error:', error);
      onError?.('Invalid message received from backend.');
    }
  };

  socket.onerror = (event) => {
    console.error('[Live WPM] WebSocket connection failed:', WS_URL, event);
    onError?.('WebSocket connection failed. Check the backend and connection URL.');
  };

  socket.onclose = (event) => {
    console.log('[Live WPM] WebSocket closed:', event.code, event.reason);
  };

  return socket;
}