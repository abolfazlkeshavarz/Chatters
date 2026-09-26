import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../api/client.dart';
import '../config.dart';

enum SocketStatus { offline, connecting, reconnecting, online }

/// Resilient WebSocket client, same design as the web app's
/// services/websocket.js: exponential backoff + jitter, immediate reconnect
/// when the app resumes or the network returns, heartbeat to detect a silently
/// dead socket, and a "reconnected" event so screens can refetch.
class ChatSocket {
  ChatSocket._();
  static final ChatSocket instance = ChatSocket._();

  static const _heartbeat = Duration(seconds: 20);
  static const _pongTimeout = Duration(seconds: 10);
  static const _maxBackoffMs = 30000;

  final _messages = StreamController<Map<String, dynamic>>.broadcast();
  final _reconnected = StreamController<void>.broadcast();
  final _status = StreamController<SocketStatus>.broadcast();

  Stream<Map<String, dynamic>> get messages => _messages.stream;
  Stream<void> get reconnected => _reconnected.stream;
  Stream<SocketStatus> get statusStream => _status.stream;
  SocketStatus status = SocketStatus.offline;

  WebSocketChannel? _ws;
  StreamSubscription? _wsSub;
  StreamSubscription? _netSub;
  Timer? _reconnectTimer, _heartbeatTimer, _pongTimer;
  int _attempts = 0;
  bool _started = false, _closing = false, _connecting = false, _open = false;
  bool _wasConnected = true;

  void start() {
    if (_started) return;
    _started = true;
    _closing = false;
    _netSub = Connectivity().onConnectivityChanged.listen((r) {
      final connected = r.any((x) => x != ConnectivityResult.none);
      if (connected && !_wasConnected) ensureAlive();
      _wasConnected = connected;
    });
    _connect();
  }

  void stop() {
    _started = false;
    _closing = true;
    _netSub?.cancel();
    _netSub = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _clearTimers();
    _closeWs();
    _setStatus(SocketStatus.offline);
  }

  /// Call when the app returns to the foreground.
  void ensureAlive() {
    if (!_started || _closing) return;
    if (_open) {
      _ping();
      return;
    }
    if (_connecting) return;
    _attempts = 0;
    _scheduleReconnect(0);
  }

  Future<void> _connect() async {
    if (_closing || _connecting || _open) return;
    _connecting = true;
    _setStatus(_attempts == 0 ? SocketStatus.connecting : SocketStatus.reconnecting);

    String ticket;
    try {
      final res = await Api.post('/api/ws-ticket');
      ticket = (res as Map)['ticket'] as String;
    } catch (e) {
      _connecting = false;
      if (e is ApiError && e.status == 401) {
        stop();
        return;
      }
      _scheduleReconnect();
      return;
    }
    if (_closing) {
      _connecting = false;
      return;
    }

    final uri = Uri.parse('$wsBase/api/ws?ticket=${Uri.encodeComponent(ticket)}');
    final ws = IOWebSocketChannel.connect(uri);
    _ws = ws;
    try {
      await ws.ready;
    } catch (_) {
      _connecting = false;
      if (_ws == ws) _ws = null;
      _scheduleReconnect();
      return;
    }
    if (_ws != ws) return;

    _connecting = false;
    _open = true;
    _attempts = 0;
    _setStatus(SocketStatus.online);
    _startHeartbeat();
    _reconnected.add(null);

    _wsSub = ws.stream.listen(
      (data) {
        Map<String, dynamic> msg;
        try {
          msg = jsonDecode(data as String) as Map<String, dynamic>;
        } catch (_) {
          return;
        }
        if (msg['type'] == 'pong') {
          _pongTimer?.cancel();
          _pongTimer = null;
          return;
        }
        _messages.add(msg);
      },
      onDone: () => _onClosed(ws),
      onError: (_) => _onClosed(ws),
      cancelOnError: true,
    );
  }

  void _onClosed(WebSocketChannel ws) {
    if (_ws != ws) return;
    _ws = null;
    _open = false;
    _connecting = false;
    _clearTimers();
    if (_closing) return;
    _setStatus(SocketStatus.reconnecting);
    _scheduleReconnect();
  }

  void _scheduleReconnect([int? delayMs]) {
    if (_closing || _reconnectTimer != null) return;
    var delay = delayMs;
    if (delay == null) {
      final base = min(1000 * pow(2, _attempts).toInt(), _maxBackoffMs);
      delay = base + Random().nextInt(1000);
      _attempts++;
    }
    _reconnectTimer = Timer(Duration(milliseconds: delay), () {
      _reconnectTimer = null;
      _connect();
    });
  }

  void _startHeartbeat() {
    _clearTimers();
    _heartbeatTimer = Timer.periodic(_heartbeat, (_) => _ping());
  }

  void _ping() {
    if (!_open || _pongTimer != null) return;
    if (!send({'type': 'ping'})) {
      _forceReconnect();
      return;
    }
    _pongTimer = Timer(_pongTimeout, () {
      _pongTimer = null;
      _forceReconnect();
    });
  }

  void _forceReconnect() {
    if (_closing) return;
    _clearTimers();
    _closeWs();
    _setStatus(SocketStatus.reconnecting);
    _attempts = 0;
    _scheduleReconnect(0);
  }

  void _closeWs() {
    final ws = _ws;
    _ws = null;
    _open = false;
    _connecting = false;
    _wsSub?.cancel();
    _wsSub = null;
    try {
      ws?.sink.close();
    } catch (_) {}
  }

  void _clearTimers() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _pongTimer?.cancel();
    _pongTimer = null;
  }

  bool send(Map<String, dynamic> payload) {
    final ws = _ws;
    if (ws == null || !_open) return false;
    try {
      ws.sink.add(jsonEncode(payload));
      return true;
    } catch (_) {
      return false;
    }
  }

  void _setStatus(SocketStatus s) {
    if (status == s) return;
    status = s;
    _status.add(s);
  }
}
