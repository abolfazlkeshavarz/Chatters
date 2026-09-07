import * as FileSystem from "expo-file-system";

import { request, apiUrl, authHeader } from "./client";

/**
 * @param {string} chatId
 * @param {{uri: string, name?: string, mimeType?: string}} file  picker result
 */
export function uploadMedia(chatId, file) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("file", {
    uri: file.uri,
    name: file.name || guessName(file),
    type: file.mimeType || "application/octet-stream",
  });

  return request("/api/media", { method: "POST", body: form });
}

function guessName(file) {
  const fromUri = (file.uri || "").split("/").pop();
  return fromUri && fromUri.includes(".") ? fromUri : "upload.bin";
}

/**
 * A source object for <Image>. RN passes the auth header with the request, so
 * no pre-fetch / blob URL is needed the way it is on the web.
 */
export function mediaImageSource(messageId) {
  return {
    uri: apiUrl(`/api/media/${encodeURIComponent(messageId)}`),
    headers: authHeader(),
  };
}

/**
 * Download an attachment to a local file and return its file:// URI, for
 * opening in the OS share sheet / "Save to Files".
 */
export async function downloadMediaToFile(messageId, filename) {
  const target =
    FileSystem.cacheDirectory + (filename || `attachment-${messageId}`);
  const { uri, status } = await FileSystem.downloadAsync(
    apiUrl(`/api/media/${encodeURIComponent(messageId)}`),
    target,
    { headers: authHeader() }
  );
  if (status < 200 || status >= 300) {
    throw new Error("Failed to download attachment");
  }
  return uri;
}
