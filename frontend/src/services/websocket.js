export function connectWebSocket(onMessage) {
  const token = localStorage.getItem("token");

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(
    `${protocol}://${window.location.host}/api/ws?token=${token}`
    // `ws://localhost:8080/api/ws?token=${token}`
  );
  
  ws.onopen = () => {
    console.log("WebSocket connected");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      // ✅ Only handle chat messages
      if (!["message", "media", "seen"].includes(msg.type)) return;
      onMessage(msg);

    } catch {
      console.warn("Invalid WS message", event.data);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
  };

  return ws;
}
