# Regiokaart VGH

Versie van de regiokaart voor **VGH**, volledig los van de originele klant:
eigen adviseurs, eigen postcodes, eigen logins en een eigen Firebase-database.

## VGH-data bijwerken vanuit de spreadsheet

De bron is `scripts/vgh/vgh-postcodes.tsv` -- de kolommen Postcode, Plaats,
Prio, Verantwoordelijke en Alternatief bij verlof uit de VGH-spreadsheet
(in die volgorde; extra kolommen erachter worden genegeerd). Plak de
bijgewerkte rijen erin en draai:
```
node scripts/build-vgh-data.mjs
```
Dat herbouwt `src/data/vgh/` (adviseurs + postcodes, prio/alternatief/
opmerking per postcode, plaatsnamen) en `public/data/postcodes-vgh.geojson`
(enkel de postcodes uit de spreadsheet). Nummers achter namen ("Inge Steurs
257") worden weggelaten; tekst tussen haakjes ("(vanaf 200k €)") wordt de
opmerking bij die postcode.

## Inloggen en live delen via Firebase

Inloggen gebeurt met een code, en Firebase controleert die: er zijn twee
gedeelde Firebase-accounts, `viewer@vgh.local` (bekijken) en
`admin@vgh.local` (bewerken), en het wachtwoord van elk account **is** de
code. De app bevat zelf geen codes. Alle aanpassingen gaan naar de Firebase
Realtime Database en verschijnen binnen een seconde bij iedereen.

De database-regels (`database.rules.json`): lezen kan enkel wie ingelogd
is, schrijven enkel het beheerder-account.

### Eenmalig opzetten (~10 minuten)

1. [console.firebase.google.com](https://console.firebase.google.com) ->
   **Create a project** (bv. "vgh-regiokaart"), Google Analytics mag uit.
2. **Build -> Realtime Database -> Create Database** -> locatie
   **europe-west1 (Belgium)** -> **Start in locked mode**.
3. Tab **Rules** -> vervang alles door de inhoud van `database.rules.json`
   -> **Publish**.
4. **Build -> Authentication -> Get started -> Email/Password** -> aanzetten
   (enkel de eerste schakelaar) -> **Save**.
5. Tab **Users -> Add user**, twee keer:
   - `viewer@vgh.local` met als wachtwoord de **bekijkcode**
   - `admin@vgh.local` met als wachtwoord de **beheerderscode**

   (minstens 6 tekens; de adressen hoeven niet te bestaan)
6. Tandwiel -> **Project settings -> Your apps -> `</>` (Web)** -> naam
   bv. "vgh-web" -> **Register app**. Neem uit het codeblokje `apiKey`,
   `authDomain`, `databaseURL` en `projectId` over in `.env`
   (`VITE_FIREBASE_*`, zie `.env.example`). Staat `databaseURL` er niet
   bij, kopieer dan de URL bovenaan de Realtime Database-pagina.
7. **Vercel** -> project -> Settings -> Environment Variables -> dezelfde vier
   `VITE_FIREBASE_*`-waarden toevoegen -> **Redeploy**.

Een code wijzigen: Authentication -> Users -> `⋮` bij het account ->
**Reset password** werkt niet (nep-adres); verwijder het account en maak het
opnieuw aan met de nieuwe code.

---

*Hieronder: oorspronkelijke documentatie van de regiokaart (algemeen).*


React + Leaflet kaart. Klik op een naam links en de gemeenten die die adviseur
doet lichten op als doorzichtige laag met omtreklijn over een echte kaart
(OpenStreetMap). De thuisbasis van elke adviseur staat als stipje op de kaart.

## Bereik: Vlaanderen, Brussel én Nederland (Limburg NL + Noord-Brabant NL), geen Wallonië

- De kaart toont gemeenten in Vlaanderen, Brussel, en het Nederlandse deel
  waar jullie actief zijn (postcodezones 50, 55, 56, 57, 59, 60, 61, 62, 63,
  64 — Roderik, Robert, Roland, Steven, Wim, Wilfried en Bjorn).
- Wallonië is bewust uitgefilterd — jullie werken daar niet, en Waalse en
  Nederlandse postcodes overlappen toevallig in cijfers (bv. "5700" bestaat
  zowel als Waalse als Nederlandse postcode), wat verwarring gaf.
- De Nederlandse gemeentegrenzen en postcode-koppeling gebruiken een andere
  brondataset dan België (zie hieronder) en zijn samengevoegd tot dezelfde
  kaart. Nederlandse gemeenten krijgen een `NL-`-voorvoegsel in hun interne
  code, zodat die nooit kan botsen met een Belgische gemeentecode.

## Postcodegrenzen: nu écht per postcode, niet per gemeente

Dankzij de bestanden die je bezorgde (AlignMix, gebaseerd op officiële
Geo.be- en CBS.NL-data) tekent de kaart nu de **echte grens van elke
postcode apart**, in plaats van één vorm per gemeente. Het probleem waarbij
Antwerpen (2000, 2100, 2600, ...) of Brugge (8000, 8380, ...) allemaal
dezelfde vlek deelden, is daarmee volledig opgelost — elke postcode licht nu
apart op, ook binnen grote fusiegemeenten.

Bronbestanden: `scripts/be-postcodes-raw.geojson` en
`scripts/nl-postcodes-raw.geojson` (de ruwe AlignMix-bestanden),
samengevoegd en verkleind (10% vereenvoudigd met mapshaper, van 6,6MB naar
onder de 1MB) door `scripts/build-postcode-polygons.mjs` naar
`public/data/postcodes.geojson`. Dat laatste bestand is wat de kaart
effectief inlaadt.

Om alles opnieuw op te bouwen vanaf nul (vanuit de projectroot):
```
node scripts/build-postcode-polygons.mjs      # BE+NL postcodegrenzen samenvoegen
node scripts/build-advisor-postcodes.mjs      # postcodelijst per adviseur
```
Let op: de twee ruwe AlignMix-bronbestanden zelf (~22MB samen) zitten niet in
dit project — te groot om mee te sturen. Wil je `build-postcode-polygons.mjs`
opnieuw draaien (bv. voor een update van de brondata), download dan opnieuw
"Belgium 4-Digit Postcode Boundary in GeoJSON format" en "Netherland
4-Digit Postcode Boundaries in GeoJSON format" via
alignmix.com/geographic-data/, en zet ze als `scripts/be-postcodes-raw.geojson`
en `scripts/nl-postcodes-raw.geojson`. Nodig heb je dit normaal niet — het
verwerkte resultaat (`public/data/postcodes.geojson`) zit al klaar in het
project.

De koppeling van postcode naar gemeente komt uit een publieke, gratis
dataset — die is over het algemeen betrouwbaar maar niet foutloos. Twee
concrete fouten zijn met de hand rechtgezet in `scripts/build-data-v2.mjs`
(zoek naar `FIXES`): 2840 Reet (viel verkeerdelijk onder Willebroek) en 3840
Borgloon (viel verkeerdelijk samen met Nijlen). Kom je nog een gemeente
tegen die niet klopt, voeg die dan toe aan diezelfde `FIXES`-lijst met de
juiste NIS-code (op te zoeken via `public/data/municipalities.geojson` of
statbel.fgov.be) en draai, vanuit de hoofdmap van het project:
```
node scripts/build-data-v2.mjs
node scripts/build-advisor-postcodes.mjs
```
Het eerste script herbouwt de gemeentegrenzen en de postcode-koppeling, het
tweede herbouwt de postcodelijst per adviseur op basis van
`scripts/advisor-prefixes.json` (de zone-indeling per adviseur — pas die
aan voor structurele wijzigingen, niet `src/data/advisor-postcodes.json`
zelf, want dat bestand wordt overschreven bij elke run).

## Nieuw: postcodes op de kaart, zoekbalk, toegangscode

- **Postcodes op de kaart** — bij inzoomen (vanaf een bepaald niveau) tonen de
  gemeentes hun echte 4-cijferige postcode(s) in plaats van de 2-cijferige
  zone. Uitgezoomd blijf je de overzichtelijke zonenummers zien.
- **Zoekbalk** — linksboven op de kaart staan twee velden. Typ een postcode
  in, klik "Zoek" (of Enter), en het gebied licht op en de kaart zoomt ernaar
  toe. Vul beide velden in om twee postcodes tegelijk te vergelijken, elk in
  een eigen kleur. "Wissen" maakt de zoekopdracht leeg.
- **Toegangscode** — de kaart is nu achter een simpel wachtwoordscherm
  geplaatst. Zonder de juiste code kan niemand de kaart bekijken.

### Toegangscode instellen

**Lokaal:** kopieer `.env.example` naar `.env` en vul je eigen code in:
```
VITE_ACCESS_CODE=jouw-eigen-code
```
`.env` staat in `.gitignore` — die wordt dus nooit meegepusht naar GitHub.

**Op Vercel:** ga naar je project → Settings → Environment Variables → voeg
toe: naam `VITE_ACCESS_CODE`, waarde = jouw code → Save. Daarna moet je een
keer opnieuw deployen (Deployments → ⋯ → Redeploy) zodat de nieuwe waarde
meegebakken wordt in de build.

**Belangrijk om te weten:** dit is een lichte toegangsdrempel, geen echte
beveiliging. Het is een gewone website zonder server — de code wordt
gecontroleerd in de browser zelf, en zit dus (verborgen, maar niet
onvindbaar) in de gebouwde bestanden. Voor het weghouden van toevallige
bezoekers of het delen binnen het team is dit prima; voor echt gevoelige data
zou je beter Vercel's ingebouwde wachtwoordbeveiliging gebruiken (Project →
Settings → Deployment Protection, vereist een betaald Vercel-plan) of een
echte login met een backend.

De code wordt onthouden per browsersessie (sessionStorage) — sluit je het
tabblad, dan moet de code opnieuw ingevoerd worden.

Klik op een naam links → er verschijnt een tekstvak met zijn/haar postcodes,
komma-gescheiden. Pas aan en klik "Opslaan". De regio op de kaart en de
omlijning volgen meteen exact die postcodes. Aanpassingen worden bewaard in
de browser (localStorage) — ze blijven staan na herladen, ook na een nieuwe
deploy, zolang je dezelfde browser gebruikt. Een oranje bolletje naast een
naam betekent: deze is lokaal aangepast t.o.v. de brondata.

Let op: dit bewaart alleen lokaal in jouw browser, niet in het project zelf.
Wil je een aanpassing definitief/permanent maken voor iedereen die de site
bezoekt, kopieer de nieuwe lijst dan naar `src/data/advisor-postcodes.json`
(zie hieronder) en commit + push die wijziging.

## Gedeeld opslaan: iedereen ziet elkaars aanpassingen

Standaard bewaart de "Opslaan"-knop enkel lokaal in de browser van de
persoon die aanpast (niemand anders ziet dat). Om dit te delen met je hele
team — wie ook maar aanpast en opslaat, iedereen ziet het automatisch,
zonder GitHub of herdeployen — gebruikt de app Firebase Realtime Database
(gratis, van Google, geen creditcard nodig).

Zolang je dit niet instelt, blijft de app gewoon werken zoals voorheen
(lokaal per browser) — de linkerbalk toont "○ Enkel lokaal" zolang dit niet
is opgezet, en "● Live gedeeld met iedereen" zodra het wél werkt.

### Firebase-project aanmaken (eenmalig, ~5 minuten)

1. Ga naar [console.firebase.google.com](https://console.firebase.google.com)
   en log in met een Google-account (je bestaande Gmail volstaat)
2. **Add project** → geef een naam (bv. "regioapp") → je mag Google
   Analytics uitzetten, niet nodig → **Create project**
3. Eenmaal aangemaakt: klik in het linkermenu op **Build** → **Realtime
   Database** → **Create Database** → kies een locatie (Europe/Belgium indien
   beschikbaar) → start in **test mode** (dat zet de deuren even open zodat
   het meteen werkt; hieronder staat hoe je dat achteraf verstrengt)
4. Ga naar het tandwiel-icoon boven (⚙️) → **Project settings** → scroll naar
   **Your apps** → klik het `</>`-icoon ("Web") → geef een naam (bv.
   "regioapp-web") → **Register app**
5. Je krijgt een codeblokje te zien met `apiKey`, `authDomain`,
   `databaseURL`, `projectId`, enz. Die vier waarden heb je nodig.

### Waarden invullen

**Lokaal:** in je `.env`-bestand (naast `VITE_ACCESS_CODE`):
```
VITE_FIREBASE_API_KEY=          (de apiKey uit stap 5)
VITE_FIREBASE_AUTH_DOMAIN=      (de authDomain uit stap 5)
VITE_FIREBASE_DATABASE_URL=     (de databaseURL uit stap 5)
VITE_FIREBASE_PROJECT_ID=       (de projectId uit stap 5)
```

**Op Vercel:** Settings → Environment Variables → voeg alle vier bovenstaande
namen en waarden toe → Save → daarna **Redeploy**.

### Beveiliging van de database (belangrijk)

"Test mode" (stap 3) laat gedurende 30 dagen iedereen met de juiste URL
lezen én schrijven — daarna sluit het automatisch af, en niemand kan nog
opslaan. Om dit blijvend maar toch redelijk veilig te houden: ga in de
Firebase Console naar **Realtime Database** → tab **Rules**, en zet:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
→ **Publish**. Dit betekent: eender wie de technische link naar je database
kent kan lezen/schrijven — voor postcode-toewijzingen (geen gevoelige data)
is dat een aanvaardbaar risico, vergelijkbaar met de toegangscode van de
site zelf. Wil je het steviger afsluiten (bv. enkel wie de toegangscode van
de site kent kan ook effectief opslaan), laat het weten, dat kan met wat
extra werk via Firebase Authentication.

## Data aanpassen in de broncode

Alles zit in `src/data/`:

- `advisor-postcodes.json` — de brontabel: per adviseur een lijst van volledige
  4-cijferige postcodes, bv. `"Jimmy": ["3510", "3511", ...]`. Dit is wat
  standaard geladen wordt (voordat iemand iets bewerkt via de site zelf).
- `advisors-home.json` — postcode + plaats van de thuisbasis per adviseur
  (voor het stipje op de kaart).
- `postcode-nis.json` — technische koppeltabel postcode → gemeentecode
  (NIS), gegenereerd uit publieke data. Hier hoef je normaal niets aan te
  wijzigen, tenzij er een postcode ontbreekt (voeg toe als `"9999": "12345"`
  met de NIS-code van de juiste gemeente).

De postcode-zone-nummers die je op de kaart ziet (20, 21, 35, ...) worden
automatisch berekend uit `postcode-nis.json`, daar hoef je niets voor aan te
passen.

## Lokaal draaien

```
npm install
npm run dev
```

## Op GitHub zetten

```
git init
git add .
git commit -m "Regiokaart adviseurs"
git branch -M main
git remote add origin <jouw-nieuwe-repo-url>
git push -u origin main
```

Maak eerst een lege repo aan op github.com (New repository, geen README
aanvinken), en gebruik die URL bij `git remote add origin`.

## Deployen op Vercel

1. Ga naar vercel.com, "Add New Project"
2. Kies de GitHub-repo die je net gepusht hebt
3. Vercel herkent het automatisch als Vite-project (build command
   `npm run build`, output directory `dist`) — gewoon "Deploy" klikken
4. Klaar. Elke keer dat je naar `main` pusht, herbouwt Vercel automatisch.

## Bron van de kaartgegevens

Postcodegrenzen (België en Nederland): AlignMix (alignmix.com/geographic-data/),
gebaseerd op officiële Geo.be- (België) en CBS.NL-data (Nederland).
Belgische postcode-coördinaten (voor thuisbasis-stipjes): `jief/zipcode-belgium`.
Nederlandse postcode-coördinaten: `bobdenotter/4pp`. Alles gratis, geen
API-key nodig.
