export async function getChats() {
  const token = localStorage.getItem("token");

  const res = await fetch("/api/chats", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to load chats");
  }

  return res.json();
}

export async function createChat(members, isGroup) {
  const token = localStorage.getItem("token");

  const res = await fetch("/api/chats", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      members,
      is_group: isGroup,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Failed to create chat");
  }

  return data;
}
