// Funcția Netlify care servește tot API-ul (/api/*). Datele se salvează în Netlify Blobs,
// în contul Netlify al site-ului – nu este nevoie de alt server sau de altă bază de date.
import '../lib/require-shim.mjs';
import { getStore } from '@netlify/blobs';
import apiModule from '../../server/api.js';
import configModule from '../../server/config.js';
import storageModule from '../../server/storage-blobs.js';
import geoModule from '../../server/geo.js';

const GEO_TTL_MS = 10 * 60 * 1000;
let geoCache = null; // { promise, at }
let api = null;

function getGeo(req) {
  if (!geoCache || Date.now() - geoCache.at > GEO_TTL_MS) {
    // fișierele geografice sunt cele publicate cu site-ul, la /data/
    const promise = geoModule.loadGeoFromUrl(new URL('/data/', req.url).toString());
    geoCache = { promise, at: Date.now() };
    promise.catch(() => { geoCache = null; });
  }
  return geoCache.promise;
}

function reloadGeo(req) {
  geoCache = null;
  return getGeo(req);
}

export default async (req, context) => {
  if (!api) {
    const store = getStore({ name: 'mobilitate', consistency: 'strong' });
    api = apiModule.createApi(configModule, { storage: storageModule.createBlobStorage(store), getGeo, reloadGeo });
  }
  return api.handle(req, { ip: (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'necunoscut' });
};

export const config = { path: '/api/*' };
