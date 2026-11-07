# Generatorul atlasului deplasărilor

Reface „Atlasul deplasărilor ZMI Iași” (pagina publicată ca artifact) din exportul brut al studiului.

```bash
node scripts/atlas/build.js --export <trips_raw_AAAAMMZZ.jsonl> --out <dosar> --prev data/atlas/stats_<ultima ediție>.json
```

- **Exportul brut conține date personale: nu se pune în repo.** Generatorul îl citește doar la rulare.
- Ieșire: `atlas.html` (doar agregate pe zone și comune) și `stats.json` (agregatele principale).
  `stats.json` se păstrează pentru ediția următoare (`--prev`), care completează tabelul „Cum a evoluat acoperirea”.
- Calculele folosesc aceleași reguli ca analiza din `server/analysis.js` (VALID și de verificat, fără EXCLUDE).

## Fișiere
- `build.js`: secțiunile 1–9 și 11–13, antetul, cuprinsul și subsolul.
- `compute.js`, `stats.js`: agregatele pe unități și relații.
- `lib.js`: formatare (română: „45 de minute”, „62,5 minute”) și desenul hărților și graficelor.
- `geom.json`: contururile zonelor și comunelor în coordonatele panourilor, pozițiile etichetelor și rețeaua de transport public (harta 9).
- `static.json`: date fixe (dotări OSM pe zone, acoperirea cu tramvai și stații, populația 2021).
- `static/`: secțiunile care nu depind de export (benzi dedicate, jurnalul GPS, TomTom 15–19), CSS-ul și scriptul pentru tooltip.

Verificare: rulat pe exportul din 4 noiembrie 2026, generatorul reproduce tabelele hărților 1–4, 7, 9, fluxurile și graficele 5, 6, 11 publicate atunci.
- Agregatele fiecărei ediții se salvează în `data/atlas/stats_AAAAMMZZ.json` (fără date personale).
