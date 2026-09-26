import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';

/// A human label for this phone, shown in the "active sessions" list.
Future<(String device, String platform)> describeDevice() async {
  try {
    final info = DeviceInfoPlugin();
    if (Platform.isAndroid) {
      final a = await info.androidInfo;
      final brand = a.manufacturer.isEmpty ? '' : '${a.manufacturer[0].toUpperCase()}${a.manufacturer.substring(1)} ';
      return ('$brand${a.model} · Android ${a.version.release}', 'android');
    }
    if (Platform.isIOS) {
      final i = await info.iosInfo;
      return ('${i.name.isNotEmpty ? i.name : i.model} · iOS ${i.systemVersion}', 'ios');
    }
  } catch (_) {}
  return ('Chatters app', Platform.operatingSystem);
}
