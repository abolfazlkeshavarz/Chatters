/// Where the app talks to the backend.
///
/// A native app has no origin, so every request needs an absolute base URL.
/// Override at build time with `--dart-define=API_BASE=https://your.host`.
/// The WebSocket URL is derived from the same host: http -> ws, https -> wss.
library;

const String _rawApiBase =
    String.fromEnvironment('API_BASE', defaultValue: 'https://chat.abolfazl.fun');

final String apiBase = _rawApiBase.trim().replaceAll(RegExp(r'/+$'), '');

final String wsBase = apiBase.replaceFirstMapped(
  RegExp(r'^http(s?)://'),
  (m) => m.group(1)!.isNotEmpty ? 'wss://' : 'ws://',
);
