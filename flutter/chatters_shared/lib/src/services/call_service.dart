import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../api/endpoints.dart';
import '../storage.dart';
import 'chat_socket.dart';

enum CallPhase {
  idle,
  /// We are calling; waiting for the other phone to ring / answer.
  outgoing,
  /// Their phone is ringing.
  ringing,
  /// Someone is calling us.
  incoming,
  /// Answered; WebRTC is connecting.
  connecting,
  active,
  ended,
}

/// Why a call ended, for the last line on the call screen.
enum CallEndReason { hangup, remoteHangup, declined, busy, unavailable, noAnswer, failed, answeredElsewhere, cancelled }

/// One 1:1 voice call at a time, over WebRTC. The server only relays the
/// signaling (see the backend's websocket/calls.go); audio flows phone to
/// phone, relayed by TURN when there is no direct path, and is always
/// encrypted by WebRTC (DTLS-SRTP).
class CallService extends ChangeNotifier {
  CallService._() {
    ChatSocket.instance.messages.listen(_onSocket);
  }
  static final CallService instance = CallService._();

  /// Tells this phone's echoes apart from the user's other devices.
  final String deviceId = _randomId();

  /// Set by the app to show the call screen when a call comes in.
  void Function()? onIncomingCall;

  CallPhase phase = CallPhase.idle;
  CallEndReason? endReason;
  String? callId;
  String? chatId;
  String? peer;
  bool outgoing = false;
  bool muted = false;
  bool speaker = false;
  DateTime? connectedAt;

  RTCPeerConnection? _pc;
  MediaStream? _local;
  String? _peerDevice;
  Map<String, dynamic>? _pendingOffer;
  final List<RTCIceCandidate> _pendingIce = [];
  bool _remoteSet = false;
  Timer? _timeout, _ringTimer, _endTimer;

  bool get busy => phase != CallPhase.idle && phase != CallPhase.ended;

  static String _randomId() {
    final r = Random.secure();
    return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }

  /* --------------------------------------------------------- outgoing */

  Future<void> start({required String chatId, required String peer}) async {
    if (busy) return;
    _reset();
    this.chatId = chatId;
    this.peer = peer;
    callId = _randomId();
    outgoing = true;
    _set(CallPhase.outgoing);

    try {
      await _createPeer();
      final offer = await _pc!.createOffer({'offerToReceiveAudio': true});
      await _pc!.setLocalDescription(offer);
      _send('call_offer', {'sdp': offer.sdp, 'sdp_type': offer.type});
      // Nobody picked up.
      _timeout = Timer(const Duration(seconds: 45), () {
        if (phase == CallPhase.outgoing || phase == CallPhase.ringing) {
          _send('call_end', {});
          _finish(CallEndReason.noAnswer);
        }
      });
    } catch (e) {
      debugPrint('call start failed: $e');
      _send('call_end', {});
      _finish(CallEndReason.failed);
    }
  }

  /* --------------------------------------------------------- incoming */

  Future<void> accept() async {
    if (phase != CallPhase.incoming || _pendingOffer == null) return;
    _stopRinging();
    _set(CallPhase.connecting);
    try {
      await _createPeer();
      final offer = _pendingOffer!;
      await _pc!.setRemoteDescription(RTCSessionDescription(offer['sdp'] as String?, offer['sdp_type'] as String? ?? 'offer'));
      _remoteSet = true;
      await _flushIce();
      final answer = await _pc!.createAnswer({'offerToReceiveAudio': true});
      await _pc!.setLocalDescription(answer);
      _send('call_answer', {'sdp': answer.sdp, 'sdp_type': answer.type});
      _armConnectTimeout();
    } catch (e) {
      debugPrint('call accept failed: $e');
      _send('call_end', {});
      _finish(CallEndReason.failed);
    }
  }

  void decline() {
    if (phase != CallPhase.incoming) return;
    _send('call_reject', {});
    _finish(CallEndReason.declined);
  }

  /// Hang up, or cancel a call that has not been answered yet.
  void hangUp() {
    if (!busy) return;
    if (phase == CallPhase.incoming) return decline();
    _send('call_end', {});
    _finish(outgoing && connectedAt == null ? CallEndReason.cancelled : CallEndReason.hangup);
  }

  /* ---------------------------------------------------------- controls */

  void toggleMute() {
    muted = !muted;
    for (final t in _local?.getAudioTracks() ?? const <MediaStreamTrack>[]) {
      t.enabled = !muted;
    }
    HapticFeedback.selectionClick();
    notifyListeners();
  }

  Future<void> toggleSpeaker() async {
    speaker = !speaker;
    try {
      await Helper.setSpeakerphoneOn(speaker);
    } catch (_) {}
    HapticFeedback.selectionClick();
    notifyListeners();
  }

  /* ------------------------------------------------------------ WebRTC */

  Future<void> _createPeer() async {
    final servers = await getIceServers();
    _pc = await createPeerConnection({
      'iceServers': servers,
      'sdpSemantics': 'unified-plan',
    });
    _local = await navigator.mediaDevices.getUserMedia({
      'audio': {'echoCancellation': true, 'noiseSuppression': true, 'autoGainControl': true},
      'video': false,
    });
    for (final track in _local!.getAudioTracks()) {
      await _pc!.addTrack(track, _local!);
    }
    try {
      await Helper.setSpeakerphoneOn(false);
    } catch (_) {}

    _pc!.onIceCandidate = (c) {
      if (c.candidate == null) return;
      _send('call_ice', {
        'candidate': {'candidate': c.candidate, 'sdpMid': c.sdpMid, 'sdpMLineIndex': c.sdpMLineIndex},
      });
    };
    _pc!.onConnectionState = (s) {
      switch (s) {
        case RTCPeerConnectionState.RTCPeerConnectionStateConnected:
          if (phase != CallPhase.active) {
            _timeout?.cancel();
            connectedAt = DateTime.now();
            HapticFeedback.mediumImpact();
            _set(CallPhase.active);
          }
        case RTCPeerConnectionState.RTCPeerConnectionStateFailed:
          _send('call_end', {});
          _finish(CallEndReason.failed);
        default:
          break;
      }
    };
  }

  void _armConnectTimeout() {
    _timeout?.cancel();
    _timeout = Timer(const Duration(seconds: 30), () {
      if (phase == CallPhase.connecting) {
        _send('call_end', {});
        _finish(CallEndReason.failed);
      }
    });
  }

  Future<void> _flushIce() async {
    for (final c in _pendingIce) {
      try {
        await _pc?.addCandidate(c);
      } catch (_) {}
    }
    _pendingIce.clear();
  }

  /* --------------------------------------------------------- signaling */

  void _send(String type, Map<String, dynamic> extra) {
    if (chatId == null || callId == null) return;
    ChatSocket.instance.send({
      'type': type,
      'chat_id': chatId,
      'call_id': callId,
      'device_id': deviceId,
      ...extra,
    });
  }

  Future<void> _onSocket(Map<String, dynamic> msg) async {
    final type = msg['type'] as String? ?? '';
    if (!type.startsWith('call_')) return;
    final from = msg['from'] as String?;
    final device = msg['device_id'] as String?;
    final id = msg['call_id'] as String?;
    if (device == deviceId) return; // our own echo

    final mine = from == Storage.username;

    // A new call.
    if (type == 'call_offer' && !mine) {
      if (busy) {
        // Already on a call: tell the caller without disturbing this one.
        ChatSocket.instance.send({
          'type': 'call_busy',
          'chat_id': msg['chat_id'],
          'call_id': id,
          'device_id': deviceId,
        });
        return;
      }
      _reset();
      callId = id;
      chatId = msg['chat_id'] as String?;
      peer = from;
      outgoing = false;
      _peerDevice = device;
      _pendingOffer = msg;
      _set(CallPhase.incoming);
      _send('call_ringing', {});
      _startRinging();
      onIncomingCall?.call();
      return;
    }

    if (id == null || id != callId) return;

    // The same user answered or declined on another of their phones.
    if (mine) {
      if (phase == CallPhase.incoming && (type == 'call_answer' || type == 'call_reject')) {
        _finish(CallEndReason.answeredElsewhere);
      }
      return;
    }

    switch (type) {
      case 'call_ringing':
        if (phase == CallPhase.outgoing) _set(CallPhase.ringing);
      case 'call_answer':
        if (!outgoing || _remoteSet) return;
        _peerDevice = device;
        _timeout?.cancel();
        _set(CallPhase.connecting);
        await _pc?.setRemoteDescription(
            RTCSessionDescription(msg['sdp'] as String?, msg['sdp_type'] as String? ?? 'answer'));
        _remoteSet = true;
        await _flushIce();
        _armConnectTimeout();
      case 'call_ice':
        if (_peerDevice != null && device != _peerDevice) return;
        final c = msg['candidate'];
        if (c is! Map) return;
        final cand = RTCIceCandidate(c['candidate'] as String?, c['sdpMid'] as String?, c['sdpMLineIndex'] as int?);
        if (_remoteSet) {
          try {
            await _pc?.addCandidate(cand);
          } catch (_) {}
        } else {
          _pendingIce.add(cand);
        }
      case 'call_reject':
        if (outgoing) _finish(CallEndReason.declined);
      case 'call_busy':
        if (outgoing) _finish(CallEndReason.busy);
      case 'call_unavailable':
        if (outgoing) _finish(CallEndReason.unavailable);
      case 'call_end':
        _finish(phase == CallPhase.incoming ? CallEndReason.cancelled : CallEndReason.remoteHangup);
    }
  }

  /* ------------------------------------------------------------ ringing */

  void _startRinging() {
    _ringTimer?.cancel();
    HapticFeedback.heavyImpact();
    _ringTimer = Timer.periodic(const Duration(milliseconds: 1200), (_) {
      HapticFeedback.heavyImpact();
      SystemSound.play(SystemSoundType.alert);
    });
    // The caller gives up after 45s; stop ringing a little after that.
    _timeout = Timer(const Duration(seconds: 50), () {
      if (phase == CallPhase.incoming) _finish(CallEndReason.noAnswer);
    });
  }

  void _stopRinging() {
    _ringTimer?.cancel();
    _ringTimer = null;
  }

  /* ---------------------------------------------------------- lifecycle */

  void _set(CallPhase p) {
    phase = p;
    notifyListeners();
  }

  Future<void> _finish(CallEndReason reason) async {
    if (phase == CallPhase.idle || phase == CallPhase.ended) return;
    endReason = reason;
    _stopRinging();
    _timeout?.cancel();
    await _teardown();
    _set(CallPhase.ended);
    HapticFeedback.mediumImpact();
    // Show "Call ended" briefly, then go idle.
    _endTimer = Timer(const Duration(seconds: 2), () {
      if (phase == CallPhase.ended) _set(CallPhase.idle);
    });
  }

  Future<void> _teardown() async {
    try {
      for (final t in _local?.getTracks() ?? const <MediaStreamTrack>[]) {
        await t.stop();
      }
      await _local?.dispose();
    } catch (_) {}
    try {
      await _pc?.close();
    } catch (_) {}
    _local = null;
    _pc = null;
  }

  void _reset() {
    _endTimer?.cancel();
    _timeout?.cancel();
    _stopRinging();
    endReason = null;
    callId = null;
    chatId = null;
    peer = null;
    muted = false;
    speaker = false;
    connectedAt = null;
    _peerDevice = null;
    _pendingOffer = null;
    _pendingIce.clear();
    _remoteSet = false;
  }
}
