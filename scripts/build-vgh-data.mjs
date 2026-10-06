import fs from "fs";

// Bouwt alle VGH-data op uit scripts/vgh/vgh-postcodes.tsv (kolommen, in
// deze volgorde: Postcode, Plaats, Prio, Verantwoordelijke, Alternatief bij
// verlof -- extra kolommen erachter worden genegeerd). Draai vanuit de
// projectroot: node scripts/build-vgh-data.mjs
//
// Let op: dit overschrijft de bestanden in src/data/vgh/ en
// public/data/postcodes-vgh.geojson.

const TSV_PATH = "./scripts/vgh/vgh-postcodes.tsv";
const OUT_DIR = "./src/data/vgh";

const allNames = JSON.parse(fs.readFileSync("./src/data/postcode-names.json", "utf8"));
const allGeo = JSON.parse(fs.readFileSync("./public/data/postcodes.geojson", "utf8"));

// "Inge Steurs 257 (vanaf 200k €)" -> { name: "Inge Steurs", remark: "vanaf 200k €" }
function parsePerson(raw) {
  const text = (raw || "").trim();
  if (!text) return { name: "", remark: "" };
  const remarkMatch = text.match(/\(([^)]*)\)/);
  const remark = remarkMatch ? remarkMatch[1].trim() : "";
  const name = text.replace(/\([^)]*\)/, "").replace(/\s+\d+\s*$/, "").replace(/\s+/g, " ").trim();
  return { name, remark };
}

const lines = fs.readFileSync(TSV_PATH, "utf8").split(/\r?\n/).slice(1);
const advisorPostcodes = {};
const postcodeInfo = {};
const postcodeNames = {};
const warnings = [];

lines.forEach((line) => {
  const cols = line.split("\t");
  const pc = (cols[0] || "").trim();
  if (!/^\d{4}$/.test(pc)) return;

  // plaatsnaam uit "2100 - Deurne", maar enkel als de postcode in het label
  // overeenkomt met die van de rij -- anders de standaardnaam gebruiken
  const label = (cols[1] || "").trim();
  const labelMatch = label.match(/^(\d{4})\s*-\s*(.+)$/);
  if (labelMatch && labelMatch[1] === pc) {
    postcodeNames[pc] = labelMatch[2].trim();
  } else {
    if (label) warnings.push(`${pc}: label "${label}" hoort bij een andere postcode, standaardnaam gebruikt`);
    if (allNames[pc]) postcodeNames[pc] = allNames[pc];
  }

  const prio = (cols[2] || "").trim();
  const resp = parsePerson(cols[3]);
  const alt = parsePerson(cols[4]);

  if (resp.name) {
    if (!advisorPostcodes[resp.name]) advisorPostcodes[resp.name] = [];
    advisorPostcodes[resp.name].push(pc);
  }
  // iemand die enkel als alternatief voorkomt is toch een adviseur
  if (alt.name && !advisorPostcodes[alt.name]) advisorPostcodes[alt.name] = [];

  const info = {};
  if (prio) info.prio = prio;
  if (alt.name) info.alt = alt.name;
  const remark = [resp.remark, alt.remark].filter(Boolean).join(" · ");
  if (remark) info.remark = remark;
  if (Object.keys(info).length) postcodeInfo[pc] = info;
});

Object.values(advisorPostcodes).forEach((list) => list.sort());

const wanted = new Set(Object.keys(postcodeNames));
const geo = {
  type: "FeatureCollection",
  features: allGeo.features.filter((f) => f && f.geometry && wanted.has(f.properties.postcode)),
};
const missing = [...wanted].filter((pc) => !geo.features.some((f) => f.properties.postcode === pc));
if (missing.length) warnings.push(`geen kaartvorm gevonden voor: ${missing.join(", ")}`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(`${OUT_DIR}/advisor-postcodes.json`, JSON.stringify(advisorPostcodes, null, 2) + "\n");
fs.writeFileSync(`${OUT_DIR}/postcode-info.json`, JSON.stringify(postcodeInfo, null, 2) + "\n");
fs.writeFileSync(`${OUT_DIR}/postcode-names.json`, JSON.stringify(postcodeNames, null, 2) + "\n");
fs.writeFileSync("./public/data/postcodes-vgh.geojson", JSON.stringify(geo));

console.log(`${wanted.size} postcodes, ${Object.keys(advisorPostcodes).length} adviseurs:`);
Object.entries(advisorPostcodes).forEach(([n, l]) => console.log(`  ${n}: ${l.length} postcodes`));
warnings.forEach((w) => console.warn(`! ${w}`));
