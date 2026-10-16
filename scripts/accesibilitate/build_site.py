"""Turn the artifact page (prop/page.html) into a static sub-app for mobilitate-iasi.netlify.app/accesibilitate/.
CSP of the site: script-src 'self' (no inline JS), style-src 'self' 'unsafe-inline', default-src 'self' (no Google Fonts).
"""
import re, os, shutil, json

SRC = "/home/claude/prop/page.html"
OUT = "/home/claude/gis/public/accesibilitate"
os.makedirs(OUT + "/data", exist_ok=True)
s = open(SRC).read()

css = re.search(r"<style>(.*?)</style>", s, re.S).group(1)
css = css.replace('--f-display:"Archivo",system-ui,sans-serif;--f-mono:"JetBrains Mono",ui-monospace,monospace;',
                  '--f-display:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;'
                  '--f-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;')
css = "/* Accesibilitatea la transportul public – Iași și ZMI */\n*{box-sizing:border-box}\nhtml{-webkit-text-size-adjust:100%}\nbody{margin:0}\n" + css.strip() + "\n"
css = css.replace("Archivo, system-ui, sans-serif", "system-ui, sans-serif")

body = s.split("</style>", 1)[1]
html_part, js = body.split("<script>", 1)
js = js.rsplit("</script>", 1)[0]
assert "const DET=__DET__;" in js and "const GEN=__GEN__;" in js
js = js.replace("const DET=__DET__;\nconst GEN=__GEN__;\n", "")
js = js.replace("'600 11px Archivo, system-ui, sans-serif'", "'600 11px system-ui, sans-serif'")
js = js.replace("+'Archivo, system-ui, sans-serif'", "+'system-ui, sans-serif'")
js = js.replace("JetBrains Mono, monospace", "ui-monospace, monospace")
app = ("/* Accesibilitatea la transportul public – Iași și ZMI.\n"
       "   Date: data/detaliu.json (caroiaj 100 m, Madina) și data/general.json (cartiere și UAT-uri). */\n"
       "(async()=>{\n'use strict';\n"
       "const load=async n=>{const r=await fetch('data/'+n,{cache:'no-cache'});if(!r.ok)throw new Error(n+': '+r.status);return r.json();};\n"
       "let DET,GEN;\ntry{[DET,GEN]=await Promise.all([load('detaliu.json'),load('general.json')]);}\n"
       "catch(e){const el=document.getElementById('loading');if(el)el.textContent='Datele nu s-au putut încărca. Reîncărcați pagina.';return;}\n"
       "document.getElementById('loading')?.remove();\n" + js.strip() + "\n})();\n")
# drop the artifact-only head bits from the html part
html_part = html_part.strip()
html_part = html_part.replace('<div class="wrap">\n<header>', '<div class="wrap">\n<p class="crumb"><a href="/">mobilitate-iasi</a> · accesibilitate</p>\n<header>', 1)
html_part = html_part.replace("</header>", "</header>\n<p class=\"note\" id=\"loading\" role=\"status\">Se încarcă datele (circa 1,5 MB)…</p>", 1)

page = f"""<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Accesibilitatea la transportul public – Iași și ZMI</title>
  <meta name="description" content="Distanța pe jos până la stații pentru fiecare locuitor din Zona Metropolitană Iași și clasificarea cartierelor și comunelor, în situația existentă și în cea propusă prin Masterplanul Metropolitan de Transport. Madina (MIT City Form Lab), Covăsnianu (2025), Legea 155/2023.">
  <meta property="og:title" content="Accesibilitatea la transportul public – Iași și ZMI">
  <meta property="og:description" content="Cine ajunge pe jos la o stație? Situația existentă și cea propusă prin MPM Iași, pe caroiaj de 100 m și pe cartiere și UAT-uri.">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">
  <script src="app.js" defer></script>
</head>
<body>
{html_part}
</body>
</html>
"""
css += ".crumb{margin:0;font-size:13px;color:var(--muted)}.crumb a{color:var(--muted)}\n"
open(OUT + "/index.html", "w").write(page)
open(OUT + "/style.css", "w").write(css)
open(OUT + "/app.js", "w").write(app)
shutil.copy("/home/claude/prop/det.json", OUT + "/data/detaliu.json")
shutil.copy("/home/claude/prop/gen.json", OUT + "/data/general.json")
for f in os.listdir(OUT): print(f)
print({f: os.path.getsize(OUT + "/data/" + f) // 1000 for f in os.listdir(OUT + "/data")})
assert "<script>" not in page and "fonts.googleapis" not in page + css
