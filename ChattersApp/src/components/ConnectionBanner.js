import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme";

/**
 * Surfaces socket state so a dropped connection is visible instead of the app
 * silently ceasing to receive messages.
 */
export default function ConnectionBanner({ status }) {
  const theme = useTheme();
  if (status === "online") return null;

  const label =
    status === "connecting"
      ? "Connecting…"
      : status === "reconnecting"
      ? "Reconnecting…"
      : "Offline — messages will sync when you reconnect";

  return (
    <View style={[styles.banner, { backgroundColor: theme.warnBg }]}>
      <Text style={[styles.text, { color: theme.warnText }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 6, paddingHorizontal: 12 },
  text: { fontSize: 12, textAlign: "center" },
});
