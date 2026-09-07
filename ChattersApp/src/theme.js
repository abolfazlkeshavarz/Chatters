/**
 * The web app's CSS custom properties, ported to a JS theme object. Same names,
 * same values, light + dark. Consume via `useTheme()`.
 */

import { useColorScheme } from "react-native";

const light = {
  bg: "#f4f5f9",
  card: "#ffffff",
  cardRaised: "#ffffff",
  border: "#e3e5ec",
  text: "#17181d",
  subtext: "#6b6f7d",
  primary: "#5457e5",
  primaryHover: "#4548d4",
  primaryContrast: "#ffffff",
  danger: "#ef4444",
  success: "#22b573",
  unreadBg: "#eeeefd",
  bubbleIn: "#eceef3",
  bubbleInText: "#17181d",
  overlay: "rgba(17, 18, 24, 0.5)",
  secure: "#16a367",
  secureBg: "#e6f7ee",
  bubbleSent: "#ffffff",
  bubbleSentText: "#17181d",
  bubbleSentBorder: "#d8dae2",
  warnBg: "#fff4d6",
  warnText: "#5c4400",
};

const dark = {
  ...light,
  bg: "#0b0c10",
  card: "#17181e",
  cardRaised: "#1d1f27",
  border: "#2a2c36",
  text: "#f2f2f7",
  subtext: "#9498a8",
  primary: "#7376f0",
  primaryHover: "#8689f5",
  unreadBg: "#1e2040",
  bubbleIn: "#24262f",
  bubbleInText: "#f2f2f7",
  overlay: "rgba(0, 0, 0, 0.7)",
  bubbleSent: "#e9e9ed",
  bubbleSentText: "#1c1c1e",
  bubbleSentBorder: "#e9e9ed",
  secureBg: "#10281c",
  warnBg: "#3a2f10",
  warnText: "#f0d99a",
};

export const RADIUS = 14;

export function useTheme() {
  const scheme = useColorScheme();
  return scheme === "dark" ? dark : light;
}

export function getTheme(scheme) {
  return scheme === "dark" ? dark : light;
}
