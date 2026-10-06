'use strict';
// Imitație în memorie a API-ului @netlify/blobs (getWithMetadata/get/setJSON/list/delete, cu ETag),
// cu întârzieri aleatoare ca să apară conflicte reale de scriere.
function createFakeBlobStore({ jitter = true, etags = true } = {}) {
  const data = new Map();
  let n = 0;
  const wait = () => new Promise((r) => setTimeout(r, jitter ? Math.random() * 4 : 0));
  return {
    data,
    async getWithMetadata(key) {
      await wait();
      const v = data.get(key);
      return v ? { data: JSON.parse(v.body), etag: etags ? v.etag : undefined, metadata: {} } : null;
    },
    async get(key) {
      await wait();
      const v = data.get(key);
      return v ? JSON.parse(v.body) : null;
    },
    async setJSON(key, value, opts = {}) {
      await wait();
      const cur = data.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = '"' + ++n + '"';
      data.set(key, { body: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    async list({ prefix = '' } = {}) {
      await wait();
      return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: data.get(key).etag })), directories: [] };
    },
    async delete(key) { await wait(); data.delete(key); }
  };
}
module.exports = { createFakeBlobStore };
