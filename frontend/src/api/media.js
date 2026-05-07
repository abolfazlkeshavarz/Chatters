export async function uploadMedia(chatId, file) {
  const token = localStorage.getItem("token");

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("file", file);

  const res = await fetch("/api/media", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  if (!res.ok) {
    throw new Error("Upload failed");
  }

  return res.json();
}
