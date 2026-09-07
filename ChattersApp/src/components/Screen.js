import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../theme";

/**
 * Common page shell: themed background, safe-area insets, and (optionally) a
 * keyboard-avoiding wrapper for screens with a text input pinned to the bottom.
 */
export default function Screen({
  children,
  edges = ["top", "bottom"],
  keyboardAvoiding = false,
  style,
}) {
  const theme = useTheme();
  const body = (
    <View style={[styles.fill, { backgroundColor: theme.bg }, style]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.fill, { backgroundColor: theme.bg }]}
    >
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
