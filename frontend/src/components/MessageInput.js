import { useState } from "react";

export default function MessageInput({ ws, chatId }) {
  const [text, setText] = useState("");

  function sendMessage() {
    if (!text || !ws) return;

    ws.send(
      JSON.stringify({
        chat_id: chatId,
        content: text
      })
    );

    setText("");
  }

  return (
    <div style={{ marginTop: 10 }}>
      <input
        style={{ width: "80%" }}
        value={text}
        placeholder="Type message..."
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") sendMessage();
        }}
      />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
}
