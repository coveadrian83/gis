/* Jocul „A8 până în 2030?” – modelul de simulare (fără DOM, testat în Node: test/a8-core.test.js).
 *
 * Un semestru = un pas. Fiecare lot are „left” = semestre de lucru rămase la ritmul contractual și „cost” = bani
 * rămași de plătit (mld. lei, fără TVA). Ritmul real depinde de birocrație (cărți), de bani (SAFE, Programul
 * Transport, BEI, CEF, buget național) și de întâmplare (iarnă, geotehnică, contestații, insolvențe).
 * Bugetul: deficitul anual = ținta din program + efectele deciziilor + cheltuiala națională pe A8 peste cea
 * presupusă în traiectorie + șocuri. Abaterea de la țintă aduce avertismente UE, ajustări forțate și rating junk.
 * Toate cifrele sunt simplificate – vezi secțiunea „Date reale” din pagină. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.A8Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EUR_LEI = 5.1;
  var SEMESTRE = ['S1 2027', 'S2 2027', 'S1 2028', 'S2 2028', 'S1 2029', 'S2 2029', 'S1 2030', 'S2 2030'];
  // PIB nominal (mld. lei): CNSP, prognoza de primăvară 2026 (2027–2029); 2030 extrapolat cu +5,5%
  var PIB = { 2026: 2056.0, 2027: 2201.0, 2028: 2342.9, 2029: 2483.2, 2030: 2620.0 };
  // Ținta de deficit (% PIB, ESA): 2027 – Strategia fiscal-bugetară; 2029–2030 – programul; 2028 interpolat
  var TINTA = { 2027: 5.2, 2028: 4.2, 2029: 3.2, 2030: 2.9 };
  var ORIZONT_MAX = 28;              // calendarul merge până la finalul lui 2040
  var ALEGERI = [3, 11, 19];        // alegeri parlamentare: dec. 2028, dec. 2032, dec. 2036
  var BAZA_NATIONAL = 1.5;          // mld. lei/semestru din bugetul național pentru A8, presupus deja în traiectorie
  var SAFE_COR = 4.2 * EUR_LEI;     // cota SAFE pentru coridoare (≈4,2 mld. euro), împărțită A8 / Pașcani–Siret
  var PT_A8 = 6;                    // ipoteză: bani din Programul Transport 2021–2027 rămași pentru A8 (eligibili până la 31.12.2029)
  var ULTIMUL_AN_PT = 2029;
  var ULTIMUL_AN_SAFE = 2030;       // plățile SAFE se fac până la finalul lui 2030
  function pibAn(y) { return PIB[y] || PIB[2030] * Math.pow(1.055, y - 2030); }
  function tintaAn(y) { return TINTA[y] || 2.8; }
  function eticheta(sem) { return (sem % 2 === 0 ? 'S1 ' : 'S2 ') + (2027 + Math.floor(sem / 2)); }

  // Nodurile traseului (lon, lat) – schematic
  var NODURI = [
    ['Târgu Mureș', 24.60, 46.55], ['Miercurea Nirajului', 24.80, 46.53], ['Sărățeni', 25.03, 46.57],
    ['Joseni', 25.47, 46.70], ['Ditrău', 25.51, 46.82], ['Grințieș', 25.84, 47.06], ['Pipirig', 26.07, 47.25],
    ['Leghin', 26.21, 47.26], ['Târgu Neamț', 26.50, 47.22], ['Târgu Frumos', 27.01, 47.21],
    ['Lețcani', 27.41, 47.18], ['Iași', 27.60, 47.21], ['Ungheni', 27.80, 47.21]
  ];

  /* Loturile, la începutul lui 2027. Stadiul de bază: bilanțul A. Covăsnianu (Moldova Vrea Autostradă), Ziarul de Iași,
   * situație la 29.08.2026 (fișe de proiect CNIR/CNAIR, autorizații de construire), completat cu presa de specialitate.
   * ramas = semestre de lucru rămase la ritmul din contract; parte = partea din cost încă neplătită; est = cost estimat;
   * etapa = segment care se poate deschide înainte de restul lotului (la = fracțiunea din lucrare); lent = mobilizare slabă. */
  var LOTURI = [
    { id: 'I', mva: 'Deschidere în prima parte a lui 2027 (reper prudent); predicția 2025 – plauzibilă.', nume: 'Târgu Mureș – Miercurea Nirajului', sectiune: 'Vest', km: 24.4, cost: 2.46, parte: 0.35, ramas: 1.2,
      stare: 'executie', sursa: 'PT', munte: false, constructor: 'Nurol (Turcia)', info: 'Lot 1A. 63,79% progres general / 60,09% fizic la 31.07.2026; patru autorizații (2025–2026). Reper prudent: deschidere în prima parte a lui 2027.' },
    { id: '1B', mva: '2028 (estimarea din 2025) – întârziată cu câteva luni.', nume: 'Miercurea Nirajului – Sărățeni', sectiune: 'Montană', km: 23.4, cost: 2.98, parte: 1, ramas: 5,
      stare: 'proiectare', sursa: 'PT', munte: true, constructor: 'Özaltın – Infravis', info: 'Proiectare tehnică finalizată, documentația în avizare; se așteaptă autorizația și ordinul de începere a execuției (24 de luni). Întârziere de câteva luni față de 2025.' },
    { id: '1C', mva: 'Execuție 2027–2032; finalizare 2031/2032 – predicție confirmată până acum.', nume: 'Sărățeni – Joseni', sectiune: 'Montană', km: 32.4, cost: 4.5, est: true, parte: 1, ramas: 9,
      stare: 'proiectare', sursa: 'PT', munte: true, constructor: 'SA&PE – Euro-Asfalt – Tehnostrade – Spedition UMB', info: 'Contract 26.11.2025, proiectare din 30.03.2026 (14 luni; campaniile de teren pot prelungi etapa). Circa jumătate din traseu sunt lucrări de artă; execuție estimată 2027–2032.' },
    { id: '1D', mva: '2028 – devansat.', nume: 'Joseni – Ditrău', sectiune: 'Montană', km: 14.4, cost: 1.8, est: true, parte: 0.85, ramas: 3.5,
      stare: 'executie', sursa: 'PT', munte: true, constructor: 'Danlin XXL – Groma Hold – Intertranscom', info: 'Devansat: autorizație 10.07.2026 (717 mil. lei), lucrări din 17.08.2026, ≈10% după prima lună. Termen ≈ august 2028.' },
    { id: '2A', mva: '2031/2032 – încă posibil, marja s-a redus.', nume: 'Ditrău – Grințieș', sectiune: 'Montană', km: 37.9, cost: 5.5, est: true, parte: 1, ramas: 6.5,
      stare: 'proiectare', sursa: 'PT', munte: true, constructor: 'SA&PE – Tehnostrade – Spedition UMB – Euro-Asfalt', info: 'Cel mai lung lot. Proiectare din 30.06.2025 (14 luni), PAC netransmis la 22.07.2026; contract de 54 de luni. Estimare MVA: 2031/2032.' },
    { id: '2B', mva: 'Nu înainte de 2032, posibil 2033.', nume: 'Grințieș – Pipirig', sectiune: 'Montană', km: 31.5, cost: 5.97, parte: 1, ramas: 8.5,
      stare: 'proiectare', sursa: 'PT', munte: true, constructor: 'SA&PE – Euro-Asfalt – Tehnostrade – Spedition UMB', info: 'Cel mai dificil lot (≈70% lucrări de artă, tuneluri). Contract 31.10.2025 (5,97 mld. lei, 54 de luni), proiectare din 30.03.2026, investigații de teren în curs. Estimare MVA: nu înainte de 2032, posibil 2033.' },
    { id: '2C', mva: 'Sfârșitul lui 2029 / începutul lui 2030 (estimarea din 2025) – întârziat > 1 an.', nume: 'Pipirig – Leghin', sectiune: 'Montană', km: 19.3, cost: 3.0, est: true, parte: 1, ramas: 8,
      stare: 'neactivat', sursa: 'PT', munte: true, constructor: 'SA&PE – Spedition UMB – Tehnostrade – Euro-Asfalt', info: 'Contract semnat la 29.04.2025, dar ordinul de începere a proiectării nu era emis la 29.08.2026 (întârziere > 1 an). După ordin: 12 luni de proiectare, apoi execuția.' },
    { id: 'III', mva: '2027 (estimarea din 2025) – risc confirmat; e nevoie de un program de recuperare.', nume: 'Leghin – Târgu Neamț (Moțca)', sectiune: 'Vest', km: 29.9, cost: 1.56, parte: 0.85, ramas: 4, lent: true,
      stare: 'executie', sursa: 'PT', munte: false, constructor: 'SA&PE – Spedition UMB – Tehnostrade', info: 'Lot 2D. Scos din PNRR; progres fizic 12% (aug. 2026) după o mobilizare slabă; ritmul actual nu susține termenul. Necesită un program realist de recuperare.' },
    { id: 'T1', mva: '5,5 km: 24.08.2027; tot tronsonul: 24.06.2030 (termene contractuale) – parțial confirmată.', nume: 'Târgu Neamț (Moțca) – Târgu Frumos', sectiune: 'Est', km: 27.0, cost: 4.8, parte: 1, ramas: 7,
      etapa: { km: 5.5, la: 0.22, nume: 'legătura cu A7 și DN2' },
      stare: 'proiectare', sursa: 'SAFE', munte: false, constructor: 'SA&PE – Tehnostrade – Spedition UMB – Euro-Asfalt', info: 'Contract SAFE semnat la sfârșitul lui mai 2026 (4,8 mld. lei), proiectare din 24.08.2026. 5,5 km prioritari (legătura cu A7 și DN2): 24.08.2027; tot tronsonul: 24.06.2030.' },
    { id: 'T2', mva: 'Estimarea 2025 (T I/II 2029) – prea optimistă; încă fără calendar.', nume: 'Târgu Frumos – Lețcani', sectiune: 'Est', km: 28.6, cost: 5.0, est: true, parte: 1, ramas: 8,
      stare: 'neatribuit', sursa: 'SAFE', munte: false, constructor: '—', info: 'Singurul tronson fără contract: contestațiile Strabag, Makyol și Kalyon admise în parte de CNSC (31.07.2026), reevaluare. După semnare: 46 de luni.' },
    { id: 'T3', mva: 'Reper prudent: T II 2030; 2029 doar în scenariu accelerat.', nume: 'Lețcani – Iași (DN24)', sectiune: 'Est', km: 17.7, cost: 3.9, parte: 1, ramas: 7,
      stare: 'proiectare', sursa: 'SAFE', munte: false, constructor: 'FCC Construcción (Spania)', info: 'Contract 29.05.2026 (3,9 mld. lei), proiectare din 24.08.2026; termen contractual 24.06.2030. Anul 2029 rămâne doar scenariu accelerat.' },
    { id: 'T4', mva: 'Calendar incert până la soluția instanței; Golăiești – pod (2,77 km) prioritar.', nume: 'Iași (DN24) – Vama Ungheni', sectiune: 'Est', km: 15.5, cost: 3.5, parte: 1, ramas: 7,
      etapa: { km: 2.77, la: 0.5, nume: 'nodul Golăiești – podul peste Prut' },
      stare: 'suspendat', sursa: 'SAFE', munte: false, constructor: 'Itinera – ICM – Saipem (Italia)', info: 'Contract iul. 2026 (3,5 mld. lei; 15,47 km în România + ≈5 km în R. Moldova). Efecte suspendate de Curtea de Apel București (5.08.2026). Segment prioritar Golăiești – pod (2,77 km). Podul de la Ungheni e în execuție din aprilie 2025.' }
  ];
  var KM_TOTAL = LOTURI.reduce(function (s, l) { return s + l.km; }, 0);
  var EST = ['T1', 'T2', 'T3', 'T4'];

  /* Cărțile de decizie. ref = de unde vine măsura; permanent = rămâne activă după ce e aleasă. */
  var CARTI = [
    { id: 'avize', tip: 'a8', titlu: 'Platformă unică de avize, aprobare tacită', ref: 'Program – Transporturi, M13', permanent: true,
      efect: 'Ritm +6% pe toate loturile, de semestrul următor. Capital −2.' },
    { id: 'exproprieri', tip: 'a8', titlu: 'Exproprieri pe tot coridorul înainte de lucrări', ref: 'Program – Transporturi, M13', permanent: true,
      efect: 'Surprizele geotehnice și de teren pe munte scad la jumătate. 0,6 mld. lei din buget, capital −3.' },
    { id: 'uip', tip: 'a8', titlu: 'Unități de implementare cu ingineri plătiți competitiv', ref: 'Program – Transporturi, M13', permanent: true,
      efect: 'Ritm +5%. Deficit +0,02 pp pe an.' },
    { id: 'credite', tip: 'a8', titlu: 'Credite de angajament multianuale pentru marile proiecte', ref: 'Program – Transporturi, M2', permanent: true,
      efect: 'Ritm +4% și mai puține semestre proaste pe șantiere.' },
    { id: 'plata30', tip: 'a8', titlu: 'Plata lucrărilor în 30 de zile, garantat', ref: 'Program – Transporturi, M2', permanent: true,
      efect: 'Bugetul acoperă automat până la 1,5 mld. lei/semestru din lipsa de bani – fără arierate, dar cu deficit mai mare. Capital +2.' },
    { id: 'contestatii', tip: 'a8', titlu: 'Contestații judecate accelerat (CNSC + instanță)', ref: 'Nu e în program', permanent: true,
      efect: 'Șansa de a debloca Târgu Frumos – Lețcani și Iași – Ungheni crește mult. Capital −6.' },
    { id: 'safeA8', tip: 'a8', titlu: 'Mai mult SAFE pentru A8, mai puțin pentru Pașcani – Siret', ref: 'Program – Finanțe M2; Transporturi M11', permanent: false,
      efect: 'Cota A8 din banii SAFE pentru coridoare +15 puncte. Capital −5 (parlamentarii din Suceava și Botoșani).' },
    { id: 'bei', tip: 'a8', titlu: 'Împrumut BEI de 5 mld. lei pentru secțiunea montană', ref: 'Program – Finanțe M4; Transporturi M2', permanent: true,
      efect: '+5 mld. lei pentru loturile de pe munte, din semestrul următor. Banii cheltuiți intră în deficit.' },
    { id: 'cef', tip: 'a8', titlu: 'Cerere CEF – mobilitate militară pentru A8 Est', ref: 'Program – Transporturi, M11', permanent: true,
      efect: 'Peste un an, 50% șanse să primești 2,5 mld. lei pentru Târgu Neamț – Ungheni.' },
    { id: 'schimburi', tip: 'a8', titlu: 'Lucru în trei schimburi, bonus de accelerare', ref: 'Nu e în program', permanent: true,
      efect: 'Ritm +12% pe toate loturile, dar totul costă cu 12% mai mult. Capital +3.' },
    { id: 'ppp', tip: 'a8', titlu: 'Parteneriat public-privat pentru secțiunea montană', ref: 'Program – Transporturi, M14', permanent: true,
      efect: 'Sună bine. Capital +2. Efectul real pe A8 până în 2030 îl afli după ce semnezi.' },
    { id: 'deblocari', tip: 'a8', titlu: 'Deblocările cerute pentru 2026: ordin 2C, autorizație 1B, PAC 2A', ref: 'Propunere MVA (bilanț aug. 2026)', permanent: true,
      efect: 'Pipirig – Leghin primește ordinul de începere; Miercurea Nirajului – Sărățeni și Ditrău – Grințieș câștigă câte o jumătate de semestru. Capital −1.' },
    { id: 'recuperare', tip: 'a8', titlu: 'Program de recuperare pentru Leghin – Moțca', ref: 'Propunere MVA (bilanț aug. 2026)', permanent: true,
      efect: 'Lotul cu 12% progres fizic iese din mobilizarea slabă (ritm +25% pe acest lot). Capital +1.' },
    { id: 'raportare', tip: 'a8', titlu: 'Raportare publică lunară, unitară, pe fiecare lot', ref: 'Propunere MVA (bilanț aug. 2026)', permanent: true,
      efect: 'Un beneficiar atent și o societate civilă vigilentă: ritm +3%, mai puține insolvențe surpriză. Capital +2.' },
    { id: 'securitate', tip: 'a8', titlu: 'A8, obiectiv de securitate națională (CSAT, Strategia de apărare)', ref: 'Propunere MVA (Moldova – flancul estic)', permanent: true,
      efect: 'Proiectul devine greu de „reevaluat”: un guvern nou îl taie mai rar; o cerere CEF – mobilitate militară reușește în 75% din cazuri. Capital +3.' },
    { id: 'cfm', tip: 'a8', titlu: 'A8, prioritate în cadrul financiar european 2028–2034', ref: 'Propunere MVA; Program – Fonduri UE', permanent: true,
      efect: 'Fondurile UE noi pentru A8 vin din 2029, nu din 2030, cu +1 mld. lei pe semestru.' },
    { id: 'pensii', tip: 'buget', titlu: 'Indexarea pensiilor cu inflația + sprijin pentru pensiile mici', ref: 'Program – Finanțe, M2', permanent: true,
      efect: 'Deficit +0,35 pp pe an. Capital +10.' },
    { id: 'spending', tip: 'buget', titlu: 'Spending review și reorganizarea administrației', ref: 'Program – Finanțe, M2 a)', permanent: true,
      efect: 'Deficit −0,3 pp pe an (din anul curent dacă o alegi în S1). Capital −8.' },
    { id: 'anaf', tip: 'buget', titlu: 'ANAF: marea evaziune și arieratele', ref: 'Program – Finanțe, M2 b)', permanent: true,
      efect: 'De anul următor, deficit −0,25 pp (dacă reușește – 60%) sau −0,05 pp. Capital +1.' },
    { id: 'taieinvest', tip: 'buget', titlu: 'Tăiem investițiile naționale cu 40%', ref: 'Soluția clasică (programul spune contrariul)', permanent: true,
      efect: 'Deficit −0,2 pp pe an, dar banii naționali pentru A8 scad cu 40%. Capital −2.' },
    { id: 'taxe', tip: 'buget', titlu: 'Majorăm TVA și accizele', ref: 'Nu e în program', permanent: true,
      efect: 'Deficit −0,5 pp pe an. Capital −14.' },
    { id: 'salarii', tip: 'buget', titlu: 'Majorări salariale uniforme la stat', ref: 'Contrar programului (Finanțe, M2)', permanent: true,
      efect: 'Deficit +0,4 pp pe an. Capital +9.' },
    { id: 'aparare', tip: 'buget', titlu: 'Apărare: urcăm mai repede spre 5% din PIB', ref: 'Program – Apărare', permanent: true,
      efect: 'Deficit +0,25 pp pe an. Capital +3.' }
  ];
  var CARTE = {};
  CARTI.forEach(function (c) { CARTE[c.id] = c; });

  // Strategiile pentru estimarea rapidă a șanselor
  var STRATEGII = {
    inertie: { nume: 'Inerție', descriere: 'Nicio măsură nouă, bani naționali ca acum.', carti: [], national: BAZA_NATIONAL },
    program: { nume: 'Programul de guvernare, aplicat integral', descriere: 'Avize rapide, UIP, credite multianuale, plata în 30 de zile, exproprieri, PPP, spending review, ANAF, indexarea pensiilor.',
      carti: ['avize', 'uip', 'credite', 'plata30', 'exproprieri', 'ppp', 'spending', 'anaf', 'pensii'], national: BAZA_NATIONAL },
    totul: { nume: 'Totul pentru A8', descriere: 'Programul + contestații accelerate, trei schimburi, BEI, CEF, tot SAFE-ul pe A8 și 3 mld. lei/semestru din buget.',
      carti: ['avize', 'uip', 'credite', 'plata30', 'exproprieri', 'spending', 'anaf', 'pensii', 'contestatii', 'schimburi', 'bei', 'cef', 'safeA8', 'safeA8'], national: 3 }
  };

  function an(sem) { return 2027 + Math.floor(sem / 2); }

  function rngStare(st) {
    return function () {
      var t = (st.seed = (st.seed + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function stareInitiala(seed) {
    return {
      sem: 0, orizont: SEMESTRE.length, scen: null, seed: (seed == null ? 20270101 : seed) >>> 0,
      loturi: LOTURI.map(function (l) {
        return { id: l.id, left: l.ramas, cost: Math.round(l.cost * l.parte * 100) / 100, stare: l.stare, intarziere: 0, blocat: 0, deschis: null, semnat: null, etapa: null };
      }),
      national: BAZA_NATIONAL, safeA8: 0.7, safeFolosit: 0, pt: PT_A8, bei: 0, beiDe: 99, cef: 0, cefDe: null, mff: 0, mffSem: 1.5, mffDe: 2030,
      carti: {}, prioritate: 'prorata', fiscal: [], natCheltuit: {}, soc: {}, deficit: { 2026: 6.0 }, datorie: 60.4,
      rating: 1, avertismente: 0, aniLaTinta: 0, capital: 55, ajustare: 0, interimat: 0, reevaluare: 0,
      cheltuitA8: 0, stiri: [], terminat: false
    };
  }

  function stire(st, text, tip) { st.stiri.push({ sem: st.sem, text: text, tip: tip || 'neutru' }); }
  function limCapital(st) { st.capital = Math.max(0, Math.min(100, st.capital)); }
  function lot(st, id) { for (var i = 0; i < st.loturi.length; i++) if (st.loturi[i].id === id) return st.loturi[i]; return null; }
  function info(id) { for (var i = 0; i < LOTURI.length; i++) if (LOTURI[i].id === id) return LOTURI[i]; return null; }
  function activ(l) { return l.deschis == null && l.stare !== 'neatribuit' && l.stare !== 'suspendat' && l.stare !== 'neactivat' && l.blocat === 0; }

  /* Ordinea de plată când banii naționali, europeni noi și BEI nu ajung pentru toate loturile. */
  var PRIORITATI = {
    prorata: { nume: 'Fără prioritizare', descriere: 'Lipsa de bani se împarte proporțional între toate loturile (cum se întâmplă de obicei).' },
    executie: { nume: 'Întâi ce e mai aproape de final', descriere: '„Finalizăm coridoarele aflate în execuție înaintea deschiderii altora” (Program, Transporturi M2): loturile cu cel mai puțin de lucru rămas primesc banii primele.' },
    mva: { nume: 'Planul MVA', descriere: 'Moldova Vrea Autostradă: întâi Ungheni – Iași – Târgu Neamț (resurse multianuale, segmentele prioritare spre A7 și spre podul de la Ungheni), apoi capetele montane aflate în execuție, apoi restul secțiunii montane.',
      ordine: ['T4', 'T1', 'T3', 'T2', 'I', 'III', '1D', '1B', '2C', '2A', '1C', '2B'] },
    munte: { nume: 'Întâi munții', descriere: 'Varianta opusă: legăturile lipsă din Carpați primesc banii primii, sectorul ieșean rămâne pe SAFE.',
      ordine: ['2A', '1C', '2B', '2C', '1B', '1D', 'I', 'III', 'T1', 'T3', 'T2', 'T4'] }
  };
  function ordoneaza(st, plan) {
    var pr = PRIORITATI[st.prioritate] || PRIORITATI.prorata;
    if (st.prioritate === 'executie') return plan.slice().sort(function (a, b) { return a.l.left - b.l.left; });
    if (!pr.ordine) return plan;
    return plan.slice().sort(function (a, b) { return pr.ordine.indexOf(a.l.id) - pr.ordine.indexOf(b.l.id); });
  }

  function cartiDisponibile(st) {
    return CARTI.filter(function (c) {
      if (c.id === 'safeA8') return st.safeA8 < 0.999;
      if (c.id === 'cef' && st.sem >= 7) return false;
      return !st.carti[c.id];
    });
  }

  // Patru cărți pe semestru, alese determinist din seed-ul stării (aceeași mână la reîncărcare)
  function mana(st) {
    var disp = cartiDisponibile(st), r = rngStare({ seed: (st.seed ^ 0x9E3779B9) >>> 0 }), out = [];
    var a8 = disp.filter(function (c) { return c.tip === 'a8'; }), bg = disp.filter(function (c) { return c.tip === 'buget'; });
    function trage(lista, n) { while (n-- > 0 && lista.length) out.push(lista.splice(Math.floor(r() * lista.length), 1)[0]); }
    trage(a8, 2); trage(bg, 1); trage(a8.concat(bg), 4 - out.length);
    return out;
  }

  function aplicaCarte(st, id, rng) {
    var y = an(st.sem), c = CARTE[id];
    if (!c) return;
    if (c.permanent) st.carti[id] = st.sem + 1;
    switch (id) {
      case 'avize': st.capital -= 2; break;
      case 'exproprieri': st.natCheltuit[y] = (st.natCheltuit[y] || 0) + 0.6; st.capital -= 3; break;
      case 'uip': st.fiscal.push({ de: y, pp: 0.02 }); break;
      case 'plata30': st.capital += 2; break;
      case 'contestatii': st.capital -= 6; break;
      case 'safeA8': st.safeA8 = Math.min(1, st.safeA8 + 0.15); st.capital -= 5; break;
      case 'bei': st.bei += 5; st.beiDe = st.sem + 1; break;
      case 'cef': st.cefDe = st.sem + 2; break;
      case 'deblocari':
        var l2c = lot(st, '2C'); if (l2c.stare === 'neactivat') { l2c.stare = 'proiectare'; l2c.semnat = st.sem; }
        lot(st, '1B').left = Math.max(0.5, lot(st, '1B').left - 0.5); lot(st, '2A').left = Math.max(0.5, lot(st, '2A').left - 0.5);
        st.capital -= 1; break;
      case 'recuperare': st.capital += 1; break;
      case 'raportare': st.capital += 2; break;
      case 'securitate': st.capital += 3; break;
      case 'cfm': st.mffDe = Math.min(st.mffDe, 2029); st.mffSem += 1; break;
      case 'schimburi': st.capital += 3; break;
      case 'ppp': st.capital += 2; break;
      case 'pensii': st.fiscal.push({ de: y, pp: 0.35 }); st.capital += 10; break;
      case 'spending': st.fiscal.push({ de: st.sem % 2 === 0 ? y : y + 1, pp: -0.3 }); st.capital -= 8; break;
      case 'anaf': st.fiscal.push({ de: y + 1, pp: rng() < 0.6 ? -0.25 : -0.05 }); st.capital += 1; break;
      case 'taieinvest': st.fiscal.push({ de: y, pp: -0.2 }); st.capital -= 2; break;
      case 'taxe': st.fiscal.push({ de: y, pp: -0.5 }); st.capital -= 14; break;
      case 'salarii': st.fiscal.push({ de: y, pp: 0.4 }); st.capital += 9; break;
      case 'aparare': st.fiscal.push({ de: y, pp: 0.25 }); st.capital += 3; break;
    }
    limCapital(st);
  }

  function nationalEfectiv(st) {
    var n = st.national;
    if (st.carti.taieinvest) n *= 0.6;
    if (st.ajustare > 0) n = Math.min(n, 1.0);
    return n;
  }

  function deficitAn(st, y) {
    var d = tintaAn(y), i;
    for (i = 0; i < st.fiscal.length; i++) if (st.fiscal[i].de <= y) d += st.fiscal[i].pp;
    d += ((st.natCheltuit[y] || 0) - 2 * BAZA_NATIONAL) / pibAn(y) * 100;
    d += st.soc[y] || 0;
    if (st.rating === 0) d += 0.3;   // dobânzi mai mari după retrogradare
    return Math.round(d * 100) / 100;
  }

  function evaluareFiscala(st, rng) {
    var y = an(st.sem), d, g, prag;
    st.soc[y] = (st.soc[y] || 0) + (rng() - 0.5) * 0.4 + (st.scen ? st.scen.soc || 0 : 0);
    d = deficitAn(st, y);
    st.deficit[y] = d;
    g = pibAn(y) / pibAn(y - 1) - 1;
    st.datorie = Math.round((st.datorie / (1 + g) + d) * 10) / 10;
    prag = tintaAn(y) + 0.3;
    if (d > prag) {
      st.avertismente++; st.aniLaTinta = 0; st.ajustare = 2; st.capital -= 6;
      stire(st, 'Comisia Europeană: abatere semnificativă – deficit ' + fmt(d) + '% din PIB, față de ținta de ' + fmt(tintaAn(y)) + '%. Ministerul Finanțelor plafonează investițiile naționale la 1 mld. lei pe semestru, timp de un an.', 'rau');
    } else {
      st.aniLaTinta++;
      stire(st, 'Deficitul pe ' + y + ': ' + fmt(d) + '% din PIB (ținta: ' + fmt(tintaAn(y)) + '%). Bruxelles-ul e mulțumit.', 'bun');
    }
    if (st.rating > 0 && (st.avertismente >= 2 || st.datorie > 66)) {
      st.rating = 0; st.capital -= 8;
      stire(st, 'Agențiile de rating retrogradează România sub nivelul investițional. Dobânzile cresc cu circa 0,3% din PIB.', 'rau');
    } else if (st.rating === 1 && st.aniLaTinta >= 2) {
      st.rating = 2; st.capital += 4;
      stire(st, 'Perspectiva ratingului revine la „stabilă”, cum promitea programul.', 'bun');
    }
    limCapital(st);
  }

  function fmt(x) { return (Math.round(x * 10) / 10).toFixed(1).replace('.', ','); }

  // Un semestru de simulare. Cărțile semestrului se aplică înainte (aplicaCarte).
  function pas(st, rng) {
    if (st.sem >= st.orizont) return st;
    var y = an(st.sem), s1 = st.sem % 2 === 0, k = st.carti, sc = st.scen, i, l, inf;
    if (sc && sc.pMotiune && st.interimat === 0 && rng() < sc.pMotiune) { st.interimat = 1; stire(st, 'Criză politică: guvern interimar.', 'rau'); }
    var mult = 1 + (k.avize != null && k.avize <= st.sem ? 0.06 : 0) + (k.uip != null ? 0.05 : 0) + (k.credite != null ? 0.04 : 0) + (k.schimburi != null ? 0.12 : 0) + (k.raportare != null ? 0.03 : 0);
    mult = Math.min(mult, 1.15);   // un șantier nu se poate comprima la nesfârșit
    if (st.interimat > 0) mult *= 0.8;
    if (st.reevaluare > 0) mult *= 0.85;
    var lo = k.credite != null ? 0.72 : 0.62;
    var comun = 0.9 + 0.15 * rng();
    var iarna = s1 && rng() < 0.35;
    if (iarna) stire(st, 'Iarnă grea în Carpați: șantierele de pe secțiunea montană merg cu încetinitorul.', 'rau');

    // Contestații și instanțe
    var pSemn = sc && sc.pSemn != null ? sc.pSemn : 0.33, pReluare = sc && sc.pReluare != null ? sc.pReluare : 0.45;
    if (k.contestatii != null) { pSemn = Math.max(pSemn, 0.7); pReluare = Math.max(pReluare, 0.75); }
    l = lot(st, 'T2');
    if (l.stare === 'neatribuit' && rng() < pSemn) { l.stare = 'proiectare'; l.semnat = st.sem; stire(st, 'S-a semnat contractul pentru Târgu Frumos – Lețcani. Urmează 46 de luni de proiectare și execuție.', 'bun'); }
    l = lot(st, 'T4');
    if (l.stare === 'suspendat' && rng() < pReluare) { l.stare = 'proiectare'; l.semnat = st.sem; stire(st, 'Instanța ridică suspendarea: Iași – Vama Ungheni pornește.', 'bun'); }
    l = lot(st, '2C');
    if (l.stare === 'neactivat' && rng() < (sc && sc.pOrdin != null ? sc.pOrdin : 0.4)) { l.stare = 'proiectare'; l.semnat = st.sem; stire(st, 'CNIR emite, în sfârșit, ordinul de începere a proiectării pentru Pipirig – Leghin.', 'bun'); }

    if (st.sem === 0) stire(st, 'Podul peste Prut de la Ungheni e aproape gata. Autostrada care să ajungă la el – încă nu.', 'neutru');
    if (st.cefDe === st.sem) {
      if (rng() < (k.securitate != null ? 0.75 : 0.5)) { st.cef += 2.5; stire(st, 'Comisia aprobă cererea CEF – mobilitate militară: 2,5 mld. lei pentru A8 Est.', 'bun'); }
      else stire(st, 'Cererea CEF pentru A8 Est este respinsă: alte coridoare ale Flancului Estic au fost mai mature.', 'rau');
    }
    if (st.carti.ppp === st.sem) stire(st, 'Unitatea PPP e înființată. Primul ei raport: un PPP pentru autostrada montană nu poate fi pregătit, licitat și construit până în 2030; contractele mari vizate până în 2028 sunt Terminalul 2 Otopeni și porturile.', 'neutru');
    if (rng() < 0.12) {
      for (i = 0; i < st.loturi.length; i++) st.loturi[i].cost = Math.round(st.loturi[i].cost * 1.08 * 100) / 100;
      stire(st, 'Prețurile la bitum, oțel și ciment cresc: devizele loturilor se ajustează cu 8%.', 'rau');
    }
    if (rng() < 0.08) { st.soc[y] = (st.soc[y] || 0) + 0.3; st.capital -= 4; stire(st, 'Recesiune în zona euro: încasările scad, deficitul pe ' + y + ' urcă cu circa 0,3 pp.', 'rau'); }
    if (st.sem === 1 && rng() < 0.7) { st.fiscal.push({ de: 2028, pp: -0.1 }); stire(st, 'Neptun Deep ajunge la platou: redevențele aduc circa 0,1% din PIB pe an.', 'bun'); }
    if (rng() < 0.1) stire(st, 'Un urs a fost filmat de camerele de pe un șantier al secțiunii montane. Lucrările continuă.', 'neutru');

    // Ritmul și nevoia de bani pentru fiecare lot activ
    var plan = [];
    for (i = 0; i < st.loturi.length; i++) {
      l = st.loturi[i]; inf = LOTURI[i];
      if (l.blocat > 0) { l.blocat--; if (l.blocat === 0) stire(st, inf.nume + ': un nou constructor preia lucrările.', 'neutru'); continue; }
      if (!activ(l)) continue;
      var ev = 1;
      if (inf.munte && iarna) ev *= 0.75;
      if (inf.munte && rng() < (k.exproprieri != null ? 0.05 : 0.11) * (sc && sc.riscMunte || 1)) {
        var plus = 0.5 + rng() * 0.5; l.left += plus;
        stire(st, inf.nume + ': ' + (rng() < 0.5 ? 'alunecare de teren pe traseu, proiectul se reface parțial.' : 'terenuri neexpropriate și utilități nedeviate la timp.'), 'rau');
      }
      if ((inf.id === 'T1' || inf.id === 'T3') && rng() < 0.08) { l.left += 0.5; stire(st, inf.nume + ': descărcare arheologică de urgență.', 'rau'); }
      if (l.semnat === st.sem) ev *= 0.5;   // mobilizare
      if (inf.lent && k.recuperare == null) ev *= 0.8;
      var P = mult * comun * (lo + (1.1 - lo) * rng()) * ev * (l.intarziere > 0 ? 0.85 : 1);
      var cere = l.cost * Math.min(1, P / Math.max(l.left, 0.01)) * (k.schimburi != null ? 1.12 : 1);
      plan.push({ l: l, inf: inf, P: P, cere: cere, dat: 0 });
    }

    // Finanțare: SAFE (Est) + CEF, Programul Transport (până în 2029) + BEI (Vest și munte), restul din buget
    var safeRamas = y <= ULTIMUL_AN_SAFE ? Math.max(0, SAFE_COR * st.safeA8 - st.safeFolosit) : 0, lipsa = 0, p, x;
    if (y >= st.mffDe) st.mff += st.mffSem;   // fondurile europene 2028–2034 (Planul național și regional de parteneriat)
    plan = ordoneaza(st, plan);
    var secvential = st.prioritate && st.prioritate !== 'prorata';
    for (i = 0; i < plan.length; i++) {
      p = plan[i];
      if (p.inf.sursa === 'SAFE') {
        x = Math.min(p.cere, safeRamas); safeRamas -= x; st.safeFolosit += x; p.dat += x;
        x = Math.min(p.cere - p.dat, st.cef); st.cef -= x; p.dat += x;
      } else {
        if (y <= ULTIMUL_AN_PT) { x = Math.min(p.cere, st.pt); st.pt -= x; p.dat += x; }
        if (st.beiDe <= st.sem) { x = Math.min(p.cere - p.dat, st.bei); st.bei -= x; p.dat += x; }
      }
      x = Math.min(p.cere - p.dat, st.mff); st.mff -= x; p.dat += x;
      lipsa += p.cere - p.dat;
    }
    var nat = nationalEfectiv(st) + (k.plata30 != null ? 1.5 : 0), natFolosit = Math.min(nat, lipsa), natRamas = natFolosit;
    var arierate = 0, kmNou = 0;
    for (i = 0; i < plan.length; i++) {
      p = plan[i];
      if (secvential) { x = Math.min(p.cere - p.dat, natRamas); natRamas -= x; p.dat += x; }
      else if (lipsa > 0) p.dat += (p.cere - p.dat) * natFolosit / lipsa;
      var f = p.cere > 0 ? Math.min(1, p.dat / p.cere) : 1;
      l = p.l;
      l.left -= p.P * (0.3 + 0.7 * f);
      l.cost = Math.max(0, l.cost - p.dat);
      st.cheltuitA8 += p.dat;
      if (f < 0.95) {
        l.intarziere++; arierate++;
        if (l.intarziere >= 3 && rng() < (k.raportare != null ? 0.12 : 0.2)) { l.blocat = 2; l.intarziere = 0; stire(st, p.inf.nume + ': constructorul, neplătit de luni de zile, intră în insolvență. Lotul stă un an.', 'rau'); }
      } else l.intarziere = Math.max(0, l.intarziere - 1);
      if (p.inf.etapa && !l.etapa && l.left > 0.001 && 1 - l.left / p.inf.ramas >= p.inf.etapa.la) {
        l.etapa = st.sem; kmNou += p.inf.etapa.km;
        stire(st, p.inf.nume + ': se deschid primii ' + fmt(p.inf.etapa.km) + ' km (' + p.inf.etapa.nume + ').', 'bun');
      }
      if (l.left <= 0.001) {
        l.left = 0; l.deschis = st.sem; l.stare = 'deschis'; l.cost = 0; kmNou += p.inf.km - (l.etapa != null ? p.inf.etapa.km : 0);
        stire(st, 'Se deschide circulația pe ' + p.inf.nume + ' (' + fmt(p.inf.km) + ' km).', 'bun');
      } else if (l.stare === 'proiectare' && l.left <= p.inf.ramas * 0.75) l.stare = 'executie';
    }
    if (arierate) { st.capital -= Math.min(4, arierate); stire(st, 'Arierate pe ' + arierate + (arierate === 1 ? ' lot' : ' loturi') + ': constructorii încetinesc lucrul.', 'rau'); }
    st.capital += kmNou / 10;
    st.natCheltuit[y] = (st.natCheltuit[y] || 0) + natFolosit;

    if (st.interimat > 0) st.interimat--;
    if (st.reevaluare > 0) st.reevaluare--;
    if (st.ajustare > 0) st.ajustare--;
    if (!s1) evaluareFiscala(st, rng);

    // Alegerile parlamentare (dec. 2028, 2032, 2036): în joc decide capitalul politic, în scenarii o probabilitate
    if (ALEGERI.indexOf(st.sem) >= 0) {
      var schimbare = sc ? rng() < sc.pAlegeri * (k.securitate != null ? 0.5 : 1) : st.capital < (k.securitate != null ? 30 : 40);
      if (schimbare) {
        st.national = Math.max(1.0, st.national * 0.7); st.reevaluare = 2; st.capital = 50;
        delete st.carti.plata30; delete st.carti.schimburi;
        stire(st, 'Alegeri parlamentare: coaliția pierde. Noul guvern „reevaluează” marile proiecte, renunță la plata în 30 de zile și la bonusurile de accelerare și taie bugetul național pentru A8.', 'rau');
      } else { st.capital += 5; stire(st, 'Alegeri parlamentare: coaliția rămâne la guvernare. Proiectele merg mai departe.', 'bun'); }
    }
    limCapital(st);
    if (!sc && st.capital < 15 && st.interimat === 0 && st.sem < st.orizont - 1) {
      st.interimat = 1; st.capital = 40;
      stire(st, 'Moțiune de cenzură adoptată. Un semestru de guvern interimar: fără decizii noi, șantierele încetinesc.', 'rau');
    }
    st.sem++;
    if (st.sem >= st.orizont) st.terminat = true;
    return st;
  }

  function rezultat(st) {
    var km = 0, deschise = 0;
    st.loturi.forEach(function (l, i) {
      if (l.deschis != null) { km += LOTURI[i].km; deschise++; } else if (l.etapa != null) km += LOTURI[i].etapa.km;
    });
    function gata(ids) { return ids.every(function (id) { return lot(st, id).deschis != null; }); }
    return {
      km: Math.round(km * 10) / 10, deschise: deschise, complet: deschise === LOTURI.length,
      est: gata(EST), iasiUngheni: gata(['T4']), tgNeamtIasi: gata(['T1', 'T2', 'T3']),
      deficit2030: st.deficit[2030], subTrei: st.deficit[2030] != null && st.deficit[2030] < 3, rating: st.rating, datorie: st.datorie
    };
  }

  function clona(st) { return JSON.parse(JSON.stringify(st)); }

  /* Monte Carlo: rulează restul mandatului de n ori, fără decizii noi. */
  function estimeaza(st, n, seed) {
    n = n || 400;
    var acc = { complet: 0, est: 0, iasiUngheni: 0, tgNeamtIasi: 0, subTrei: 0, km: 0, kmLista: [], lot: {} };
    LOTURI.forEach(function (l) { acc.lot[l.id] = 0; });
    for (var i = 0; i < n; i++) {
      var s = clona(st);
      s.stiri = [];
      s.seed = ((seed == null ? 12345 : seed) + i * 7919) >>> 0;
      var rng = rngStare(s);
      while (s.sem < s.orizont) { pas(s, rng); s.stiri.length = 0; }
      var r = rezultat(s);
      if (r.complet) acc.complet++;
      if (r.est) acc.est++;
      if (r.iasiUngheni) acc.iasiUngheni++;
      if (r.tgNeamtIasi) acc.tgNeamtIasi++;
      if (r.subTrei) acc.subTrei++;
      acc.km += r.km; acc.kmLista.push(r.km);
      s.loturi.forEach(function (l) { if (l.deschis != null) acc.lot[l.id]++; });
    }
    acc.kmLista.sort(function (a, b) { return a - b; });
    var out = {
      n: n, complet: acc.complet / n, est: acc.est / n, iasiUngheni: acc.iasiUngheni / n, tgNeamtIasi: acc.tgNeamtIasi / n,
      subTrei: acc.subTrei / n, kmMediu: acc.km / n,
      kmP10: acc.kmLista[Math.floor(n * 0.1)], kmP90: acc.kmLista[Math.min(n - 1, Math.floor(n * 0.9))], lot: {}
    };
    LOTURI.forEach(function (l) { out.lot[l.id] = acc.lot[l.id] / n; });
    return out;
  }

  function stareStrategie(cheie, seed) {
    var s = stareInitiala(seed), str = STRATEGII[cheie], rng = rngStare(s);
    str.carti.forEach(function (id) { aplicaCarte(s, id, rng); });
    s.national = str.national;
    return s;
  }

  /* Profilul de la final: două axe, ca pe o busolă politică. */
  function profil(st) {
    var fiscal = 0, reforma = 0;
    st.fiscal.forEach(function (f) { fiscal += f.pp; });
    fiscal += (st.national - BAZA_NATIONAL) * 0.1;
    ['avize', 'uip', 'credite', 'plata30', 'exproprieri', 'contestatii'].forEach(function (id) { if (st.carti[id] != null) reforma++; });
    var r = rezultat(st), titlu;
    if (r.complet) titlu = 'Miracolul de la Pipirig';
    else if (r.est) titlu = 'Ministrul care a legat Iașiul de Prut';
    else if (r.km >= 150) titlu = 'Constructorul răbdător';
    else if (r.km >= 80) titlu = 'Administratorul de șantiere';
    else if (fiscal < -0.3) titlu = 'Contabilul-șef';
    else titlu = 'Tăietorul de panglici amânate';
    return { titlu: titlu, x: Math.max(-1, Math.min(1, -fiscal / 0.8)), y: Math.max(-1, Math.min(1, (reforma - 2) / 3)) };
  }


  /* ---------- Calendarul: când ar fi gata A8? Scenarii politice × bugetare × procedurale, până în 2040 ---------- */
  var DIMENSIUNI = {
    politic: {
      stabil: { nume: 'Consens', descriere: 'A8 rămâne prioritate indiferent cine câștigă (ca strategia 2021–2030 a ministerului); schimbarea de guvern rar oprește proiectele.', pAlegeri: 0.15, pMotiune: 0 },
      alternanta: { nume: 'Alternanță', descriere: 'La fiecare alegeri (2028, 2032, 2036), 50% șanse ca noul guvern să „reevalueze” proiectele și să taie bugetul.', pAlegeri: 0.5, pMotiune: 0.02 },
      securitate: { nume: 'A8 de securitate națională', descriere: 'Propunerea MVA: A8 devine obiectiv de securitate națională (CSAT, Strategia de apărare), cu dublu rol economic și militar; alternanța rămâne, dar un guvern nou îl taie mult mai rar.', pAlegeri: 0.25, pMotiune: 0.02, carti: ['securitate'] },
      criza: { nume: 'Instabilitate', descriere: 'Coaliții fragile, moțiuni, interimate; aproape orice alegeri aduc reevaluări.', pAlegeri: 0.85, pMotiune: 0.08 }
    },
    buget: {
      generos: { nume: 'Bani din belșug', descriere: '3 mld. lei/semestru din buget, 85% din SAFE pe A8, fonduri UE 2028–2034 consistente de la 2029 (2,5 mld. lei/semestru), cerere CEF.',
        national: 3, safeA8: 0.85, mffDe: 2029, mffSem: 2.5, soc: 0, carti: ['bei', 'cef', 'plata30'] },
      program: { nume: 'Ca în program', descriere: '1,5 mld. lei/semestru din buget, 70% din SAFE pe A8, fonduri UE 2028–2034 de la 2030 (1,5 mld. lei/semestru), plata în 30 de zile.',
        national: 1.5, safeA8: 0.7, mffDe: 2030, mffSem: 1.5, soc: 0, carti: ['plata30'] },
      mva: { nume: 'Necesarul MVA', descriere: 'Moldova Vrea Autostradă: ≈800–900 mil. euro pe an pentru A8 (≈2,2 mld. lei pe semestru din toate sursele), resurse bugetare multianuale pentru Ungheni – Iași – Târgu Neamț și A8 prioritară în CFM 2028–2034.',
        national: 2.5, safeA8: 0.75, mffDe: 2029, mffSem: 2.5, soc: 0, carti: ['plata30', 'cfm'] },
      austeritate: { nume: 'Austeritate', descriere: '1 mld. lei/semestru, Pașcani – Siret ia mai mult din SAFE (60% A8), fonduri UE noi abia din 2031, derapaje de deficit și plafonări.',
        national: 1, safeA8: 0.6, mffDe: 2031, mffSem: 1, soc: 0.3, carti: [] }
    },
    prioritate: PRIORITATI,
    procedural: {
      rapid: { nume: 'Program + contestații rapide', descriere: 'Tot ce e în program, plus contestații judecate accelerat la CNSC și în instanță (măsură care nu e în program).',
        pSemn: 0.7, pReluare: 0.75, riscMunte: 0.8, carti: ['avize', 'uip', 'credite', 'exproprieri', 'contestatii'] },
      program: { nume: 'Ca în program', descriere: 'Platforma de avize cu aprobare tacită, exproprieri înainte de lucrări, UIP întărite, credite multianuale (Transporturi M2, M13); contestațiile rămân în ritmul de azi.',
        pSemn: 0.4, pReluare: 0.5, riscMunte: 0.8, carti: ['avize', 'uip', 'credite', 'exproprieri'] },
      mva: { nume: 'Agenda MVA', descriere: 'Ce cere bilanțul MVA din aug. 2026: ordin pentru 2C, autorizație pentru 1B, PAC pentru 2A, program de recuperare pe Leghin – Moțca, raportare publică lunară; plus avizele, exproprierile și UIP din program. Contestațiile, în ritmul de azi.',
        pSemn: 0.45, pReluare: 0.55, pOrdin: 0.9, riscMunte: 0.8, carti: ['avize', 'uip', 'credite', 'exproprieri', 'deblocari', 'recuperare', 'raportare'] },
      actual: { nume: 'Ca acum', descriere: 'Contestațiile se judecă în ritmul obișnuit, avizele și exproprierile merg cum au mers până acum.',
        pSemn: 0.33, pReluare: 0.45, riscMunte: 1, carti: ['credite'] },
      blocaje: { nume: 'Blocaje', descriere: 'Contestații în lanț, suspendări în instanță, refaceri de proiect pe munte.',
        pSemn: 0.15, pReluare: 0.25, pOrdin: 0.2, riscMunte: 1.6, carti: [] }
    }
  };
  var SCENARII = [
    { id: 'optimist', nume: 'Promisiunile', politic: 'stabil', buget: 'generos', procedural: 'rapid' },
    { id: 'program', nume: 'Programul, cu stabilitate', politic: 'stabil', buget: 'program', procedural: 'program' },
    { id: 'realist', nume: 'Realist', politic: 'alternanta', buget: 'program', procedural: 'actual' },
    { id: 'austeritate', nume: 'Austeritate', politic: 'alternanta', buget: 'austeritate', procedural: 'actual' },
    { id: 'pesimist', nume: 'Pesimist', politic: 'criza', buget: 'austeritate', procedural: 'blocaje' },
    { id: 'mva', nume: 'Agenda Moldova Vrea Autostradă', politic: 'securitate', buget: 'mva', procedural: 'mva', prioritate: 'mva' }
  ];
  // Ce au spus actorii publici (repere pentru grafic)
  var REPERE = [
    { de: 2031, la: 2031, scurt: 'Program: 2030', cine: 'Programul de guvernare 2026–2028 și legea A8', text: 'Coridoarele principale TEN-T „se închid până în 2030”; legea A8 fixează 2030 pentru Târgu Mureș – Târgu Neamț.',
      url: '' },
    { de: 2031, la: 2034, scurt: 'MVA: 2031–2033', cine: 'Adrian Covăsnianu, Moldova Vrea Autostradă', text: 'Aug. 2025: implementare integrală în 2032–2033 („2025, un moment-cheie”). Ian. 2026: 2031–2032, dacă 2026 devine an de accelerare (proiectare riguroasă, resurse, studii geotehnice, antreprenori proactivi, beneficiar atent, societate civilă vigilentă). Aug. 2026: „anul contractelor” trebuie urmat de „anul șantierelor”.',
      url: 'https://economedia.ro/expert-in-infrastructura-autostrada-a8-nu-poate-fi-gata-integral-pana-in-2030-in-actualul-stadiu-tehnic-si-administrativ-care-este-termenul-realist.html' },
    { de: 2033.8, la: 2034.8, scurt: 'Pro Infrastructură: 7–8 ani', cine: 'Asociația Pro Infrastructură (oct. 2026)', text: 'Nu dă un termen fix și nu vede A8 gata în următorii 7–8 ani; pe Moldova lipsesc peste 1 mld. euro (≈5,5 mld. euro de lucrări, 4,2 mld. din SAFE).',
      url: 'https://business24.ro/infrastructura-rutiera/deficit-cincisprezece-miliarde-euro-proiecte-drumuri-1671231' },
    { de: 2040.5, la: 2040.5, scurt: 'Împreună pentru A8: ~2040', cine: 'Asociația Împreună pentru A8, Iași (2024)', text: 'Termenul din 2030 e „irealist”; autostrada ar fi gata în jurul lui 2040.',
      url: 'https://www.bzi.ro/ionel-apostol-presedinte-impreuna-pentru-a8-din-iasi-autostrada-se-va-finaliza-in-2040-despre-clasa-politica-din-moldova-am-numai-cuvinte-de-ocara-5053776' }
  ];

  var TINTE_CAL = {
    complet: { nume: 'A8 completă', ids: LOTURI.map(function (l) { return l.id; }) },
    est: { nume: 'Târgu Neamț – Iași – Ungheni', ids: EST },
    iasiUngheni: { nume: 'Iași – Ungheni (Prut)', ids: ['T4'] },
    munte: { nume: 'Secțiunea montană', ids: ['1B', '1C', '1D', '2A', '2B', '2C'] }
  };

  function stareCalendar(politic, buget, procedural, seed, prioritate) {
    var P = DIMENSIUNI.politic[politic], B = DIMENSIUNI.buget[buget], R = DIMENSIUNI.procedural[procedural];
    var s = stareInitiala(seed), rng = rngStare(s);
    s.orizont = ORIZONT_MAX;
    s.prioritate = prioritate || 'prorata';
    s.scen = { pAlegeri: P.pAlegeri, pMotiune: P.pMotiune, pSemn: R.pSemn, pReluare: R.pReluare, pOrdin: R.pOrdin, riscMunte: R.riscMunte, soc: B.soc };
    B.carti.concat(R.carti, P.carti || []).forEach(function (id) { aplicaCarte(s, id, rng); });
    s.national = B.national; s.safeA8 = B.safeA8; s.mffDe = B.mffDe; s.mffSem = B.mffSem;
    s.capital = 55;
    return s;
  }

  // Semestrul (0 = S1 2027) în care se termină ultimul lot dintr-o listă; null dacă nu până în 2040
  function gataLa(st, ids) {
    var max = -1;
    for (var i = 0; i < ids.length; i++) { var l = lot(st, ids[i]); if (l.deschis == null) return null; max = Math.max(max, l.deschis); }
    return max;
  }
  // Anul zecimal la finalul semestrului (S2 2030 → 2031,0)
  function anZecimal(sem) { return 2027 + (sem + 1) / 2; }

  function calendar(politic, buget, procedural, n, seed, prioritate) {
    n = n || 500;
    var rez = {};
    Object.keys(TINTE_CAL).forEach(function (k) { rez[k] = []; });
    for (var i = 0; i < n; i++) {
      var s = stareCalendar(politic, buget, procedural, ((seed == null ? 99 : seed) + i * 104729) >>> 0, prioritate), rng = rngStare(s);
      while (s.sem < s.orizont) { pas(s, rng); s.stiri.length = 0; }
      Object.keys(TINTE_CAL).forEach(function (k) { rez[k].push(gataLa(s, TINTE_CAL[k].ids)); });
    }
    var out = { n: n };
    Object.keys(rez).forEach(function (k) {
      var v = rez[k].map(function (x) { return x == null ? Infinity : anZecimal(x); }).sort(function (a, b) { return a - b; });
      function q(p) { return v[Math.min(n - 1, Math.floor(p * n))]; }
      function pana(an) { var c = 0; for (var j = 0; j < n; j++) if (v[j] <= an + 1e-9) c++; return c / n; }
      out[k] = { p10: q(0.1), p50: q(0.5), p90: q(0.9), pana2030: pana(2031), pana2032: pana(2033), pana2035: pana(2036), pana2040: pana(2041) };
    });
    return out;
  }

  // 2031,0 → „S2 2030”; Infinity → „după 2040”
  function dataGata(x) {
    if (!isFinite(x)) return 'după 2040';
    var sem = Math.round((x - 2027) * 2) - 1;
    return eticheta(sem);
  }

  return {
    EUR_LEI: EUR_LEI, SEMESTRE: SEMESTRE, PIB: PIB, TINTA: TINTA, BAZA_NATIONAL: BAZA_NATIONAL, SAFE_COR: SAFE_COR, PT_A8: PT_A8,
    NODURI: NODURI, LOTURI: LOTURI, KM_TOTAL: KM_TOTAL, EST: EST, CARTI: CARTI, CARTE: CARTE, STRATEGII: STRATEGII,
    an: an, rngStare: rngStare, stareInitiala: stareInitiala, cartiDisponibile: cartiDisponibile, mana: mana, aplicaCarte: aplicaCarte,
    nationalEfectiv: nationalEfectiv, deficitAn: deficitAn, pas: pas, rezultat: rezultat, clona: clona, estimeaza: estimeaza,
    stareStrategie: stareStrategie, profil: profil, lot: lot, info: info, fmt: fmt,
    ORIZONT_MAX: ORIZONT_MAX, DIMENSIUNI: DIMENSIUNI, PRIORITATI: PRIORITATI, SCENARII: SCENARII, REPERE: REPERE, TINTE_CAL: TINTE_CAL,
    stareCalendar: stareCalendar, calendar: calendar, dataGata: dataGata, anZecimal: anZecimal, eticheta: eticheta, pibAn: pibAn, tintaAn: tintaAn
  };
});
