import { useEffect, useState } from "react";
import { fetchAvatarURL } from "../api/avatar";

/**
 * A user's profile photo, falling back to the same coloured-initial circle
 * every screen already used before avatars existed — so a user with no photo
 * (or one the viewer's not allowed to see, which the API deliberately
 * reports identically) looks exactly like it always did instead of showing a
 * broken-image icon.
 */
export default function Avatar({ userId, size = 40, fontSize, style }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    if (userId) {
      fetchAvatarURL(userId).then((u) => {
        if (cancelled) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId]);

  const base = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    fontWeight: 600,
    fontSize: fontSize || Math.round(size * 0.42),
    overflow: "hidden",
    ...style,
  };

  if (url) {
    return (
      <div style={base}>
        <img
          src={url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  return (
    <div style={{ ...base, background: "var(--primary)", color: "#fff" }}>
      {userId?.[0]?.toUpperCase() || "?"}
    </div>
  );
}
