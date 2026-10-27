/* ══════════════════════════════════════════════════════════════
   imagestore.js — generated pictures live in chats/images/

   The picture bytes are files now, not IndexedDB blobs:

     chats/images/<id>.bin    the image itself
     chats/images/<id>.json   { contentType, chatId, createdAt }

   `getImage()` still returns a `dataUrl`, because that is what the renderer
   and the ComfyUI edit/inpaint upload paths already consume. A small in-memory
   LRU avoids refetching the same picture on every repaint; the folder remains
   the source of truth.
   ══════════════════════════════════════════════════════════════ */

/** @type {Map<string, object>} Recently used records, newest last. */
const _imageCache = new Map();
const IMAGE_CACHE_MAX = 40;

/** Decode a base64 data-URL payload into bytes for the upload endpoint. */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Read a Blob back into a data URL (what the rest of the app expects). */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function cacheImage(record) {
  if (!record || !record.id) return record;
  _imageCache.delete(record.id);
  _imageCache.set(record.id, record);
  while (_imageCache.size > IMAGE_CACHE_MAX) {
    const oldest = _imageCache.keys().next().value;
    _imageCache.delete(oldest);
  }
  return record;
}

async function imageStorageError(res) {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch (e) {
    /* ignore */
  }
  return new Error(
    "Image storage error: HTTP " + res.status + (detail ? " — " + detail : ""),
  );
}

/**
 * Persist a generated image to chats/images/.
 *
 * Local generators return a data URL; cloud providers can return a hosted URL.
 * Data URLs are uploaded as raw bytes. Hosted URLs are handed to the server,
 * which downloads them, avoiding browser CORS restrictions.
 * @param {{id:string, chatId:string, dataUrl:string, prompt:string, model:string}} record
 * @returns {Promise<string>} The stored id
 */
async function putImage(record) {
  const id = record.id;
  const dataUrl = String(record.dataUrl || "");

  const dataMatch = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (dataMatch) {
    const res = await fetch("/api/images/" + encodeURIComponent(id), {
      method: "PUT",
      headers: {
        "Content-Type": dataMatch[1],
        "X-Chat-Id": String(record.chatId || ""),
      },
      body: base64ToBytes(dataMatch[2]),
    });
    if (!res.ok) throw await imageStorageError(res);
    cacheImage(Object.assign({ createdAt: Date.now() }, record));
    return id;
  }

  if (/^https?:/i.test(dataUrl)) {
    const res = await fetch(
      "/api/images/" + encodeURIComponent(id) + "/fetch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dataUrl, chatId: record.chatId || "" }),
      },
    );
    if (!res.ok) throw await imageStorageError(res);
    // The hosted form is not a data URL; let getImage() read the downloaded
    // bytes so edit/inpaint still receive the base64 they need.
    _imageCache.delete(id);
    return id;
  }

  throw new Error("Image generation returned no usable image data.");
}

/**
 * Look up a stored image, as a data URL.
 * @param {string} id
 * @returns {Promise<object|undefined>} `{ id, dataUrl }` or undefined when absent
 */
async function getImage(id) {
  if (!id) return undefined;
  const cached = _imageCache.get(id);
  if (cached) {
    // Refresh the LRU position without changing the value.
    _imageCache.delete(id);
    _imageCache.set(id, cached);
    return cached;
  }

  let res;
  try {
    res = await fetch("/api/images/" + encodeURIComponent(id), {
      cache: "no-store",
    });
  } catch (err) {
    console.warn("Image lookup failed for " + id + ":", err);
    return undefined;
  }
  if (!res.ok) return undefined;
  const blob = await res.blob();
  const dataUrl = await blobToDataUrl(blob);
  return cacheImage({ id: id, dataUrl: dataUrl });
}

/** Delete one image file. */
async function deleteImage(id) {
  if (!id) return;
  _imageCache.delete(id);
  try {
    await fetch("/api/images/" + encodeURIComponent(id), { method: "DELETE" });
  } catch (err) {
    console.warn("Image delete failed for " + id + ":", err);
  }
}

/**
 * Reclaim images no remaining chat references.
 *
 * Chat deletion removes the JSON that names the pictures; the bytes are swept
 * here so an undo (which restores the JSON immediately) still has them. The
 * server walks every chat.json and deletes unreferenced `chats/images/*.bin`.
 * @returns {Promise<number>} Count removed
 */
async function pruneOrphanImages() {
  try {
    const res = await fetch("/api/prune", { method: "POST" });
    if (!res.ok) return 0;
    const data = await res.json().catch(() => ({}));
    return Number(data.removed) || 0;
  } catch (err) {
    console.warn("Image prune skipped:", err);
    return 0;
  }
}

/**
 * Kept for callers that used to sweep blobs by chat id.
 *
 * With a folder store, deleting the chat JSON is what makes a blob orphaned;
 * this runs the same reference sweep.
 * @param {string[]} chatIds
 * @returns {Promise<number>}
 */
async function deleteImagesForChats(chatIds) {
  if (!chatIds || !chatIds.length) return 0;
  return await pruneOrphanImages();
}

/** Generate a short unique image id. */
function newImageId() {
  return (
    "img_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}
