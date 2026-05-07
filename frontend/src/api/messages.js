export async function getMessages(chatId) {
  const token = localStorage.getItem("token");

  const res = await fetch(
    `/api/chats/${chatId}/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!res.ok) {
    throw new Error("Failed to load messages");
  }

  return res.json();
}
