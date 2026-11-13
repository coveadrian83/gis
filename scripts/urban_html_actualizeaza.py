#!/usr/bin/env python3
"""Actualizează harta de sine stătătoare „Orașe după Legea 351” (un singur fișier HTML cu datele în `const DATA`,
construită separat) cu indicatorii calculați aici (public/data/urban/urban_351.json, scripts/urban_351.py):
paturi și medici la 1.000 de locuitori (6, 7), dotările culturale și sportive (9), străzile modernizate, cu rețea de apă
și cu canalizare (11–13), spațiile verzi (16), populația după domiciliu și stadiul PUG.

Potrivirea se face pe codul SIRUTA. Datele proprii ale hărții (dotarea locuințelor RPL 2011 / estimare 2021, liceele din
Rețeaua școlară, hotelurile SITUR, limitele ANCPI, zonele din anexa II pct. 6) rămân neschimbate. Clasele (c, c2) se
recalculează pe toți indicatorii cu date, cu aceleași reguli ca în hartă.

  python scripts/urban_html_actualizeaza.py <harta.html> <harta_actualizata.html>
"""
import json, os, re, sys
from datetime import date

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# pragurile noi (municipiu, oraș) – anexa II, tabelul
TH_NOI = {'pa': [10, 7], 'me': [2.3, 1.8], 'sm': [60, 50], 'ra': [70, 60], 'rc': [60, 50], 'sv': [15, 10]}
COD_ANI = ['SAN102C', 'SAN104B', 'ART101B', 'SCL107C', 'GOS103A', 'GOS104A', 'GOS105A', 'GOS106B', 'GOS110A']
MAP = {'i6': 'pa', 'i7': 'me', 'i9': 'cu', 'i11': 'sm', 'i12': 'ra', 'i13': 'rc', 'i16': 'sv'}
TH_VECHI = {'p': [40000, 10000], 'na': [85, 75], 'a': [80, 70], 'b': [75, 55], 'h': [45, 35], 'ho': [100, 50]}


def inlocuieste(s, vechi, nou, n=1):
    if vechi not in s:
        raise SystemExit('nu găsesc în HTML: %r' % vechi[:90])
    return s.replace(vechi, nou, n)


def clasa(p, an21):
    """Aceleași reguli ca în hartă, pe toți indicatorii cu date."""
    TH = dict(TH_VECHI, **TH_NOI)
    def V(k):
        if an21 and k in ('a', 'b', 'h'):
            return p.get(k + '2')
        return p.get(k)
    def rateaza(i):          # i = 0 municipiu, 1 oraș
        n = 0
        for k, th in TH.items():
            v = V(k)
            if v is not None and v < th[i]:
                n += 1
        n += 0 if (p.get('pl') if i == 0 else p.get('li')) else 1
        if p.get('cu') is not None and p['cu'] < (2 if i == 0 else 1):
            n += 1
        return n
    fm, fo = rateaza(0), rateaza(1)
    if p['t'] == 'M':
        return 'M1' if fm == 0 else 'M2'
    if p['t'] == 'O':
        return 'O1' if fm == 0 else 'O2' if fo == 0 else 'O3'
    if fo == 0:
        return 'C1'
    if (p['p'] >= 10000 and fo <= 2) or (p['p'] >= 7500 and fo <= 1):
        return 'C2'
    return 'C3'


def main(src, dst):
    s = open(src, encoding='utf-8').read()
    D = json.load(open(os.path.join(ROOT, 'public', 'data', 'urban', 'urban_351.json'), encoding='utf-8'))
    U = {u['s']: u for u in D['uat']}
    ani = D.get('ani_tempo', {})

    m = re.search(r'const DATA = (\{.*?\});\n', s, re.S)
    data = json.loads(m.group(1))
    gasite, schimbari = 0, {}
    for f in data['features']:
        p = f['properties']
        u = U.get(p['s'])
        if not u:
            continue
        gasite += 1
        for i, k in MAP.items():
            v = u['v'].get(i)
            p[k] = v if v is not None else None
        if u.get('pd'):
            p['pd'] = u['pd']
        if u.get('pug'):
            p['pug'] = u['pug'].get('st')
        for ck, an21 in (('c', False), ('c2', True)):
            nou = clasa(p, an21)
            if nou != p[ck]:
                schimbari[(p[ck], nou)] = schimbari.get((p[ck], nou), 0) + 1
            p[ck] = nou
    s = s[:m.start(1)] + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + s[m.end(1):]

    # --- praguri, numărarea indicatorilor, scala „k”
    s = inlocuieste(s, "const TH = {p:[40000,10000],na:[85,75],a:[80,70],b:[75,55],h:[45,35],cn:[75,55],ho:[100,50]};",
                    "const TH = {p:[40000,10000],na:[85,75],a:[80,70],b:[75,55],h:[45,35],cn:[75,55],ho:[100,50],"
                    "pa:[10,7],me:[2.3,1.8],sm:[60,50],ra:[70,60],rc:[60,50],sv:[15,10]};")
    s = inlocuieste(s, "const okO=p=>['p','na','a','b','h','ho'].filter(k=>V(p,k)>=TH[k][1]).length+(p.li>0?1:0);\n"
                       "const okM=p=>['p','na','a','b','h','ho'].filter(k=>V(p,k)>=TH[k][0]).length+(p.pl>0?1:0);",
                    "const KK=['p','na','a','b','h','ho','pa','me','sm','ra','rc','sv'];\n"
                    "const has=(p,k)=>V(p,k)!=null;\n"
                    "const nEv=p=>KK.filter(k=>has(p,k)).length+1+(p.cu!=null?1:0);\n"
                    "const okO=p=>KK.filter(k=>has(p,k)&&V(p,k)>=TH[k][1]).length+(p.li>0?1:0)+(p.cu>=1?1:0);\n"
                    "const okM=p=>KK.filter(k=>has(p,k)&&V(p,k)>=TH[k][0]).length+(p.pl>0?1:0)+(p.cu>=2?1:0);")
    s = inlocuieste(s, "function val(p){return ind==='k'?okO(p):V(p,ind)}",
                    "function val(p){return ind==='k'?100*okO(p)/nEv(p):ind==='cu'?p.cu:V(p,ind)}")
    s = inlocuieste(s, "else if(ind==='k'){ramp={s:d3.scaleOrdinal([0,1,2,3,4,5,6,7],['#b9b4a7','#e8dcbb','#efc98f','#f2a65a','#e07b39','#c4521f','#93300c','#5a1a04']),ticks:['0','2','4','6','7']};}",
                    "else if(ind==='k'){ramp={s:d3.scaleThreshold([30,45,60,75,90,100],['#5a1a04','#93300c','#c4521f','#f2a65a','#9fd2b8','#3a9b70','#0d5b3c']),ticks:['0%','30','60','90','100%']};}\n"
                    "  else if(ind==='pa'){ramp={s:d3.scaleThreshold([0.01,3.5,7,10,20],['#d8d6cf','#f08a3c','#f7c99c','#9fd2b8','#3a9b70','#0d5b3c']),ticks:['0','3,5','7 oraș','10 mun.','20+']};}\n"
                    "  else if(ind==='me'){ramp={s:d3.scaleThreshold([0.5,1,1.8,2.3,5],['#7f2704','#f08a3c','#f7c99c','#9fd2b8','#3a9b70','#0d5b3c']),ticks:['0','1','1,8 oraș','2,3 mun.','5+']};}\n"
                    "  else if(ind==='sv'){ramp={s:d3.scaleThreshold([2,5,10,15,30],['#7f2704','#f08a3c','#f7c99c','#9fd2b8','#3a9b70','#0d5b3c']),ticks:['0','5','10 oraș','15 mun.','30+']};}\n"
                    "  else if(ind==='cu'){ramp={s:d3.scaleOrdinal([0,1,2],['#e2574c','#f7c99c','#3a9b70']),ticks:['incomplete','oraș','municipiu']};}")
    s = inlocuieste(s, "<small>${k}/7</small>", "<small>${k}/${nEv(p)}</small>")
    s = inlocuieste(s, "${okO(p)}/7 praguri de oraș · ${okM(p)}/7 de municipiu", "${okO(p)}/${nEv(p)} praguri de oraș · ${okM(p)}/${nEv(p)} de municipiu")
    s = inlocuieste(s, "const kk=p=>100*okO(p)/7;", "const kk=p=>100*okO(p)/nEv(p);")

    # --- selectorul de indicatori
    s = inlocuieste(s, '<option value="li">Licee și colegii</option>',
                    '<option value="li">Licee și colegii</option>\n'
                    '        <option value="pa">Paturi în spitale la 1.000 loc.</option>\n'
                    '        <option value="me">Medici la 1.000 loc.</option>\n'
                    '        <option value="cu">Dotări culturale și sportive</option>\n'
                    '        <option value="sm">Străzi modernizate (%)</option>\n'
                    '        <option value="ra">Străzi cu rețea de apă (%)</option>\n'
                    '        <option value="rc">Străzi cu canalizare (%)</option>\n'
                    '        <option value="sv">Spații verzi (m²/loc.)</option>')
    s = inlocuieste(s, '<option value="k">Indicatori de oraș îndepliniți (din 7)</option>',
                    '<option value="k">Indicatori de oraș îndepliniți (% din cei evaluați)</option>')

    # --- fișa UAT
    s = inlocuieste(s, "${row('5. Încălzire centrală'+hy,'h',true)}",
                    "${row('5. Încălzire centrală'+hy,'h',true)}${row('6. Paturi în spitale ‰','pa',false)}${row('7. Medici ‰','me',false)}")
    s = inlocuieste(s, "${row('10. Locuri în hoteluri','ho',false)}",
                    "<tr><td>9. Dotări culturale și sportive</td><td class=\"r\">${p.cu==null?'–':['incomplete','bibl. + sport','+ spectacole'][p.cu]}</td><td class=\"r\">${p.cu==null?'<span class=\"na\">–</span>':mk(p.cu,1)}</td><td class=\"r\">${p.cu==null?'<span class=\"na\">–</span>':mk(p.cu,2)}</td></tr>"
                    "${row('10. Locuri în hoteluri','ho',false)}${row('11. Străzi modernizate','sm',true)}${row('12. Străzi cu rețea de apă','ra',true)}${row('13. Străzi cu canalizare','rc',true)}${row('16. Spații verzi m²/loc.','sv',false)}")
    s = inlocuieste(s, "Indicatorii 6, 7, 9 și 11–17 nu sunt încă evaluați.",
                    "Indicatorii 14, 15 și 17 nu au date pe UAT; 11–13 și 16 există doar pentru municipii și orașe.${p.pd?` Populația după domiciliu (1 ian. %s): <span class=\"num\">${fmt(p.pd)}</span>.`:''}${p.pug?` PUG: ${({v:'în vigoare',a:'necesită actualizare',x:'anulat în instanță',n:'stadiu necunoscut'})[p.pug]} (registrul MDLPA).`:''}" % ani.get('POP107D', ''))

    # --- tabelul indicatorilor (surse și stare)
    rep = {
        "[6,'Paturi în spitale la 1.000 loc.','10','7','TEMPO SAN102C','n']": "[6,'Paturi în spitale la 1.000 loc.','10','7','TEMPO SAN102C (%s), internare continuă','y']" % ani.get('SAN102C'),
        "[7,'Medici la 1.000 loc.','2,3','1,8','TEMPO SAN104B','n']": "[7,'Medici la 1.000 loc.','2,3','1,8','TEMPO SAN104B (%s), toate formele de proprietate','y']" % ani.get('SAN104B'),
        "'TEMPO ART101B (doar biblioteci)','n']": "'TEMPO ART101B biblioteci publice + SCL107C/SCL110B săli și terenuri de sport (%s) + ART103B instituții de spectacole (%s)','p']" % (ani.get('ART101B'), ani.get('ART103B')),
        "'TEMPO GOS105A, doar orașe','n']": "'TEMPO GOS105A / GOS104A (%s), doar municipii și orașe','y']" % ani.get('GOS105A'),
        "'TEMPO GOS106B (lungime rețea)','n']": "'TEMPO GOS106B / GOS104A (%s): lungimea rețelei / lungimea străzilor','p']" % ani.get('GOS106B'),
        "'TEMPO GOS110A (lungime rețea)','n']": "'TEMPO GOS110A / GOS104A (%s): lungimea rețelei / lungimea străzilor','p']" % ani.get('GOS110A'),
        "'TEMPO GOS111A (debit stații)','n']": "'TEMPO GOS111A – seria pe localități se oprește în 2004','x']",
        "'TEMPO GOS103A, doar orașe','n']": "'TEMPO GOS103A (%s), doar municipii și orașe','y']" % ani.get('GOS103A'),
    }
    for a, b in rep.items():
        s = inlocuieste(s, a, b)

    # --- textele
    s = inlocuieste(s, "Filtrul folosește cei <b>7 indicatori</b> care se pot măsura uniform pentru toată țara: populația, ocuparea neagricolă, dotarea locuințelor (apă, baie, încălzire), liceul și locurile în hoteluri.",
                    "Filtrul folosește <b>14 indicatori</b> din 17: populația, ocuparea neagricolă, dotarea locuințelor (apă, baie, încălzire), paturile și medicii, liceul, dotările culturale și sportive, locurile în hoteluri, iar pentru municipii și orașe străzile modernizate, rețelele de apă și canalizare și spațiile verzi.")
    s = inlocuieste(s, "Hoteluri: SITUR, structuri clasificate (oct. 2026)<br>",
                    "Hoteluri: SITUR, structuri clasificate (oct. 2026)<br>Sănătate, cultură, străzi, rețele, spații verzi: INS TEMPO %s–%s<br>"
                    % (min(ani[c] for c in COD_ANI if ani.get(c)), max(ani[c] for c in COD_ANI if ani.get(c))))
    s = inlocuieste(s, "din cele 7 evaluate (0–100)", "din cele evaluate pentru el (0–100; 14 pentru municipii și orașe, 10 pentru comune)")
    s = inlocuieste(s, "Harta aplică 7 din cei 17 indicatori, cei care se pot măsura identic pentru toate UAT-urile. Pentru restul, datele pe UAT sunt în TEMPO Online, indisponibil în momentul calculului, sau nu există la nivel național.",
                    "Harta aplică 14 din cei 17 indicatori. Indicatorii 11–13 și 16 se măsoară doar pentru municipii și orașe (INS nu publică lungimea străzilor și spațiile verzi pentru comune), iar 14 (epurarea), 15 (hidranții) și 17 (depozitul de deșeuri) nu au serie națională pe UAT. Un indicator fără date nu se socotește nici îndeplinit, nici ratat.")
    s = inlocuieste(s, "trece toate cele 7 praguri de oraș.", "trece toate pragurile de oraș evaluate.")
    s = inlocuieste(s, "trece toate cele 7 praguri de municipiu.", "trece toate pragurile de municipiu evaluate.")
    s = inlocuieste(s, "        <li>Populația este cea rezidentă la 1 decembrie 2021.",
                    "        <li>Indicatorii 6–7, 9, 11–13 și 16: INS TEMPO Online, ultimul an disponibil. Un UAT care lipsește dintr-o matrice pe localități (care listează doar localitățile cu unități sau rețea) are valoarea 0. La 12–13, INS dă lungimea rețelei, nu a străzilor cu rețea: raportul e plafonat la 100%. La 9, săli de sport înseamnă săli de gimnastică și terenuri ale școlilor; seria instituțiilor de spectacole se oprește în 2017.</li>\n"
                    "        <li>Populația este cea rezidentă la 1 decembrie 2021.")
    s = inlocuieste(s, "Calcul: 25 octombrie 2026", "Calcul: 25 octombrie 2026 · actualizare TEMPO: %s" % date.today().strftime('%d.%m.%Y'))
    open(dst, 'w', encoding='utf-8').write(s)
    print('UAT potrivite:', gasite, '·', 'schimbări de clasă:', dict(sorted(schimbari.items(), key=lambda x: -x[1])))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
