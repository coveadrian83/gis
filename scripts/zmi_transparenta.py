"""Bugete, execuție și investiții 2020–2026 pentru comunele din prima centură a Iașului.

Sursa: datele Forexebug publicate de transparenta.eu (API GraphQL public).
Utilizare: python3 scripts/zmi_transparenta.py  → analize/zmi/zmi_ani.csv, zmi_investitii_domenii.csv
"""
import json,subprocess,sys
def q(query,variables=None):
    r=subprocess.run(['curl','-sS','-m','180','-X','POST','https://api.transparenta.eu/graphql','-H','content-type: application/json','-d',json.dumps({"query":query,"variables":variables or {}})],capture_output=True,text=True)
    return json.loads(r.stdout)
COM={'Aroneanu':'4540038','Bârnova':'4540690','Ciurea':'4540658','Holboca':'4540518','Miroslava':'4540461','Popricani':'4540380','Rediu':'4540348','Tomești':'4540240','Țuțora':'4540224','Valea Lupului':'16384625'}
Q='''query($cui: ID!, $p: ReportPeriodInput!){ entity(cui:$cui){ uat{population}
 inc: totalIncome(period:$p, reportType: PRINCIPAL_AGGREGATED) exp: totalExpenses(period:$p, reportType: PRINCIPAL_AGGREGATED)
 ch: executionLineItems(filter:{account_category: ch, report_period:$p, report_type: PRINCIPAL_AGGREGATED}, limit:15000){ nodes { funding_source_id expense_type functionalClassification{functional_code functional_name} economicClassification{economic_code economic_name} ytd_amount } }
 vn: executionLineItems(filter:{account_category: vn, report_period:$p, report_type: PRINCIPAL_AGGREGATED}, limit:15000){ nodes { funding_source_id functionalClassification{functional_code functional_name} economicClassification{economic_code economic_name} ytd_amount } }
}}'''
QC='''query($f: CommitmentsFilterInput!){ commitmentsSummary(filter:$f, limit:50){ nodes { ... on CommitmentsAnnualSummary { year credite_bugetare credite_bugetare_definitive total_plati } } } }'''
out={}
for nume,cui in COM.items():
    out[nume]={'cui':cui,'ani':{}}
    for y in range(2020,2027):
        p={"type":"YEAR","selection":{"interval":{"start":str(y),"end":str(y)}}}
        d=q(Q,{"cui":cui,"p":p})
        if d.get('errors'): print(nume,y,d['errors'][:1]); continue
        out[nume]['pop']=d['data']['entity']['uat']['population']
        out[nume]['ani'][y]=d['data']['entity']
    c=q(QC,{"f":{"report_period":{"type":"YEAR","selection":{"interval":{"start":"2020","end":"2026"}}},"entity_cuis":[cui],"report_type":"PRINCIPAL_AGGREGATED"}})
    out[nume]['credite']={n['year']:n for n in c['data']['commitmentsSummary']['nodes']} if c.get('data') else {}
    print(nume, {y:(round(a['inc']/1e6,1),round(a['exp']/1e6,1)) for y,a in out[nume]['ani'].items()}, sorted(out[nume]['credite']), flush=True)
RAW=json.loads(json.dumps(out))
import csv,collections,os
d=RAW; OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","analize","zmi")
INV=('71','56','58','60','61')
EXT=('42.87','42.65','42.88','42.89','42.10','42.55','42.14','42.05','43.31','43.44','43.47','43.50','45.','48.','37.05')
def dom(f):
    if f.startswith('65'): return 'Educație'
    if f.startswith(('66','68')): return 'Social și sănătate'
    if f.startswith(('67.05.01','67.05.02')): return 'Sport și tineret'
    if f.startswith(('67.03','67.05.03','67.50')): return 'Cultură, parcuri, recreere'
    if f.startswith('84'): return 'Drumuri și transport'
    if f.startswith(('70.05','70.07','74')): return 'Apă, canalizare, gaz, salubritate'
    if f.startswith('70.03'): return 'Locuințe'
    if f.startswith('70.06'): return 'Iluminat public'
    if f.startswith('70.50'): return 'Dezvoltare comunală (nedetaliat, 70.50)'
    if f.startswith(('51','54','61')): return 'Administrație și siguranță'
    return 'Altele'
ani=[];domenii=[]
for nume,v in d.items():
    pop=v['pop']
    for y,a in sorted(v['ani'].items()):
        ch=a['ch']['nodes']; vn=a['vn']['nodes']
        inv=[n for n in ch if n['economicClassification']['economic_code'][:2] in INV]
        it=sum(n['ytd_amount'] for n in inv)
        icred=sum(n['ytd_amount'] for n in inv if n['funding_source_id']==3)
        ext=sum(n['ytd_amount'] for n in vn if n['functionalClassification']['functional_code'].startswith(EXT))
        loans=sum(n['ytd_amount'] for n in vn if n['functionalClassification']['functional_code'].startswith('41.02'))
        exc=sum(n['ytd_amount'] for n in vn if n['functionalClassification']['functional_code'].startswith('40.14'))
        own=sum(n['ytd_amount'] for n in vn if n['functionalClassification']['functional_code'][:2] in ('03','05','07','12','15','16','18','30','31','33','34','35','36','37','39') and not n['functionalClassification']['functional_code'].startswith(('37.03','37.04','37.05')))
        cred=v['credite'].get(y) or v['credite'].get(int(y)) or {}
        cb=cred.get('credite_bugetare') or None
        ani.append({'comuna':nume,'an':y,'populatie_2021':pop,
          'buget_aprobat_final_lei':round(cb) if cb else '','venituri_lei':round(a['inc']),'cheltuieli_lei':round(a['exp']),
          'executie_pct':round(a['exp']/cb*100,1) if cb else '',
          'investitii_lei':round(it),'investitii_din_credite_lei':round(icred),
          'finantare_externa_investitii_lei':round(ext),'imprumuturi_trase_lei':round(loans),
          'venituri_proprii_lei':round(own),
          'investitii_resurse_locale_lei':round(max(it-ext-loans,0)),
          'cheltuieli_per_locuitor':round(a['exp']/pop),'investitii_per_locuitor':round(it/pop),
          'buget_aprobat_per_locuitor':round(cb/pop) if cb else '','partial':'ian.–iul.' if y=='2026' else ''})
        c=collections.Counter()
        for n in inv: c[dom(n['functionalClassification']['functional_code'])]+=n['ytd_amount']
        for k,val in c.items(): domenii.append({'comuna':nume,'an':y,'domeniu':k,'investitii_lei':round(val)})
for name,rows in [('zmi_ani.csv',ani),('zmi_investitii_domenii.csv',domenii)]:
    with open(OUT+'/'+name,'w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
print(len(ani),len(domenii))
