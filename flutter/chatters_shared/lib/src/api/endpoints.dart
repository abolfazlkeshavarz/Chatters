import 'client.dart';

String _e(Object id) => Uri.encodeComponent(id.toString());

/* ------------------------------------------------------------------ chats */

Future<List<Map<String, dynamic>>> getChats() async =>
    ((await Api.get('/api/chats')) as List? ?? []).cast<Map<String, dynamic>>();

Future<Map<String, dynamic>> createChat(List<String> members, bool isGroup, String name) async =>
    (await Api.post('/api/chats', {'members': members, 'is_group': isGroup, 'name': name}))
        as Map<String, dynamic>;

Future<Map<String, dynamic>> createSecretChat(String userId) async =>
    (await Api.post('/api/secret-chats', {'user_id': userId})) as Map<String, dynamic>;

Future<void> setSelfDestruct(String chatId, int seconds) =>
    Api.put('/api/chats/${_e(chatId)}/self-destruct', {'seconds': seconds});

/// scope "me" leaves the chat; "everyone" deletes a 1:1 / secret chat for both.
Future<void> deleteChat(String chatId, {String scope = 'me'}) =>
    Api.del('/api/chats/${_e(chatId)}', {'scope': scope});

Future<dynamic> getChatMembers(String chatId) => Api.get('/api/chats/${_e(chatId)}/members');

Future<void> addMember(String chatId, String userId) =>
    Api.post('/api/chats/${_e(chatId)}/members', {'user_id': userId});

Future<Map<String, dynamic>> getChatKeys(String chatId) async =>
    (await Api.get('/api/chats/${_e(chatId)}/keys')) as Map<String, dynamic>;

Future<void> acceptE2E(String chatId) => Api.post('/api/chats/${_e(chatId)}/e2e/accept');
Future<void> rejectE2E(String chatId) => Api.post('/api/chats/${_e(chatId)}/e2e/reject');

Future<void> setChatMute(String chatId, bool muted) =>
    Api.put('/api/chats/${_e(chatId)}/mute', {'muted': muted});

/* --------------------------------------------------------------- messages */

Future<List<Map<String, dynamic>>> getMessages(String chatId) async =>
    ((await Api.get('/api/chats/${_e(chatId)}/messages')) as List? ?? [])
        .cast<Map<String, dynamic>>();

/// scope "me" hides it only for you; "everyone" removes it for all members.
Future<void> deleteMessage(int id, {String scope = 'me'}) =>
    Api.del('/api/messages/${_e(id)}', {'scope': scope});

/* ------------------------------------------------------------------ media */

Future<void> uploadMedia(String chatId, String path, {String? filename}) =>
    Api.multipart('/api/media', field: 'file', filePath: path, filename: filename,
        fields: {'chat_id': chatId});

String mediaUrl(int messageId) => Api.url('/api/media/${_e(messageId)}').toString();

/* --------------------------------------------------------------- contacts */

Future<List<Map<String, dynamic>>> getContacts() async {
  final data = await Api.get('/api/contacts');
  return ((data is Map ? data['contacts'] : null) as List? ?? []).cast<Map<String, dynamic>>();
}

Future<void> addContact(String username) => Api.post('/api/contacts', {'username': username});
Future<void> removeContact(String id) => Api.del('/api/contacts/${_e(id)}');

/* ---------------------------------------------------------------- profile */

Future<Map<String, dynamic>> getMe() async => (await Api.get('/api/me')) as Map<String, dynamic>;

Future<void> changeUsername(String name) =>
    Api.put('/api/profile/username', {'new_username': name});

Future<void> changePassword(String oldPw, String newPw, Map<String, dynamic>? keys) =>
    Api.put('/api/profile/password',
        {'old_password': oldPw, 'new_password': newPw, if (keys != null) 'keys': keys});

Future<void> uploadAvatar(String path) =>
    Api.multipart('/api/profile/avatar', field: 'file', filePath: path);

Future<void> deleteAvatar() => Api.del('/api/profile/avatar');

Future<void> setAvatarVisibility(String v) =>
    Api.put('/api/profile/avatar-visibility', {'visibility': v});

String avatarUrl(String userId, [Object? bust]) =>
    '${Api.url('/api/avatars/${_e(userId)}')}${bust != null ? '?v=$bust' : ''}';

/* ------------------------------------------------------------------ admin */

Future<Map<String, dynamic>> adminStats() async =>
    (await Api.get('/api/admin/stats')) as Map<String, dynamic>;

Future<Map<String, dynamic>> adminListUsers({String search = '', int limit = 25, int offset = 0}) async {
  final q = Uri(queryParameters: {'search': search, 'limit': '$limit', 'offset': '$offset'}).query;
  return (await Api.get('/api/admin/users?$q')) as Map<String, dynamic>;
}

Future<void> adminCreateUser(String username, String email, String password, bool isAdmin) =>
    Api.post('/api/admin/users',
        {'username': username, 'email': email, 'password': password, 'is_admin': isAdmin});

Future<void> adminDeleteUser(String id) => Api.del('/api/admin/users/${_e(id)}');

Future<void> adminResetPassword(String id, String pw) =>
    Api.put('/api/admin/users/${_e(id)}/password', {'new_password': pw});

Future<void> adminSetRole(String id, bool isAdmin) =>
    Api.put('/api/admin/users/${_e(id)}/role', {'is_admin': isAdmin});

Future<int> adminGetE2ERetention() async {
  final d = await Api.get('/api/admin/settings/e2e-retention');
  return (d is Map ? d['retention_seconds'] as int? : null) ?? 0;
}

Future<void> adminSetE2ERetention(int s) =>
    Api.put('/api/admin/settings/e2e-retention', {'retention_seconds': s});

Future<dynamic> adminPurgeE2E() => Api.post('/api/admin/e2e/purge-now');
