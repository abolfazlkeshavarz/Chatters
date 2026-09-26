/// Where the app talks to the backend.
///
/// The default comes from the build (`--dart-define=API_BASE=https://host`);
/// the user can point the app at another server from the sign-in screen or
/// Settings, which is stored on the device and wins over the default.
/// The WebSocket URL is derived from the same host: http -> ws, https -> wss.
library;

const String defaultApiBase =
    String.fromEnvironment('API_BASE', defaultValue: 'https://chat.abolfazl.fun');

String? _override;

/// Set once at startup from storage (see Storage.hydrate) and whenever the
/// user changes the server.
void setServerOverride(String? url) => _override = (url == null || url.isEmpty) ? null : normalizeServer(url);

bool get hasServerOverride => _override != null;

String get apiBase => _override ?? normalizeServer(defaultApiBase);

String get wsBase => apiBase.replaceFirstMapped(
      RegExp(r'^http(s?)://'),
      (m) => m.group(1)!.isNotEmpty ? 'wss://' : 'ws://',
    );

/// "chat.example.com/" -> "https://chat.example.com"
String normalizeServer(String raw) {
  var s = raw.trim().replaceAll(RegExp(r'/+$'), '');
  if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(s)) s = 'https://$s';
  return s;
}
