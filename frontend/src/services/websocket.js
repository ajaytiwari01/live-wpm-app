export function createLiveSocket(onMessage, onError) {
  const socket = new WebSocket('ws://127.0.0.1:8000/ws/live')
  socket.binaryType = 'arraybuffer'
  socket.onmessage = (event) => {
    try { onMessage(JSON.parse(event.data)) }
    catch { onError?.('Received an invalid message from the local server.') }
  }
  socket.onerror = () => onError?.('Could not connect to the local backend. Is FastAPI running?')
  return socket
}
