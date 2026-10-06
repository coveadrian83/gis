/*
 * GeoCore – logica geografică comună (browser + server).
 *
 * - normalizarea textului pentru căutare tolerantă (diacritice, majuscule, greșeli minore);
 * - normalizarea straturilor GeoJSON / nomenclatoarelor, indiferent de denumirea exactă a câmpurilor;
 * - clasificarea point-in-polygon: zonă MVA–MVI / localitate SIRUTA / UAT_REST / OUT_ZMI;
 * - căutarea locală în ordinea metodologică: repere → localități SIRUTA → zone Iași.
 *
 * Același fișier este încărcat în browser (window.GeoCore) și în Node (require),
 * astfel încât clientul și serverul clasifică identic.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GeoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Nomenclatorul celor 17 zone MVA–MVI (Anexa A) și armonizarea poligoanelor sursă (7.1)
  // ---------------------------------------------------------------------------
  var ZONES = [
    { code: 'IAS-Z01', name: 'Bularga – Zona Industrială', sources: ['BULARGA-ZONA INDUSTRIALA'] },
    { code: 'IAS-Z02', name: 'Aviației', sources: ['AVIATIEI', 'UNNAMED_2'] },
    { code: 'IAS-Z03', name: 'Moara de Vânt', sources: ['MOARA DE VANT', 'UNNAMED_4'] },
    { code: 'IAS-Z04', name: 'Țicău – Sărărie', sources: ['TICAU-SARARIE'] },
    { code: 'IAS-Z05', name: 'Copou', sources: ['COPOU', 'UNNAMED_7'] },
    { code: 'IAS-Z06', name: 'Dacia', sources: ['DACIA', 'UNNAMED_8'] },
    { code: 'IAS-Z07', name: 'Păcurari', sources: ['PACURARI'] },
    { code: 'IAS-Z08', name: 'Galata – Mircea', sources: ['GALATA-MIRCEA'] },
    { code: 'IAS-Z09', name: 'CUG', sources: ['CUG'] },
    { code: 'IAS-Z10', name: 'Bucium', sources: ['BUCIUM'] },
    { code: 'IAS-Z11', name: 'Nicolina', sources: ['NICOLINA'] },
    { code: 'IAS-Z12', name: 'Frumoasa', sources: ['FRUMOASA', 'UNNAMED_13'] },
    { code: 'IAS-Z13', name: 'Alexandru cel Bun', sources: ['ALEXANDRU CEL BUN'] },
    { code: 'IAS-Z14', name: 'Cantemir – Socola', sources: ['CANTEMIR-SOCOLA'] },
    { code: 'IAS-Z15', name: 'Centru', sources: ['CENTRU'] },
    { code: 'IAS-Z16', name: 'Studențesc', sources: ['STUDENTESC'] },
    { code: 'IAS-Z17', name: 'Tătărași', sources: ['TATARASI'] }
  ];

  var IASI_UAT_SIRUTA = '95060';
  var IASI_CENTER = [47.1585, 27.6014];
  var OUT_ZMI = 'OUT_ZMI';

  var UNIT_TYPES = {
    IAS_ZONE: 'IAS_ZONE',
    LOCALITY: 'LOCALITY',
    UAT_REST: 'UAT_REST',
    OUT_ZMI: 'OUT_ZMI'
  };

  // ---------------------------------------------------------------------------
  // Text
  // ---------------------------------------------------------------------------
  function normalize(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .toLowerCase()
      .replace(/[şș]/g, 's')
      .replace(/[ţț]/g, 't')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[„”"'`´’‘.,;:()\[\]{}!?]/g, ' ')
      .replace(/[–—_\/-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compact(s) {
    return normalize(s).replace(/[^a-z0-9]/g, '');
  }

  function levenshtein(a, b, max) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var rowMin = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  /** Scor de potrivire 0..100 între interogare și un text de căutare normalizat. */
  function matchScore(q, text) {
    if (!q || !text) return 0;
    if (text === q) return 100;
    if (text.indexOf(q) === 0) return 85;
    var words = text.split(' ');
    for (var i = 0; i < words.length; i++) if (words[i].indexOf(q) === 0) return 75;
    if (text.indexOf(q) >= 0) return 60;
    // mai multe cuvinte: fiecare cuvânt căutat începe un cuvânt din denumire („spital spiridon”, „sf spiridon”)
    var qw = q.split(' ');
    if (qw.length > 1 && qw.every(function (w) { return words.some(function (t) { return t.indexOf(w) === 0; }); })) return 70;
    var qc = q.replace(/ /g, ''), tc = text.replace(/ /g, '');
    if (qc.length >= 3 && tc.indexOf(qc) >= 0) return 55;
    // greșeli minore de tastare
    if (q.length >= 4) {
      var max = q.length >= 7 ? 2 : 1;
      var best = max + 1;
      var prefixes = q.length >= 5; // comparația pe prefix doar pentru interogări mai lungi (evită zgomotul)
      if (prefixes) best = Math.min(best, levenshtein(q, text.slice(0, q.length), max));
      for (var k = 0; k < words.length; k++) {
        best = Math.min(best, levenshtein(q, words[k], max));
        if (prefixes) best = Math.min(best, levenshtein(q, words[k].slice(0, q.length), max));
      }
      if (best <= max) return 45 - best * 10;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Geometrie
  // ---------------------------------------------------------------------------
  /** Transformă o geometrie GeoJSON în listă de poligoane (fiecare = listă de inele [lng,lat]). */
  function toPolygons(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.slice();
    if (geometry.type === 'GeometryCollection') {
      var out = [];
      (geometry.geometries || []).forEach(function (g) { out = out.concat(toPolygons(g)); });
      return out;
    }
    return [];
  }

  function bboxOf(polygons) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    polygons.forEach(function (poly) {
      (poly[0] || []).forEach(function (c) {
        if (c[0] < b[0]) b[0] = c[0];
        if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0];
        if (c[1] > b[3]) b[3] = c[1];
      });
    });
    return b;
  }

  function inBbox(b, lng, lat) {
    return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
  }

  function inRing(ring, lng, lat) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function inPolygons(polygons, lng, lat) {
    for (var p = 0; p < polygons.length; p++) {
      var poly = polygons[p];
      if (!poly.length || !inRing(poly[0], lng, lat)) continue;
      var inHole = false;
      for (var h = 1; h < poly.length; h++) if (inRing(poly[h], lng, lat)) { inHole = true; break; }
      if (!inHole) return true;
    }
    return false;
  }

  /** Centroid ponderat cu aria (inelul exterior al fiecărui poligon). Returnează [lat, lng]. */
  function centroidOf(polygons) {
    var A = 0, cx = 0, cy = 0;
    polygons.forEach(function (poly) {
      var r = poly[0] || [];
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        A += f;
        cx += (r[j][0] + r[i][0]) * f;
        cy += (r[j][1] + r[i][1]) * f;
      }
    });
    if (Math.abs(A) < 1e-12) {
      var b = bboxOf(polygons);
      return [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2];
    }
    return [cy / (3 * A), cx / (3 * A)];
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371.0088, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // ---------------------------------------------------------------------------
  // Normalizarea datelor de intrare (tolerantă la denumirea câmpurilor)
  // ---------------------------------------------------------------------------
  function pick(obj, keys) {
    if (!obj) return undefined;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    // potrivire fără diferență de majuscule
    var lower = {};
    Object.keys(obj).forEach(function (k) { lower[k.toLowerCase()] = obj[k]; });
    for (var j = 0; j < keys.length; j++) {
      var w = lower[keys[j].toLowerCase()];
      if (w !== undefined && w !== null && String(w).trim() !== '') return w;
    }
    return undefined;
  }

  function num(v) {
    if (v === undefined || v === null || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  var ZONE_BY_SOURCE = {};
  ZONES.forEach(function (z) {
    ZONE_BY_SOURCE[compact(z.name)] = z.code;
    ZONE_BY_SOURCE[compact(z.code)] = z.code;
    z.sources.forEach(function (s) { ZONE_BY_SOURCE[compact(s)] = z.code; });
  });
  var ZONE_BY_CODE = {};
  ZONES.forEach(function (z) { ZONE_BY_CODE[z.code] = z; });

  function zoneCodeFor(props) {
    var code = pick(props, ['zone_id', 'zone_code', 'cod_zona', 'code', 'cod', 'id_zona', 'od_zone']);
    if (code) {
      var m = String(code).toUpperCase().match(/^IAS-?Z?(\d{1,2})$/);
      if (m) return 'IAS-Z' + ('0' + parseInt(m[1], 10)).slice(-2);
      if (ZONE_BY_SOURCE[compact(code)]) return ZONE_BY_SOURCE[compact(code)];
    }
    var names = [
      pick(props, ['zone_name', 'zona', 'nume_zona', 'mva_mvi_zone', 'analysis_zone']),
      pick(props, ['name', 'nume', 'denumire', 'NAME', 'Name', 'cartier']),
      pick(props, ['source_name', 'src_name', 'sursa', 'original_name'])
    ];
    for (var i = 0; i < names.length; i++) {
      if (names[i] && ZONE_BY_SOURCE[compact(names[i])]) return ZONE_BY_SOURCE[compact(names[i])];
    }
    return null;
  }

  function featuresOf(fc) {
    if (!fc) return [];
    if (Array.isArray(fc)) return fc;
    if (fc.type === 'FeatureCollection') return fc.features || [];
    if (fc.type === 'Feature') return [fc];
    return [];
  }

  function normalizeZones(fc, warnings) {
    var byCode = {};
    featuresOf(fc).forEach(function (f, idx) {
      var code = zoneCodeFor(f.properties || {});
      if (!code) {
        warnings.push('Zonă nerecunoscută (feature #' + idx + '): ' + JSON.stringify(f.properties || {}).slice(0, 120));
        return;
      }
      var polys = toPolygons(f.geometry);
      if (!polys.length) return;
      byCode[code] = (byCode[code] || []).concat(polys);
    });
    var zones = ZONES.map(function (z) {
      var polys = byCode[z.code] || [];
      if (!polys.length) warnings.push('Lipsește geometria pentru ' + z.code + ' ' + z.name);
      return {
        code: z.code,
        name: z.name,
        polygons: polys,
        bbox: polys.length ? bboxOf(polys) : null,
        centroid: polys.length ? centroidOf(polys) : null
      };
    });
    return zones;
  }

  function normalizeUats(fc, warnings) {
    return featuresOf(fc).map(function (f, idx) {
      var p = f.properties || {};
      var siruta = pick(p, ['siruta', 'SIRUTA', 'natcode', 'natCode', 'NATCODE', 'siruta_uat', 'uat_siruta', 'cod_siruta', 'code']);
      var name = pick(p, ['canonical_name', 'uat_name', 'name', 'NAME', 'Name', 'nume', 'denumire', 'uat', 'UAT', 'NUME']);
      if (!siruta) warnings.push('UAT fără cod SIRUTA (feature #' + idx + ')');
      var polys = toPolygons(f.geometry);
      var cleanName = String(name || ('UAT ' + (siruta || idx))).replace(/^(municipiul|orasul|oraşul|orașul|comuna)\s+/i, '');
      var s = siruta ? String(siruta).trim() : 'UNK' + idx;
      var isIasi = s === IASI_UAT_SIRUTA || compact(cleanName) === 'iasi' || compact(name) === 'municipiuliasi';
      return {
        siruta: s,
        name: titleCase(cleanName),
        isIasi: isIasi,
        polygons: polys,
        bbox: polys.length ? bboxOf(polys) : null,
        centroid: polys.length ? centroidOf(polys) : null
      };
    }).filter(function (u) { return u.polygons.length; });
  }

  /** Diacritice românești corecte (virgulă dedesubt în loc de sedilă). */
  function fixDiacritics(s) {
    return String(s).replace(/ş/g, 'ș').replace(/Ş/g, 'Ș').replace(/ţ/g, 'ț').replace(/Ţ/g, 'Ț');
  }

  function titleCase(s) {
    s = fixDiacritics(String(s || '').trim());
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/(^|[\s\-–])([a-zăâîșțşţ])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  function normalizeLocalities(data, uats, warnings) {
    var rows = Array.isArray(data) ? data : (data && (data.localitati || data.localities || data.items || data.features)) || [];
    var uatBySiruta = {};
    uats.forEach(function (u) { uatBySiruta[u.siruta] = u; });
    var uatByName = {};
    uats.forEach(function (u) { uatByName[compact(u.name)] = u; });
    var seen = {};
    var out = [];
    rows.forEach(function (r, idx) {
      var p = r && r.type === 'Feature' ? Object.assign({}, r.properties, coordsFromPoint(r.geometry)) : r;
      var siruta = pick(p, ['siruta', 'SIRUTA', 'siruta_loc', 'cod_siruta', 'natcode']);
      var name = pick(p, ['name', 'denumire', 'localitate', 'nume', 'DENLOC', 'locality', 'locality_name']);
      if (!siruta || !name) { warnings.push('Localitate incompletă (rând #' + idx + ')'); return; }
      siruta = String(siruta).trim();
      if (seen[siruta]) return;
      seen[siruta] = true;
      var uatSiruta = pick(p, ['uat_siruta', 'siruta_uat', 'SIRSUP', 'sirsup', 'uat_code', 'cod_uat']);
      var uatName = pick(p, ['uat_name', 'uat', 'UAT', 'comuna', 'nume_uat']);
      var uat = (uatSiruta && uatBySiruta[String(uatSiruta).trim()]) || (uatName && uatByName[compact(String(uatName).replace(/^(municipiul|orasul|orașul|comuna)\s+/i, ''))]) || null;
      out.push({
        siruta: siruta,
        name: titleCase(name),
        uat_siruta: uat ? uat.siruta : (uatSiruta ? String(uatSiruta).trim() : null),
        uat_name: uat ? uat.name : (uatName ? titleCase(uatName) : null),
        lat: num(pick(p, ['lat', 'latitude', 'y', 'LAT'])),
        lng: num(pick(p, ['lng', 'lon', 'long', 'longitude', 'x', 'LON']))
      });
    });
    return out;
  }

  function coordsFromPoint(g) {
    if (g && g.type === 'Point' && g.coordinates) return { lng: g.coordinates[0], lat: g.coordinates[1] };
    return {};
  }

  function normalizePois(data, warnings) {
    var rows = Array.isArray(data) ? data : (data && (data.pois || data.repere || data.items || data.features)) || [];
    var out = [];
    rows.forEach(function (r, idx) {
      var p = r && r.type === 'Feature' ? Object.assign({}, r.properties, coordsFromPoint(r.geometry)) : r;
      if (!p || p.deleted) return;
      var name = pick(p, ['name', 'nume', 'denumire', 'label']);
      if (!name) { warnings.push('Reper fără denumire (rând #' + idx + ')'); return; }
      // reperele fără coordonate sunt păstrate (de localizat din dashboard), dar nu apar în căutarea publică
      var lat = num(pick(p, ['lat', 'latitude', 'y'])), lng = num(pick(p, ['lng', 'lon', 'longitude', 'x']));
      if (lat === null || lng === null) { lat = null; lng = null; }
      var aliases = pick(p, ['aliases', 'alias', 'aliasuri']) || [];
      if (typeof aliases === 'string') aliases = aliases.split(/[;|]/);
      var verified = pick(p, ['verified', 'verificat']);
      out.push({
        id: String(pick(p, ['id', 'poi_id', 'cod']) || ('POI-' + (idx + 1))),
        name: String(name).trim(),
        aliases: aliases.map(function (a) { return String(a).trim(); }).filter(Boolean),
        category: pick(p, ['category', 'categorie', 'tip']) || 'altul',
        lat: lat,
        lng: lng,
        verified: verified === true || verified === 'true' || verified === 'da' || verified === 1
      });
    });
    return out;
  }

  /** Categoriile de repere care corespund unei căutări (ex. „spita” → spitale, „univ” → universități). */
  function matchingCategories(categories, q) {
    if (!categories || q.length < 3) return [];
    return categories.filter(function (c) {
      return (c.keywords || []).some(function (k) {
        k = normalize(k);
        return k.indexOf(q) === 0 || (q.indexOf(k) === 0 && q.length <= k.length + 3 && q.indexOf(' ') < 0);
      });
    }).map(function (c) { return c.code; });
  }

  /**
   * Construiește modelul geografic din fișierele brute.
   * opts: { zones, uats, localities, pois } – conținutul (deja parsat JSON) al fișierelor; oricare poate lipsi.
   */
  function buildModel(opts) {
    opts = opts || {};
    var warnings = [];
    var uats = opts.uats ? normalizeUats(opts.uats, warnings) : [];
    var zones = opts.zones ? normalizeZones(opts.zones, warnings) : ZONES.map(function (z) {
      return { code: z.code, name: z.name, polygons: [], bbox: null, centroid: null };
    });
    var localities = opts.localities ? normalizeLocalities(opts.localities, uats, warnings) : [];
    var pois = opts.pois ? normalizePois(opts.pois, warnings) : [];
    if (!opts.uats) warnings.push('Stratul UAT ZMI lipsește – punctele de pe hartă nu pot fi clasificate pe UAT.');
    if (!opts.zones) warnings.push('Stratul celor 17 zone MVA–MVI lipsește.');
    if (!opts.localities) warnings.push('Nomenclatorul SIRUTA al localităților lipsește.');

    var model = {
      zones: zones,
      uats: uats,
      localities: localities,
      pois: pois,
      warnings: warnings,
      zoneByCode: {},
      uatBySiruta: {},
      localityBySiruta: {},
      poiById: {},
      bbox: null
    };
    zones.forEach(function (z) { model.zoneByCode[z.code] = z; });
    uats.forEach(function (u) { model.uatBySiruta[u.siruta] = u; });
    localities.forEach(function (l) { model.localityBySiruta[l.siruta] = l; });
    pois.forEach(function (p) { model.poiById[p.id] = p; });
    var all = [];
    uats.forEach(function (u) { all = all.concat(u.polygons); });
    if (all.length) model.bbox = bboxOf(all);
    else {
      var zp = [];
      zones.forEach(function (z) { zp = zp.concat(z.polygons); });
      if (zp.length) model.bbox = bboxOf(zp);
    }
    model.hasUats = uats.length > 0;
    model.hasZones = zones.some(function (z) { return z.polygons.length > 0; });
    model.iasiUat = uats.filter(function (u) { return u.isIasi; })[0] || null;

    // index de căutare
    var entries = [];
    var catByCode = {};
    (opts.poiCategories || []).forEach(function (c) { catByCode[c.code] = c; });
    model.poiCategories = opts.poiCategories || [];
    pois.forEach(function (p) {
      if (p.lat === null || p.lng === null) return;
      var cat = catByCode[p.category];
      entries.push({
        kind: 'poi', ref: p.id, label: p.name, category: p.category,
        sub: cat ? cat.single : 'Reper',
        keys: [p.name].concat(p.aliases).map(normalize), lat: p.lat, lng: p.lng
      });
    });
    localities.forEach(function (l) {
      var u = l.uat_name ? (l.uat_name === l.name ? 'UAT ' + l.uat_name : l.uat_name) : '';
      entries.push({ kind: 'locality', ref: l.siruta, label: l.name, sub: (u ? u + ' · ' : '') + 'SIRUTA ' + l.siruta, keys: [normalize(l.name)], lat: l.lat, lng: l.lng });
    });
    zones.forEach(function (z) {
      var parts = z.name.split(/\s*[–-]\s*/);
      entries.push({
        kind: 'zone', ref: z.code, label: z.name, sub: 'Zonă de analiză Iași · ' + z.code,
        keys: [normalize(z.name)].concat(parts.length > 1 ? parts.map(normalize) : []),
        lat: z.centroid ? z.centroid[0] : null, lng: z.centroid ? z.centroid[1] : null
      });
    });
    model.searchEntries = entries;
    return model;
  }

  var KIND_ORDER = { poi: 0, locality: 1, zone: 2 };

  /** Căutare locală: repere → localități SIRUTA → zone; tolerantă la diacritice și greșeli minore. */
  /**
   * Căutare locală: repere → localități SIRUTA → zone; tolerantă la diacritice și greșeli minore.
   * Dacă textul corespunde unei categorii de repere („univ”, „spita”, „mall”), apar toate reperele categoriei.
   */
  function search(model, query, limit) {
    var q = normalize(query);
    if (q.length < 2) return [];
    limit = limit || 8;
    var cats = matchingCategories(model.poiCategories, q);
    var res = [];
    model.searchEntries.forEach(function (e) {
      var best = 0;
      for (var i = 0; i < e.keys.length; i++) best = Math.max(best, matchScore(q, e.keys[i]));
      var inCat = e.kind === 'poi' && cats.indexOf(e.category) >= 0;
      if (best > 0 || inCat) res.push({ entry: e, score: best, inCat: inCat });
    });
    res.sort(function (a, b) {
      // 1) potrivirile puternice pe nume; 2) reperele din categoria căutată; 3) ordinea metodologică
      var sa = a.score >= 75 ? 2 : a.inCat ? 1 : 0, sb = b.score >= 75 ? 2 : b.inCat ? 1 : 0;
      if (sa !== sb) return sb - sa;
      var ka = KIND_ORDER[a.entry.kind], kb = KIND_ORDER[b.entry.kind];
      if (ka !== kb) return ka - kb;
      if (a.inCat && b.inCat && a.entry.category !== b.entry.category) return a.entry.category < b.entry.category ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.label.localeCompare(b.entry.label, 'ro');
    });
    var n = cats.length ? Math.max(limit, 40) : limit;
    return res.slice(0, n).map(function (r) { return r.entry; });
  }

  // ---------------------------------------------------------------------------
  // Clasificare
  // ---------------------------------------------------------------------------
  function findUat(model, lat, lng) {
    for (var i = 0; i < model.uats.length; i++) {
      var u = model.uats[i];
      if (u.bbox && inBbox(u.bbox, lng, lat) && inPolygons(u.polygons, lng, lat)) return u;
    }
    return null;
  }

  function findZone(model, lat, lng) {
    for (var i = 0; i < model.zones.length; i++) {
      var z = model.zones[i];
      if (z.bbox && inBbox(z.bbox, lng, lat) && inPolygons(z.polygons, lng, lat)) return z;
    }
    return null;
  }

  /** Distanța aproximativă (km) de la punct la conturul unui set de poligoane. */
  function distanceToPolygonsKm(polygons, lat, lng) {
    var kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57, best = Infinity;
    polygons.forEach(function (poly) {
      poly.forEach(function (ring) {
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          var ax = (ring[j][0] - lng) * kx, ay = (ring[j][1] - lat) * ky;
          var bx = (ring[i][0] - lng) * kx, by = (ring[i][1] - lat) * ky;
          var dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
          var t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
          var px = ax + t * dx, py = ay + t * dy;
          var d = Math.sqrt(px * px + py * py);
          if (d < best) best = d;
        }
      });
    });
    return best;
  }

  /** Zona cea mai apropiată, dacă e la cel mult maxKm (fâșii rămase între limita UAT și zone). */
  function nearestZone(model, lat, lng, maxKm) {
    var best = null, bestD = maxKm;
    model.zones.forEach(function (z) {
      if (!z.polygons.length || !z.bbox) return;
      var pad = maxKm / 70;
      if (lng < z.bbox[0] - pad || lng > z.bbox[2] + pad || lat < z.bbox[1] - pad || lat > z.bbox[3] + pad) return;
      var d = distanceToPolygonsKm(z.polygons, lat, lng);
      if (d <= bestD) { bestD = d; best = z; }
    });
    return best;
  }

  function unitFromZone(z, uat) {
    return {
      unit_type: UNIT_TYPES.IAS_ZONE, unit_id: z.code, unit_name: z.name,
      zone_id: z.code, locality_siruta: null,
      uat_siruta: uat ? uat.siruta : IASI_UAT_SIRUTA, uat_name: uat ? uat.name : 'Iași'
    };
  }

  /**
   * Clasifică un punct.
   * Rezultat: { unit_type, unit_id, unit_name, zone_id, locality_siruta, uat_siruta, uat_name, flags[] }
   */
  function classifyPoint(model, lat, lng) {
    var flags = [];
    if (!model.hasUats) {
      // Fără stratul UAT nu putem decide ZMI/exterior; încercăm totuși zonele Iași.
      var z0 = model.hasZones ? findZone(model, lat, lng) : null;
      if (z0) return Object.assign(unitFromZone(z0, null), { flags: flags });
      flags.push('GEO_MISSING');
      return { unit_type: UNIT_TYPES.OUT_ZMI, unit_id: OUT_ZMI, unit_name: 'Neclasificat (date geografice lipsă)', zone_id: null, locality_siruta: null, uat_siruta: null, uat_name: null, flags: flags };
    }
    var uat = findUat(model, lat, lng);
    if (!uat) {
      // Zonele Iași pot depăși ușor limita UAT (geometrii din surse diferite)
      var zx = model.hasZones ? findZone(model, lat, lng) : null;
      if (zx) return Object.assign(unitFromZone(zx, model.iasiUat), { flags: flags });
      return { unit_type: UNIT_TYPES.OUT_ZMI, unit_id: OUT_ZMI, unit_name: 'Exterior ZMI', zone_id: null, locality_siruta: null, uat_siruta: null, uat_name: null, flags: flags };
    }
    if (uat.isIasi) {
      var z = findZone(model, lat, lng);
      if (z) return Object.assign(unitFromZone(z, uat), { flags: flags });
      var zn = model.hasZones ? nearestZone(model, lat, lng, 0.5) : null;
      if (zn) return Object.assign(unitFromZone(zn, uat), { flags: ['ZONE_NEAREST'] });
      flags.push('IASI_NO_ZONE');
      return { unit_type: UNIT_TYPES.UAT_REST, unit_id: 'UAT-' + uat.siruta, unit_name: uat.name + ' (în afara zonelor)', zone_id: null, locality_siruta: null, uat_siruta: uat.siruta, uat_name: uat.name, flags: flags };
    }
    // Fără poligoane de localitate/intravilan, un clic liber pe hartă NU este atribuit forțat unei localități
    // (decizia metodologică din v0.4): unitatea O–D rămâne UAT-ul. Localitatea SIRUTA se alege din căutare.
    return { unit_type: UNIT_TYPES.UAT_REST, unit_id: 'UAT-' + uat.siruta, unit_name: uat.name, zone_id: null, locality_siruta: null, uat_siruta: uat.siruta, uat_name: uat.name, flags: flags };
  }

  /**
   * Clasifică un capăt de deplasare (origine/destinație) pe baza modului de selecție.
   * endpoint: { source: 'poi'|'locality'|'zone'|'map'|'geocoder', ref, label, lat, lng, approx }
   * Identitatea statistică a unei localități alese din nomenclator este păstrată (Metodologie §7).
   */
  function classifyEndpoint(model, ep) {
    var lat = ep.lat, lng = ep.lng;
    if (ep.source === 'locality' && ep.ref && model.localityBySiruta[ep.ref]) {
      var l = model.localityBySiruta[ep.ref];
      var u = model.uatBySiruta[l.uat_siruta];
      if (u && u.isIasi) {
        // Localitate din Municipiul Iași → unitatea O–D este zona MVA–MVI
        var zi = findZone(model, lat, lng);
        if (zi) return Object.assign(unitFromZone(zi, u), { flags: ['LOCALITY_IN_IASI'] });
      }
      var flags = [];
      if (ep.approx) flags.push('LOCATION_APPROX');
      if (u && model.hasUats && !inPolygons(u.polygons, lng, lat)) flags.push('POINT_OUTSIDE_LOCALITY_UAT');
      return {
        unit_type: UNIT_TYPES.LOCALITY, unit_id: 'LOC-' + l.siruta, unit_name: l.name,
        zone_id: null, locality_siruta: l.siruta, uat_siruta: l.uat_siruta, uat_name: l.uat_name, flags: flags
      };
    }
    if (ep.source === 'zone' && ep.ref && model.zoneByCode[ep.ref] && ZONE_BY_CODE[ep.ref]) {
      var z = model.zoneByCode[ep.ref];
      return Object.assign(unitFromZone(z, model.iasiUat), { flags: ['ZONE_CENTROID'] });
    }
    return classifyPoint(model, lat, lng);
  }

  /** Lista tuturor unităților O–D (pentru filtre, acoperire, matrice). */
  function listUnits(model) {
    var units = [];
    model.zones.forEach(function (z) {
      units.push({ unit_type: 'IAS_ZONE', unit_id: z.code, unit_name: z.name, uat_siruta: model.iasiUat ? model.iasiUat.siruta : IASI_UAT_SIRUTA, uat_name: 'Iași', centroid: z.centroid });
    });
    var locByUat = {};
    model.localities.forEach(function (l) {
      var u = model.uatBySiruta[l.uat_siruta];
      if (u && u.isIasi) return;
      (locByUat[l.uat_siruta] = locByUat[l.uat_siruta] || []).push(l);
      units.push({
        unit_type: 'LOCALITY', unit_id: 'LOC-' + l.siruta, unit_name: l.name, uat_siruta: l.uat_siruta, uat_name: l.uat_name,
        centroid: l.lat !== null && l.lng !== null ? [l.lat, l.lng] : (u ? u.centroid : null)
      });
    });
    model.uats.forEach(function (u) {
      units.push({ unit_type: 'UAT_REST', unit_id: 'UAT-' + u.siruta, unit_name: u.name + (u.isIasi ? ' (în afara zonelor)' : ' (nespecificat)'), uat_siruta: u.siruta, uat_name: u.name, centroid: u.centroid });
    });
    units.push({ unit_type: 'OUT_ZMI', unit_id: OUT_ZMI, unit_name: 'Exterior ZMI', uat_siruta: null, uat_name: null, centroid: null });
    return units;
  }

  return {
    ZONES: ZONES,
    ZONE_BY_CODE: ZONE_BY_CODE,
    IASI_UAT_SIRUTA: IASI_UAT_SIRUTA,
    IASI_CENTER: IASI_CENTER,
    UNIT_TYPES: UNIT_TYPES,
    OUT_ZMI: OUT_ZMI,
    normalize: normalize,
    compact: compact,
    levenshtein: levenshtein,
    matchScore: matchScore,
    toPolygons: toPolygons,
    inPolygons: inPolygons,
    centroidOf: centroidOf,
    haversineKm: haversineKm,
    buildModel: buildModel,
    search: search,
    matchingCategories: matchingCategories,
    normalizePois: function (data) { return normalizePois(data, []); },
    classifyPoint: classifyPoint,
    classifyEndpoint: classifyEndpoint,
    listUnits: listUnits,
    zoneCodeFor: zoneCodeFor
  };
});
