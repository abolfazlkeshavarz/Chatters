import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Sharing from "expo-sharing";

import { downloadMediaToFile, mediaImageSource } from "../api/media";

/**
 * Fullscreen image preview. `message` is the media message; the image is
 * fetched with the auth header by <Image>. "Save / share" downloads it to a
 * local file and hands it to the OS share sheet.
 */
export default function ImageViewer({ message, onClose }) {
  const [busy, setBusy] = useState(false);
  const visible = Boolean(message);
  const filename = message?.filename || message?.content || "image";

  async function share() {
    if (!message) return;
    setBusy(true);
    try {
      const uri = await downloadMediaToFile(message.id, filename);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      // Swallow: the preview stays open, the user can retry or close.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.header}>
          <Pressable style={styles.circle} onPress={onClose}>
            <Text style={styles.circleText}>✕</Text>
          </Pressable>
          <Pressable style={styles.circle} onPress={share} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.circleText}>⬇</Text>
            )}
          </Pressable>
        </View>

        {message && (
          <Image
            source={mediaImageSource(message.id)}
            resizeMode="contain"
            style={styles.image}
          />
        )}

        <Text numberOfLines={2} style={styles.caption}>
          {filename}
        </Text>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  circleText: { color: "#fff", fontSize: 20 },
  image: { flex: 1, width: "100%" },
  caption: {
    color: "#fff",
    textAlign: "center",
    padding: 16,
    fontSize: 14,
  },
});
