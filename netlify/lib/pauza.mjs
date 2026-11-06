// Proiectul „transport public în timp real” (colectarea GPS, rapoartele, /live/, /transport/sanatate/, /transport/raport/)
// este PE PAUZĂ din 21.10.2026: nu e încă de promovat public, iar creditele Netlify merg spre studiul de mobilitate.
// Pe pauză: funcțiile programate (gps-colectare, raport-zilnic) nu mai au program, iar funcțiile live (vehicule,
// istoric) răspund 503 fără să contacteze Tranzy. Paginile rămân accesibile doar prin link direct, neindexate.
// Repornire: PAUZA = false aici + programele din gps-colectare.mjs și raport-zilnic.mjs (vezi comentariile de acolo).
export const PAUZA = true;

export function pauseResponse() {
  return new Response(JSON.stringify({ eroare: 'Datele în timp real sunt oprite temporar (proiect pe pauză).' }), {
    status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
