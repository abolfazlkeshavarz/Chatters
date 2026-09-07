import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { avatarImageSource } from "../api/avatar";
import { useTheme } from "../theme";

/**
 * A user's profile photo, falling back to a coloured-initial circle when they
 * have none or the viewer is not allowed to see it (the API reports both
 * identically as a 404, which surfaces here as an image load error).
 */
export default function Avatar({ userId, size = 40, bust, style }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [userId, bust]);

  const base = {
    width: size,
    height: size,
    borderRadius: size / 2,
    overflow: "hidden",
  };

  const source = avatarImageSource(userId, bust);

  if (source && !failed) {
    return (
      <Image
        source={source}
        onError={() => setFailed(true)}
        style={[base, style]}
      />
    );
  }

  return (
    <View
      style={[
        base,
        styles.fallback,
        { backgroundColor: theme.primary },
        style,
      ]}
    >
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>
        {userId?.[0]?.toUpperCase() || "?"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontWeight: "700" },
});
