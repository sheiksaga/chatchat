/* ══════════════════════════════════════════════════════════════
   imagestore.js — IndexedDB blob store for generated images

   Generated images are far too large for localStorage (a single
   512x512 PNG is ~350KB as base64, and the whole localStorage quota
   is 5-10MB across every chat). So the bytes live here, keyed by a
   short id, and chatHistory only carries that id.
   ══════════════════════════════════════════════════════════════ */

const IMAGE_DB_NAME = 'chatchat-images';
const IMAGE_DB_VERSION = 1;
const IMAGE_STORE = 'images';

/** @type {Promise<IDBDatabase>|null} Cached open-database promise. */
let _imageDbPromise = null;

/**
 * Open (and lazily create) the image database.
 * @returns {Promise<IDBDatabase>}
 */
function openImageDb() {
    if (_imageDbPromise) return _imageDbPromise;

    _imageDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IMAGE_STORE)) {
                const store = db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
                // Lets us sweep every blob belonging to a deleted chat.
                store.createIndex('chatId', 'chatId', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    // Don't cache a rejected promise — a later call should retry the open.
    _imageDbPromise.catch(() => { _imageDbPromise = null; });
    return _imageDbPromise;
}

/**
 * Wrap an IDB request in a promise.
 * @param {IDBRequest} req
 * @returns {Promise<any>}
 */
function _idbRequest(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Persist a generated image.
 * @param {{id:string, chatId:string, dataUrl:string, prompt:string, model:string}} record
 * @returns {Promise<string>} The stored id
 */
async function putImage(record) {
    const db = await openImageDb();
    const tx = db.transaction(IMAGE_STORE, 'readwrite');
    tx.objectStore(IMAGE_STORE).put(Object.assign({ createdAt: Date.now() }, record));
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
    return record.id;
}

/**
 * Look up a stored image.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
async function getImage(id) {
    const db = await openImageDb();
    const tx = db.transaction(IMAGE_STORE, 'readonly');
    return await _idbRequest(tx.objectStore(IMAGE_STORE).get(id));
}

/**
 * Delete every image belonging to the given chats.
 * @param {string[]} chatIds
 * @returns {Promise<number>} Count deleted
 */
async function deleteImagesForChats(chatIds) {
    if (!chatIds.length) return 0;
    const db = await openImageDb();
    const tx = db.transaction(IMAGE_STORE, 'readwrite');
    const index = tx.objectStore(IMAGE_STORE).index('chatId');
    let deleted = 0;

    await Promise.all(chatIds.map(chatId => new Promise((resolve, reject) => {
        const req = index.openCursor(IDBKeyRange.only(String(chatId)));
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return resolve();
            cursor.delete();
            deleted++;
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    })));

    return deleted;
}

/**
 * Drop blobs whose owning chat no longer exists.
 *
 * deleteChat() is undoable, so it deliberately does NOT delete blobs — an
 * undo would otherwise restore a chat full of broken images. Instead we
 * sweep orphans at startup, by which point any undo window has long closed.
 * @returns {Promise<number>} Count reclaimed
 */
async function pruneOrphanImages() {
    try {
        const live = new Set(getChatIndex().map(String));
        const db = await openImageDb();
        const tx = db.transaction(IMAGE_STORE, 'readonly');
        const all = await _idbRequest(tx.objectStore(IMAGE_STORE).getAll());
        const orphans = [...new Set(
            all.map(r => String(r.chatId)).filter(id => !live.has(id))
        )];
        return await deleteImagesForChats(orphans);
    } catch (err) {
        console.warn('Image prune skipped:', err);
        return 0;
    }
}

/** Generate a short unique image id. */
function newImageId() {
    return 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
