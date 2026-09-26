import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import '../storage.dart';

class ApiError implements Exception {
  ApiError(this.message, [this.status]);
  final String message;
  final int? status;
  @override
  String toString() => message;
}

/// Shared HTTP wrapper: attaches the bearer token, parses errors uniformly and
/// signals a revoked session once (on 401).
class Api {
  Api._();

  static final http.Client _http = http.Client();
  static final StreamController<void> _expired =
      StreamController<void>.broadcast();

  /// Fires when the token expired or an admin revoked the session.
  static Stream<void> get onSessionExpired => _expired.stream;

  static Uri url(String path) =>
      Uri.parse(path.startsWith('http') ? path : '$apiBase${path.startsWith('/') ? '' : '/'}$path');

  static Map<String, String> authHeader() {
    final t = Storage.token;
    return t == null ? {} : {'Authorization': 'Bearer $t'};
  }

  static Future<dynamic> request(
    String path, {
    String method = 'GET',
    Object? body,
    bool auth = true,
  }) async {
    final headers = <String, String>{if (auth) ...authHeader()};
    final req = http.Request(method, url(path));
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      req.body = jsonEncode(body);
    }
    req.headers.addAll(headers);
    final res = await http.Response.fromStream(await _http.send(req));
    return _handle(res, auth);
  }

  static Future<dynamic> multipart(
    String path, {
    required String field,
    required String filePath,
    String? filename,
    Map<String, String> fields = const {},
  }) async {
    final req = http.MultipartRequest('POST', url(path));
    req.headers.addAll(authHeader());
    req.fields.addAll(fields);
    req.files.add(await http.MultipartFile.fromPath(field, filePath, filename: filename));
    final res = await http.Response.fromStream(await _http.send(req));
    return _handle(res, true);
  }

  static Future<List<int>> bytes(String path) async {
    final res = await _http.get(url(path), headers: authHeader());
    if (res.statusCode == 401) {
      _sessionExpired();
      throw ApiError('Your session has expired. Please sign in again.', 401);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiError('Download failed (${res.statusCode})', res.statusCode);
    }
    return res.bodyBytes;
  }

  static dynamic _handle(http.Response res, bool auth) {
    if (res.statusCode == 401 && auth) {
      _sessionExpired();
      throw ApiError('Your session has expired. Please sign in again.', 401);
    }
    dynamic data;
    if (res.body.isNotEmpty) {
      try {
        data = jsonDecode(utf8.decode(res.bodyBytes));
      } catch (_) {
        data = null;
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final msg = data is Map && data['error'] != null
          ? data['error'].toString()
          : 'Request failed (${res.statusCode})';
      throw ApiError(msg, res.statusCode);
    }
    return data;
  }

  static void _sessionExpired() {
    Storage.clearSession();
    _expired.add(null);
  }

  static Future<dynamic> get(String p) => request(p);
  static Future<dynamic> post(String p, [Object? b]) => request(p, method: 'POST', body: b);
  static Future<dynamic> put(String p, [Object? b]) => request(p, method: 'PUT', body: b);
  static Future<dynamic> del(String p, [Object? b]) => request(p, method: 'DELETE', body: b);
}
