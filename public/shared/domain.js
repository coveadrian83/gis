/*
 * Domeniul studiului: liste controlate (mod, scop, recurență), etichete și calcule comune client/server.
 * Codurile (cheile) sunt stabile și ajung în baza de date; etichetele pot fi modificate liber.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Domain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MODES = [
    { code: 'car', label: 'Autoturism', icon: '🚗' },
    { code: 'bus', label: 'Autobuz', icon: '🚌', pt: true },
    { code: 'tram', label: 'Tramvai', icon: '🚋', pt: true },
    { code: 'train', label: 'Tren', icon: '🚆', pt: true },
    { code: 'bike', label: 'Bicicletă', icon: '🚲' },
    { code: 'walk', label: 'Mers pe jos', icon: '🚶' },
    { code: 'moto', label: 'Moto / scuter', icon: '🛵' },
    { code: 'taxi', label: 'Taxi / ridesharing', icon: '🚕' },
    { code: 'multimodal', label: 'Multimodal', icon: '🔀' }
  ];

  var PURPOSES = [
    { code: 'work', label: 'Serviciu' },
    { code: 'education', label: 'Educație' },
    { code: 'home', label: 'Întoarcere acasă' },
    { code: 'shopping', label: 'Cumpărături / servicii' },
    { code: 'medical', label: 'Medical' },
    { code: 'escort', label: 'Însoțire' },
    { code: 'leisure', label: 'Timp liber / vizită' },
    { code: 'other', label: 'Altul' }
  ];

  var REPEAT_TYPES = [
    { code: 'recurrent', label: 'Recurent (îl fac des)' },
    { code: 'occasional', label: 'Ocazional' }
  ];

  /*
   * Opriri pe drum (opțional, selecție multiplă). Scopul deplasării rămâne unul singur (scopul principal);
   * opririle permit separarea duratelor drumurilor directe de cele cu opriri (ex. copii lăsați la școală).
   * 'direct' = participantul a confirmat că nu a oprit.
   */
  var STOP_TYPES = [
    { code: 'direct', label: 'Nu, drum direct', exclusive: true },
    { code: 'escort_child', label: 'Am lăsat / luat copii (școală, grădiniță)' },
    { code: 'escort_other', label: 'Am lăsat / luat alt pasager' },
    { code: 'shopping', label: 'Cumpărături / servicii' },
    { code: 'other', label: 'Altă oprire' }
  ];

  var CAR_ROLES = [
    { code: 'driver', label: 'Șofer' },
    { code: 'passenger', label: 'Pasager' }
  ];

  // Ocupare: număr total de persoane în autoturism, inclusiv șoferul (5 = 5 sau mai multe)
  var OCCUPANCY = [1, 2, 3, 4, 5];

  var STATUSES = ['VALID', 'CHECK', 'EXCLUDE'];

  /*
   * Categoriile de repere. `keywords`: ce poate tasta un participant ca să vadă TOATE reperele categoriei
   * (fără diacritice, se potrivește și începutul cuvântului: „univ”, „spita”, „mall”).
   * Codurile sunt stabile (ajung în fișiere); etichetele și cuvintele-cheie pot fi modificate liber.
   */
  var POI_CATEGORIES = [
    { code: 'universitate', label: 'Universități și facultăți', single: 'Universitate', icon: '🎓', keywords: ['universitate', 'universitati', 'univ', 'facultate', 'facultati', 'campus', 'camin', 'camine'] },
    { code: 'spital', label: 'Spitale și clinici', single: 'Spital / clinică', icon: '🏥', keywords: ['spital', 'spitale', 'clinica', 'clinici', 'urgenta', 'urgente', 'maternitate', 'policlinica', 'institutul'] },
    { code: 'comercial', label: 'Centre comerciale', single: 'Centru comercial', icon: '🛍️', keywords: ['mall', 'centru comercial', 'shopping', 'magazin', 'hipermarket', 'supermarket'] },
    { code: 'piata', label: 'Piețe', single: 'Piață', icon: '🧺', keywords: ['piata', 'piete', 'targ', 'hala'] },
    { code: 'transport', label: 'Gări, autogări, aeroport', single: 'Transport', icon: '🚉', keywords: ['gara', 'gari', 'autogara', 'aeroport', 'terminal', 'depou'] },
    { code: 'educatie', label: 'Școli și licee', single: 'Școală / liceu', icon: '🏫', keywords: ['scoala', 'scoli', 'liceu', 'licee', 'colegiu', 'colegii', 'gradinita'] },
    { code: 'administratie', label: 'Instituții publice', single: 'Instituție', icon: '🏛️', keywords: ['primaria', 'primarie', 'prefectura', 'consiliul', 'tribunal', 'judecatoria', 'institutie', 'anaf'] },
    { code: 'loc_munca', label: 'Locuri de muncă / zone industriale', single: 'Loc de muncă', icon: '🏭', keywords: ['fabrica', 'uzina', 'birouri', 'office', 'parc industrial', 'parc tehnologic', 'zona industriala'] },
    { code: 'agrement', label: 'Parcuri, sport, cultură', single: 'Agrement / cultură', icon: '🌳', keywords: ['parc', 'parcuri', 'gradina', 'stadion', 'sala', 'teatru', 'opera', 'muzeu'] },
    { code: 'nod', label: 'Intersecții și noduri rutiere', single: 'Nod rutier', icon: '🚦', keywords: ['intersectie', 'rond', 'sens giratoriu', 'pod', 'pasaj'] },
    { code: 'altul', label: 'Alte repere', single: 'Reper', icon: '★', keywords: [] }
  ];

  // Viteză maximă plauzibilă în linie dreaptă (km/h), pentru semnalarea CHECK
  var MAX_STRAIGHT_SPEED = { car: 110, bus: 70, tram: 50, train: 140, bike: 35, walk: 9, moto: 110, taxi: 110, multimodal: 110 };

  function byCode(list) {
    var m = {};
    list.forEach(function (x) { m[x.code] = x; });
    return m;
  }

  function isPublicTransport(mode) {
    var m = byCode(MODES)[mode];
    return !!(m && m.pt);
  }

  function parseHHMM(s) {
    var m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || '').trim());
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }

  /** Durata în minute; dacă sosirea este „înaintea” plecării, se consideră trecerea peste miezul nopții. */
  function durationMinutes(dep, arr) {
    var d = parseHHMM(dep), a = parseHHMM(arr);
    if (d === null || a === null) return null;
    var diff = a - d;
    return { minutes: diff >= 0 ? diff : diff + 1440, overnight: diff < 0 };
  }

  /** Interval orar de o oră: „07:00–07:59”. */
  function timeBand(hhmm) {
    var t = parseHHMM(hhmm);
    if (t === null) return null;
    var h = Math.floor(t / 60);
    var hh = ('0' + h).slice(-2);
    return hh + ':00–' + hh + ':59';
  }

  function formatDuration(min) {
    if (min === null || min === undefined) return '–';
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }

  return {
    MODES: MODES,
    PURPOSES: PURPOSES,
    REPEAT_TYPES: REPEAT_TYPES,
    STOP_TYPES: STOP_TYPES,
    CAR_ROLES: CAR_ROLES,
    OCCUPANCY: OCCUPANCY,
    STATUSES: STATUSES,
    POI_CATEGORIES: POI_CATEGORIES,
    MAX_STRAIGHT_SPEED: MAX_STRAIGHT_SPEED,
    byCode: byCode,
    isPublicTransport: isPublicTransport,
    parseHHMM: parseHHMM,
    durationMinutes: durationMinutes,
    timeBand: timeBand,
    formatDuration: formatDuration
  };
});
