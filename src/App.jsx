import { useEffect, useMemo, useState, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Marker, Tooltip, ZoomControl, Pane, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import Login from "./Login.jsx";
import { firebaseEnabled, subscribeToOverrides, saveOverridesShared, subscribeToAuth, firebaseSignOut, roleForUser } from "./firebase.js";
import avatarMale from "./assets/avatar-male.png";
import avatarFemale from "./assets/avatar-female.png";

// gegenereerd door scripts/build-vgh-data.mjs uit de VGH-spreadsheet
import advisorPostcodesVgh from "./data/vgh/advisor-postcodes.json";
import postcodeNamesVgh from "./data/vgh/postcode-names.json";
import postcodeInfoVgh from "./data/vgh/postcode-info.json";

const AUTH_KEY = "map-auth-ok";
const ROLE_KEY = "map-auth-role";

const COLORS = [
  "#D85A30", "#378ADD", "#639922", "#7F77DD", "#D4537E",
  "#BA7517", "#1D9E75", "#888780", "#e24b4a", "#0c447c",
];

const SEARCH_COLORS = ["#EF9F27", "#3B8BD4", "#639922", "#D4537E", "#8B5CF6", "#0c447c"];
const MAX_SEARCH_FIELDS = SEARCH_COLORS.length;

const PRIO_OPTIONS = ["1", "2", "3"];

// welk soort panden een adviseur doet -- meerdere mogelijk
const PROPERTY_TYPE_DEFS = [
  { id: "woning", emoji: "🏠", label: "Woning" },
  { id: "gemengd", emoji: "🏘️", label: "Gemengde woning" },
  { id: "handelspand", emoji: "🏪", label: "Handelspand" },
];

const LANGUAGE_DEFS = ["FR", "NL", "ENG"];

const GENDER_AVATARS = { m: avatarMale, v: avatarFemale };

function formatEuro(value) {
  const n = Number(value);
  return Number.isFinite(n) && value !== "" ? `€ ${n.toLocaleString("nl-BE")}` : value;
}

function ProfileAvatar({ gender }) {
  const src = GENDER_AVATARS[gender];
  if (!src) return <span>👤</span>;
  return <img src={src} alt="" className="profile-photo-img" />;
}

function emptyProfile() {
  return {
    gender: "",
    tier: "",
    propertyTypes: [],
    pandenVanaf: "",
    meesteInteresse: "",
    regio: "",
    languages: [],
    languagesExtra: "",
    thuisbatterijEnkel: "",
    travelRadiusMin: "",
    extraInfo: "",
  };
}

// VGH heeft een eigen Firebase-project (eigen database), dus de Firebase-
// paden botsen nooit met andere klanten. De localStorage-sleutels krijgen
// wel een "-vgh"-achtervoegsel: lokaal (localhost) delen alle versies van de
// app dezelfde browseropslag.
const DEPARTMENTS = [
  {
    id: "vgh",
    label: "VGH",
    postcodesUrl: "/data/postcodes-vgh.geojson",
    advisorPostcodesBase: advisorPostcodesVgh,
    advisorsHome: {},
    postcodeNames: postcodeNamesVgh,
    postcodeInfoBase: postcodeInfoVgh,
    // momenteel niet actief (spreadsheet + doorgegeven); een beheerder kan dit
    // per adviseur aan/uit zetten in het profiel (dat wint dan altijd)
    inactiveAdvisorsBase: ["Chantal Groeneveld", "Inge Steurs"],
    postcodeInfoStorageKey: "postcode-info-overrides-vgh",
    postcodeInfoFirebasePath: "postcodeInfoOverrides",
    notesSeed: [],
    notesStorageKey: "advisor-notes-vgh",
    notesFirebasePath: "advisorNotes",
    storageKey: "advisor-postcode-overrides-vgh",
    firebasePath: "advisorPostcodeOverrides",
    center: [51.2, 4.65],
    zoom: 10,
    tagDefs: [],
    advisorTagsBase: {},
    tagsStorageKey: "advisor-tag-overrides-vgh",
    tagsFirebasePath: "advisorTagOverrides",
    deletedStorageKey: "advisor-deleted-overrides-vgh",
    deletedFirebasePath: "advisorDeletedOverrides",
    addedStorageKey: "advisor-added-overrides-vgh",
    addedFirebasePath: "advisorAddedOverrides",
    homeStorageKey: "advisor-home-overrides-vgh",
    homeFirebasePath: "advisorHomeOverrides",
    profilesStorageKey: "advisor-profiles-vgh",
    profilesFirebasePath: "advisorProfiles",
  },
];

function colorForIndex(i) {
  return COLORS[i % COLORS.length];
}

function loadOverrides(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOverridesLocal(key, overrides) {
  localStorage.setItem(key, JSON.stringify(overrides));
}

// bundled notes.json entries only have a free-text "text" field (e.g. "Maarten 16/09");
// this pulls out just the name so it isn't duplicated once we render "name + date" ourselves
function migrateSeedNotes(seed) {
  return (seed || []).map((n, i) => ({
    id: `seed-${i}-${n.postcode}`,
    postcode: n.postcode,
    name: (n.text || "").replace(/\s+\d{1,2}\/\d{1,2}.*$/, "").trim() || n.text || "Notitie",
    expires: n.expires,
  }));
}

function shortDate(iso) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// same name + same postcode -> one sticky-note line with dates joined by "en"
// (e.g. "Roderik 06/10 en 07/10"), instead of a separate line per note
function groupNotesByName(list) {
  const map = new Map();
  list.forEach((n) => {
    if (!map.has(n.name)) map.set(n.name, new Set());
    map.get(n.name).add(n.expires);
  });
  return Array.from(map.entries()).map(([name, dates]) => ({
    name,
    dates: Array.from(dates).sort(),
  }));
}

function centroidOfRing(ring) {
  let sx = 0, sy = 0;
  ring.forEach(([x, y]) => { sx += x; sy += y; });
  return [sy / ring.length, sx / ring.length];
}

function MapEvents({ onZoom, onBounds }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
    moveend: () => onBounds(map.getBounds()),
  });
  useEffect(() => {
    onBounds(map.getBounds());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function App() {
  // local-only mode (no Firebase): logged-in state lives in sessionStorage
  const [localAuthed, setLocalAuthed] = useState(() => sessionStorage.getItem(AUTH_KEY) === "1");
  const [localRole, setLocalRole] = useState(() => sessionStorage.getItem(ROLE_KEY) || "viewer");
  // Firebase mode: logged-in state is whichever Firebase account is signed in.
  // undefined = Firebase is still restoring the session after a page load
  const [fbUser, setFbUser] = useState(firebaseEnabled ? undefined : null);
  const [activeDept, setActiveDept] = useState(DEPARTMENTS[0].id);

  useEffect(() => {
    return subscribeToAuth((user) => setFbUser(user || null));
  }, []);

  // wait for the restored session before rendering the map: the database
  // only allows reads for a signed-in account, and a listener that gets
  // refused before sign-in is done would never recover
  if (firebaseEnabled && fbUser === undefined) {
    return <div className="login-screen"><p className="hint">Laden...</p></div>;
  }

  const authed = firebaseEnabled ? Boolean(fbUser) : localAuthed;
  // with Firebase the role comes from which account is signed in, and the
  // database rules enforce it -- nothing in the browser can fake it
  const role = firebaseEnabled ? roleForUser(fbUser) : localRole;

  if (!authed) {
    return (
      <Login
        onSuccess={(r) => {
          sessionStorage.setItem(AUTH_KEY, "1");
          sessionStorage.setItem(ROLE_KEY, r);
          setLocalRole(r);
          setLocalAuthed(true);
        }}
      />
    );
  }

  const dept = DEPARTMENTS.find((d) => d.id === activeDept);
  const isAdmin = role === "admin";

  function handleLogout() {
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    firebaseSignOut();
    setLocalRole("viewer");
    setLocalAuthed(false);
  }

  return (
    <div className="app-shell">
      <div className="dept-tabs">
        {DEPARTMENTS.map((d) => (
          <button
            key={d.id}
            className={d.id === activeDept ? "dept-tab active" : "dept-tab"}
            onClick={() => setActiveDept(d.id)}
          >
            {d.label}
          </button>
        ))}
        <button className="logout-btn" onClick={handleLogout}>Uitloggen</button>
      </div>
      <DeptMap key={dept.id} config={dept} isAdmin={isAdmin} />
    </div>
  );
}

function DeptMap({ config, isAdmin }) {
  const {
    postcodesUrl, advisorPostcodesBase, advisorsHome, postcodeNames,
    storageKey, firebasePath, center, zoom: initialZoom,
    notesSeed, notesStorageKey, notesFirebasePath,
    tagDefs, advisorTagsBase, tagsStorageKey, tagsFirebasePath,
    deletedStorageKey, deletedFirebasePath,
    addedStorageKey, addedFirebasePath,
    homeStorageKey, homeFirebasePath,
    profilesStorageKey, profilesFirebasePath,
    postcodeInfoBase, postcodeInfoStorageKey, postcodeInfoFirebasePath,
    inactiveAdvisorsBase = [],
  } = config;

  const [postcodesGeo, setPostcodesGeo] = useState(null);
  const [selected, setSelected] = useState(null);
  const [overrides, setOverrides] = useState(() => loadOverrides(storageKey));
  const [tagOverrides, setTagOverrides] = useState(() => loadOverrides(tagsStorageKey));
  const [deletedAdvisors, setDeletedAdvisors] = useState(() => loadOverrides(deletedStorageKey));
  const [addedAdvisors, setAddedAdvisors] = useState(() => loadOverrides(addedStorageKey));
  const [homeOverrides, setHomeOverrides] = useState(() => loadOverrides(homeStorageKey));
  const [profiles, setProfiles] = useState(() => loadOverrides(profilesStorageKey));
  const [postcodeInfoOverrides, setPostcodeInfoOverrides] = useState(() => loadOverrides(postcodeInfoStorageKey));
  const [notesList, setNotesList] = useState(() => {
    try {
      const raw = localStorage.getItem(notesStorageKey);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore malformed local data, fall back to seed below
    }
    return migrateSeedNotes(notesSeed);
  });
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [zoom, setZoom] = useState(initialZoom);
  const [mapBounds, setMapBounds] = useState(null);
  const [searchFields, setSearchFields] = useState(["", ""]);
  const [activeSearch, setActiveSearch] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [panelAdvisor, setPanelAdvisor] = useState(null);
  const [panelTags, setPanelTags] = useState([]);
  const [panelSaved, setPanelSaved] = useState(false);
  const [panelNameDraft, setPanelNameDraft] = useState("");
  const [panelNameError, setPanelNameError] = useState("");
  const [panelHomeDraft, setPanelHomeDraft] = useState("");
  const [profileDraft, setProfileDraft] = useState(null);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [noteDraftPostcode, setNoteDraftPostcode] = useState("");
  const [noteDraftName, setNoteDraftName] = useState("");
  const [noteDraftDate, setNoteDraftDate] = useState("");
  const [noteError, setNoteError] = useState("");
  const [newAdvisorName, setNewAdvisorName] = useState("");
  const [addAdvisorError, setAddAdvisorError] = useState("");
  const [toast, setToast] = useState("");
  const mapRef = useRef(null);
  const canvasRenderer = useMemo(() => L.canvas(), []);
  const advisorLayerRef = useRef(null);
  const notesSeededRef = useRef(false);
  const toastTimeoutRef = useRef(null);
  const handlePostcodeClickRef = useRef(() => {});
  const activePopupRef = useRef(null);

  useEffect(() => {
    if (firebaseEnabled) {
      const unsubscribe = subscribeToOverrides(firebasePath, (shared) => setOverrides(shared));
      return unsubscribe;
    }
  }, [firebasePath]);

  useEffect(() => {
    if (firebaseEnabled) {
      const unsubscribe = subscribeToOverrides(tagsFirebasePath, (shared) => setTagOverrides(shared));
      return unsubscribe;
    }
  }, [tagsFirebasePath]);

  useEffect(() => {
    if (firebaseEnabled) {
      const unsubscribe = subscribeToOverrides(deletedFirebasePath, (shared) => setDeletedAdvisors(shared));
      return unsubscribe;
    }
  }, [deletedFirebasePath]);

  useEffect(() => {
    if (firebaseEnabled) {
      const unsubscribe = subscribeToOverrides(addedFirebasePath, (shared) => setAddedAdvisors(shared));
      return unsubscribe;
    }
  }, [addedFirebasePath]);

  useEffect(() => {
    if (firebaseEnabled) {
      const unsubscribe = subscribeToOverrides(homeFirebasePath, (shared) => setHomeOverrides(shared));
      return unsubscribe;
    }
  }, [homeFirebasePath]);

  useEffect(() => {
    if (firebaseEnabled) {
      const unsubscribe = subscribeToOverrides(postcodeInfoFirebasePath, (shared) => setPostcodeInfoOverrides(shared));
      return unsubscribe;
    }
  }, [postcodeInfoFirebasePath]);

  useEffect(() => {
    if (firebaseEnabled) {
      const unsubscribe = subscribeToOverrides(profilesFirebasePath, (shared) => setProfiles(shared));
      return unsubscribe;
    }
  }, [profilesFirebasePath]);

  useEffect(() => {
    if (!firebaseEnabled) return;
    const unsubscribe = subscribeToOverrides(notesFirebasePath, (shared) => {
      const arr = Array.isArray(shared) ? shared : shared && typeof shared === "object" ? Object.values(shared) : null;
      if (arr && arr.length > 0) {
        notesSeededRef.current = true;
        setNotesList(arr);
      } else if (!notesSeededRef.current) {
        // nothing shared yet -- seed Firebase once from the bundled notes.json
        notesSeededRef.current = true;
        const migrated = migrateSeedNotes(notesSeed);
        setNotesList(migrated);
        // only an admin may write; nothing to seed when there are no bundled notes
        if (isAdmin && migrated.length) saveOverridesShared(notesFirebasePath, migrated);
      } else {
        setNotesList([]);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesFirebasePath]);

  useEffect(() => {
    const onSaveError = () => showToast("Opslaan mislukt -- controleer je verbinding");
    window.addEventListener("firebase-save-error", onSaveError);
    return () => window.removeEventListener("firebase-save-error", onSaveError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!panelAdvisor) return;
    const onKeyDown = (e) => { if (e.key === "Escape") closeAdvisorPanel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelAdvisor]);

  const advisorPostcodes = useMemo(() => {
    return { ...advisorPostcodesBase, ...overrides };
  }, [advisorPostcodesBase, overrides]);

  const advisorTags = useMemo(() => {
    return { ...advisorTagsBase, ...tagOverrides };
  }, [advisorTagsBase, tagOverrides]);

  // per postcode: prio, alternatief bij verlof en opmerking (bv. "vanaf 200k €").
  // An override replaces the whole entry for that postcode; an override
  // without any fields means "cleared", which Firebase stores as `true`
  const postcodeInfo = useMemo(() => {
    const merged = { ...(postcodeInfoBase || {}) };
    Object.entries(postcodeInfoOverrides).forEach(([pc, info]) => {
      merged[pc] = info && typeof info === "object" ? info : {};
    });
    return merged;
  }, [postcodeInfoBase, postcodeInfoOverrides]);

  const advisorNames = useMemo(() => {
    // union with addedAdvisors: a brand-new advisor with zero postcodes has
    // nothing to actually store in advisorPostcodes (Firebase can't persist
    // an empty array, so that key just wouldn't survive a refresh) -- their
    // existence is tracked here instead, independent of their postcode list
    const names = new Set([...Object.keys(advisorPostcodes), ...Object.keys(addedAdvisors)]);
    // inactive advisors go to the bottom of the list
    return Array.from(names)
      .filter((n) => !deletedAdvisors[n])
      .sort((a, b) => isInactive(a) - isInactive(b) || a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advisorPostcodes, addedAdvisors, deletedAdvisors, profiles, inactiveAdvisorsBase]);

  // explicit profile setting wins; otherwise the bundled default for this client
  function isInactive(name) {
    const flag = profiles[name]?.inactive;
    return typeof flag === "boolean" ? flag : inactiveAdvisorsBase.includes(name);
  }

  function withInactiveMark(name) {
    return name && isInactive(name) ? `${name} (niet actief)` : name;
  }

  // the alternate is only shown while that person still exists as an advisor
  function altFor(pc) {
    const alt = postcodeInfo[pc]?.alt;
    return alt && advisorNames.includes(alt) ? alt : "";
  }

  useEffect(() => {
    fetch(postcodesUrl)
      .then((r) => r.json())
      .then((geo) => {
        geo.features = geo.features.filter((f) => f && f.geometry);
        setPostcodesGeo(geo);
        // the map only contains this client's postcodes, so zoom to exactly those
        if (mapRef.current && geo.features.length) {
          mapRef.current.fitBounds(L.geoJSON(geo).getBounds(), { padding: [20, 20] });
        }
      });
  }, [postcodesUrl]);

  const postcodeToCentroid = useMemo(() => {
    if (!postcodesGeo) return {};
    const sums = {};
    postcodesGeo.features.forEach((f) => {
      const pc = f.properties.postcode;
      const rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);
      rings.forEach((ring) => {
        const [lat, lng] = centroidOfRing(ring);
        if (!sums[pc]) sums[pc] = { lat: 0, lng: 0, n: 0 };
        sums[pc].lat += lat;
        sums[pc].lng += lng;
        sums[pc].n += 1;
      });
    });
    const out = {};
    Object.entries(sums).forEach(([pc, s]) => { out[pc] = [s.lat / s.n, s.lng / s.n]; });
    return out;
  }, [postcodesGeo]);

  const availablePostcodes = useMemo(() => new Set(Object.keys(postcodeToCentroid)), [postcodeToCentroid]);

  // one shared home postcode per advisor, editable from either the profile
  // or the normal edit popup -- the bundled advisorsHome.json is just the
  // starting point, homeOverrides (live/Firebase-synced) always wins
  const advisorHomePostcode = useMemo(() => {
    const merged = {};
    Object.entries(advisorsHome).forEach(([name, info]) => { merged[name] = info?.postcode; });
    Object.entries(homeOverrides).forEach(([name, pc]) => { merged[name] = pc; });
    return merged;
  }, [advisorsHome, homeOverrides]);

  const homeCoords = useMemo(() => {
    const coords = {};
    Object.entries(advisorHomePostcode).forEach(([name, pc]) => {
      if (deletedAdvisors[name]) return;
      if (pc && postcodeToCentroid[pc]) coords[name] = postcodeToCentroid[pc];
    });
    return coords;
  }, [postcodeToCentroid, advisorHomePostcode, deletedAdvisors]);

  const zoneLabels = useMemo(() => {
    const groups = {};
    Object.entries(postcodeToCentroid).forEach(([pc, c]) => {
      const zoneKey = pc.slice(0, 2);
      if (!groups[zoneKey]) groups[zoneKey] = [];
      groups[zoneKey].push(c);
    });
    return Object.entries(groups).map(([zoneKey, pts]) => {
      const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return { zone: zoneKey, lat, lng };
    });
  }, [postcodeToCentroid]);

  const postcodeLabels = useMemo(() => {
    return Object.entries(postcodeToCentroid).map(([pc, c]) => ({ pc, lat: c[0], lng: c[1] }));
  }, [postcodeToCentroid]);

  // only the postcodes near the current viewport get their own label layer --
  // rendering all ~1000+ nationwide on every zoom-in is what caused the lag
  const visiblePostcodeLabels = useMemo(() => {
    if (!mapBounds) return postcodeLabels;
    const padded = mapBounds.pad(0.25);
    return postcodeLabels.filter(({ lat, lng }) => padded.contains([lat, lng]));
  }, [postcodeLabels, mapBounds]);

  const activeNotes = useMemo(() => {
    const today = new Date();
    return (notesList || []).filter((n) => new Date(n.expires) >= today);
  }, [notesList]);

  const notesByPostcode = useMemo(() => {
    const groups = {};
    activeNotes.forEach((n) => {
      if (!groups[n.postcode]) groups[n.postcode] = [];
      groups[n.postcode].push(n);
    });
    return groups;
  }, [activeNotes]);

  const showPostcodeLabels = zoom >= 10;

  const selectedPostcodeSet = useMemo(() => {
    if (!selected) return null;
    return new Set(advisorPostcodes[selected] || []);
  }, [selected, advisorPostcodes]);

  // postcodes where the selected advisor is the "alternatief bij verlof"
  const selectedAltSet = useMemo(() => {
    if (!selected) return null;
    return new Set(Object.keys(postcodeInfo).filter((pc) => postcodeInfo[pc]?.alt === selected));
  }, [selected, postcodeInfo]);

  const colorIndex = selected ? advisorNames.indexOf(selected) : 0;
  const highlightColor = colorForIndex(colorIndex);

  const searchByPostcode = useMemo(() => {
    const m = new Map();
    activeSearch.forEach((s) => {
      if (!m.has(s.postcode)) m.set(s.postcode, s);
    });
    return m;
  }, [activeSearch]);

  // one combined style fn/layer instead of a separate advisor-highlight layer
  // and search-highlight layer stacked on top of the same 1000+ polygons
  const styleFn = (feature) => {
    const pc = feature.properties.postcode;
    const hit = searchByPostcode.get(pc);
    if (hit) {
      return { fillColor: hit.color, fillOpacity: 0.5, color: hit.color, weight: 3, dashArray: null };
    }
    const isActive = selectedPostcodeSet && selectedPostcodeSet.has(pc);
    if (isActive) {
      return { fillColor: highlightColor, fillOpacity: 0.4, color: highlightColor, weight: 1.5, dashArray: null };
    }
    if (selectedAltSet && selectedAltSet.has(pc)) {
      return { fillColor: highlightColor, fillOpacity: 0.12, color: highlightColor, weight: 2, dashArray: "6 4" };
    }
    return { fillColor: "#888", fillOpacity: 0, color: "#999", weight: 0.3, dashArray: null };
  };

  useEffect(() => {
    if (advisorLayerRef.current) advisorLayerRef.current.setStyle(styleFn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPostcodeSet, selectedAltSet, highlightColor, searchByPostcode]);

  function showToast(message) {
    setToast(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(""), 2200);
  }

  function selectAdvisor(name) {
    if (selected === name) {
      setSelected(null);
      return;
    }
    setSelected(name);
    setDraft((advisorPostcodes[name] || []).join(", "));
    setSaved(false);
  }

  function openAdvisorPanel(name) {
    if (!isAdmin) return;
    setPanelAdvisor(name);
    setPanelTags(advisorTags[name] || []);
    setPanelSaved(false);
    setPanelNameDraft(name);
    setPanelNameError("");
    setPanelHomeDraft(advisorHomePostcode[name] || "");
    setProfileDraft({ ...emptyProfile(), ...(profiles[name] || {}), inactive: isInactive(name) });
    // keep the map highlight in sync so the admin can see what they're editing
    setSelected(name);
    setDraft((advisorPostcodes[name] || []).join(", "));
    setSaved(false);
  }

  function closeAdvisorPanel() {
    setPanelAdvisor(null);
    setProfileDraft(null);
  }

  function togglePanelTag(id) {
    setPanelTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  function applyPostcodeToggle(pc, has) {
    const current = advisorPostcodes[selected] || [];
    const nextList = has
      ? current.filter((p) => p !== pc)
      : Array.from(new Set([...current, pc])).sort();
    const nextOverrides = { ...overrides, [selected]: nextList };
    setOverrides(nextOverrides);
    if (firebaseEnabled) {
      saveOverridesShared(firebasePath, nextOverrides);
    } else {
      saveOverridesLocal(storageKey, nextOverrides);
    }

    setDraft(nextList.join(", "));
    showToast(has ? "Postcode verwijderd" : "Postcode toegevoegd");
  }

  function savePostcodeInfo(pc, info) {
    const clean = {};
    if (info.prio) clean.prio = info.prio;
    if (info.alt) clean.alt = info.alt;
    if (info.remark) clean.remark = info.remark;
    // Firebase drops empty objects, so a cleared postcode is stored as `true`
    // -- otherwise the bundled spreadsheet value would silently come back
    const next = { ...postcodeInfoOverrides, [pc]: Object.keys(clean).length ? clean : true };
    setPostcodeInfoOverrides(next);
    if (firebaseEnabled) {
      saveOverridesShared(postcodeInfoFirebasePath, next);
    } else {
      saveOverridesLocal(postcodeInfoStorageKey, next);
    }
    showToast("Postcode bijgewerkt");
  }

  function popupRow(parent, labelText, valueText) {
    const row = document.createElement("div");
    row.className = "postcode-popup-row";
    const lbl = document.createElement("span");
    lbl.className = "postcode-popup-label";
    lbl.textContent = labelText;
    const val = document.createElement("span");
    val.textContent = valueText;
    row.append(lbl, val);
    parent.appendChild(row);
    return row;
  }

  function popupSelect(options, value) {
    const sel = document.createElement("select");
    options.forEach(([v, text]) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = text;
      sel.appendChild(opt);
    });
    sel.value = value;
    return sel;
  }

  // bound once via onEachFeature, so re-assigning this every render (instead of
  // relying on the closure captured at mount) keeps it seeing current state
  handlePostcodeClickRef.current = function handlePostcodeMapClick(pc, latlng) {
    if (!mapRef.current) return;
    const info = postcodeInfo[pc] || {};
    const responsible = advisorNames.filter((name) => (advisorPostcodes[name] || []).includes(pc));
    const label = postcodeNames[pc] ? `${pc} (${postcodeNames[pc]})` : pc;

    if (activePopupRef.current) {
      activePopupRef.current.close();
    }

    const container = document.createElement("div");
    container.className = "postcode-popup-content";

    const title = document.createElement("div");
    title.className = "postcode-popup-title";
    title.textContent = label;
    container.appendChild(title);

    const popup = L.popup({ closeButton: true, className: "postcode-popup" })
      .setLatLng(latlng)
      .setContent(container);

    popupRow(container, "Verantwoordelijke", responsible.join(", ") || "niemand toegewezen");

    if (!isAdmin) {
      popupRow(container, "Prio", info.prio || "-");
      popupRow(container, "Alternatief bij verlof", withInactiveMark(altFor(pc)) || "-");
      if (info.remark) popupRow(container, "Opmerking", info.remark);
    } else {
      const prioSel = popupSelect([["", "-"], ...PRIO_OPTIONS.map((p) => [p, p])], info.prio || "");
      popupRow(container, "Prio", "").lastChild.replaceWith(prioSel);

      const altSel = popupSelect([["", "-"], ...advisorNames.map((n) => [n, n])], altFor(pc));
      popupRow(container, "Alternatief bij verlof", "").lastChild.replaceWith(altSel);

      const remarkInput = document.createElement("input");
      remarkInput.type = "text";
      remarkInput.placeholder = "bv. vanaf 200k €";
      remarkInput.value = info.remark || "";
      popupRow(container, "Opmerking", "").lastChild.replaceWith(remarkInput);

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "postcode-popup-btn add";
      saveBtn.textContent = "Opslaan";
      saveBtn.addEventListener("click", () => {
        savePostcodeInfo(pc, { prio: prioSel.value, alt: altSel.value, remark: remarkInput.value.trim() });
        popup.close();
      });
      container.appendChild(saveBtn);

      if (selected) {
        const has = (advisorPostcodes[selected] || []).includes(pc);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = has ? "postcode-popup-btn remove" : "postcode-popup-btn add";
        btn.textContent = has ? `Verwijderen bij ${selected}` : `Toevoegen aan ${selected}`;
        btn.addEventListener("click", () => {
          applyPostcodeToggle(pc, has);
          popup.close();
        });
        container.appendChild(btn);
      }
    }

    activePopupRef.current = popup;
    popup.openOn(mapRef.current);
  };

  function saveAdvisorPanel() {
    if (!isAdmin || !panelAdvisor) return;
    const oldName = panelAdvisor;
    const newName = panelNameDraft.trim();
    if (!newName) {
      setPanelNameError("Naam is verplicht");
      return;
    }
    const renaming = newName !== oldName;
    if (renaming && advisorNames.includes(newName)) {
      setPanelNameError("Deze naam bestaat al");
      return;
    }
    setPanelNameError("");

    if (renaming) {
      // postcodes aren't edited here anymore (map click handles that), but
      // the current list still needs to move over to the new name
      const currentPcs = advisorPostcodes[oldName] || [];
      const nextOverrides = { ...overrides };
      delete nextOverrides[oldName];
      nextOverrides[newName] = currentPcs;
      setOverrides(nextOverrides);
      if (firebaseEnabled) {
        saveOverridesShared(firebasePath, nextOverrides);
      } else {
        saveOverridesLocal(storageKey, nextOverrides);
      }
    }

    if (tagDefs && tagDefs.length) {
      const nextTagOverrides = { ...tagOverrides };
      if (renaming) delete nextTagOverrides[oldName];
      nextTagOverrides[newName] = panelTags;
      setTagOverrides(nextTagOverrides);
      if (firebaseEnabled) {
        saveOverridesShared(tagsFirebasePath, nextTagOverrides);
      } else {
        saveOverridesLocal(tagsStorageKey, nextTagOverrides);
      }
    }

    // home postcode -- shared between both editors, so either place can
    // set it and both stay in sync
    const homePc = panelHomeDraft.trim();
    const homeValid = !homePc || (/^\d{4}$/.test(homePc) && availablePostcodes.has(homePc));
    if (homeValid) {
      const nextHome = { ...homeOverrides };
      if (renaming) delete nextHome[oldName];
      if (homePc) {
        nextHome[newName] = homePc;
      } else {
        delete nextHome[newName];
      }
      setHomeOverrides(nextHome);
      if (firebaseEnabled) {
        saveOverridesShared(homeFirebasePath, nextHome);
      } else {
        saveOverridesLocal(homeStorageKey, nextHome);
      }
    }

    if (profileDraft) {
      const nextProfiles = { ...profiles };
      if (renaming) delete nextProfiles[oldName];
      nextProfiles[newName] = profileDraft;
      setProfiles(nextProfiles);
      if (firebaseEnabled) {
        saveOverridesShared(profilesFirebasePath, nextProfiles);
      } else {
        saveOverridesLocal(profilesStorageKey, nextProfiles);
      }
    }

    if (renaming) {
      // hide the old name and make sure the new one is tracked, regardless
      // of whether oldName came from the bundled data or was added in-app --
      // and un-hide newName in case it was itself a previously-retired name
      // (e.g. renaming back to what this advisor used to be called)
      const nextDeleted = { ...deletedAdvisors, [oldName]: true };
      delete nextDeleted[newName];
      setDeletedAdvisors(nextDeleted);
      if (firebaseEnabled) {
        saveOverridesShared(deletedFirebasePath, nextDeleted);
      } else {
        saveOverridesLocal(deletedStorageKey, nextDeleted);
      }

      const nextAdded = { ...addedAdvisors, [newName]: true };
      setAddedAdvisors(nextAdded);
      if (firebaseEnabled) {
        saveOverridesShared(addedFirebasePath, nextAdded);
      } else {
        saveOverridesLocal(addedStorageKey, nextAdded);
      }

      // postcodes where this advisor is the "alternatief bij verlof" follow the rename
      const altPcs = Object.keys(postcodeInfo).filter((pc) => postcodeInfo[pc]?.alt === oldName);
      if (altPcs.length) {
        const nextInfo = { ...postcodeInfoOverrides };
        altPcs.forEach((pc) => { nextInfo[pc] = { ...postcodeInfo[pc], alt: newName }; });
        setPostcodeInfoOverrides(nextInfo);
        if (firebaseEnabled) {
          saveOverridesShared(postcodeInfoFirebasePath, nextInfo);
        } else {
          saveOverridesLocal(postcodeInfoStorageKey, nextInfo);
        }
      }

      setPanelAdvisor(newName);
      if (selected === oldName) setSelected(newName);
      if (selected === oldName) setDraft((advisorPostcodes[oldName] || []).join(", "));
    }

    setPanelSaved(true);
    setTimeout(() => setPanelSaved(false), 1500);
    showToast(renaming ? "Naam gewijzigd" : "Wijzigingen opgeslagen");
  }

  function deleteAdvisor() {
    if (!isAdmin || !panelAdvisor) return;
    const ok = window.confirm(`Weet je zeker dat je "${panelAdvisor}" wilt verwijderen?`);
    if (!ok) return;

    const nextDeleted = { ...deletedAdvisors, [panelAdvisor]: true };
    setDeletedAdvisors(nextDeleted);
    if (firebaseEnabled) {
      saveOverridesShared(deletedFirebasePath, nextDeleted);
    } else {
      saveOverridesLocal(deletedStorageKey, nextDeleted);
    }

    if (selected === panelAdvisor) {
      setSelected(null);
      setDraft("");
    }
    setPanelAdvisor(null);
    setProfileDraft(null);
    showToast("Adviseur verwijderd");
  }

  function addAdvisor(e) {
    e.preventDefault();
    if (!isAdmin) return;
    const trimmed = newAdvisorName.trim();
    if (!trimmed) {
      setAddAdvisorError("Naam is verplicht");
      return;
    }
    if (advisorNames.includes(trimmed)) {
      setAddAdvisorError("Deze naam bestaat al");
      return;
    }
    setAddAdvisorError("");

    if (deletedAdvisors[trimmed]) {
      // re-adds someone who was previously deleted instead of creating a duplicate
      const nextDeleted = { ...deletedAdvisors };
      delete nextDeleted[trimmed];
      setDeletedAdvisors(nextDeleted);
      if (firebaseEnabled) {
        saveOverridesShared(deletedFirebasePath, nextDeleted);
      } else {
        saveOverridesLocal(deletedStorageKey, nextDeleted);
      }
    } else {
      const nextAdded = { ...addedAdvisors, [trimmed]: true };
      setAddedAdvisors(nextAdded);
      if (firebaseEnabled) {
        saveOverridesShared(addedFirebasePath, nextAdded);
      } else {
        saveOverridesLocal(addedStorageKey, nextAdded);
      }
    }
    setNewAdvisorName("");
    showToast("Adviseur toegevoegd");
  }

  function updateProfileField(field, value) {
    setProfileDraft((prev) => ({ ...prev, [field]: value }));
  }

  function toggleProfileListField(field, value) {
    setProfileDraft((prev) => {
      const list = prev[field] || [];
      return {
        ...prev,
        [field]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
      };
    });
  }

  function pruneExpiredNotes(list) {
    const today = new Date();
    return (list || []).filter((n) => new Date(n.expires) >= today);
  }

  function persistNotes(nextList) {
    setNotesList(nextList);
    if (firebaseEnabled) {
      saveOverridesShared(notesFirebasePath, nextList);
    } else {
      saveOverridesLocal(notesStorageKey, nextList);
    }
  }

  function addNote() {
    if (!isAdmin) return;
    const pc = noteDraftPostcode.trim();
    const name = noteDraftName.trim();
    if (!/^\d{4}$/.test(pc) || !availablePostcodes.has(pc)) {
      setNoteError("Onbekende postcode");
      return;
    }
    if (!name) {
      setNoteError("Naam is verplicht");
      return;
    }
    if (!noteDraftDate) {
      setNoteError("Datum is verplicht");
      return;
    }
    setNoteError("");
    const newNote = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      postcode: pc,
      name,
      expires: noteDraftDate,
    };
    persistNotes(pruneExpiredNotes([...notesList, newNote]));
    setNoteDraftPostcode("");
    setNoteDraftName("");
    setNoteDraftDate("");
    showToast("Notitie toegevoegd");
  }

  function deleteNote(id) {
    if (!isAdmin) return;
    persistNotes(notesList.filter((n) => n.id !== id));
    showToast("Notitie verwijderd");
  }

  const panelHomeInvalid = Boolean(
    panelHomeDraft.trim() && !(/^\d{4}$/.test(panelHomeDraft.trim()) && availablePostcodes.has(panelHomeDraft.trim()))
  );

  function handleSave() {
    if (!isAdmin) return;
    const list = draft
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{4}$/.test(s));
    const unique = Array.from(new Set(list)).sort();
    const next = { ...overrides, [selected]: unique };
    setOverrides(next);
    if (firebaseEnabled) {
      saveOverridesShared(firebasePath, next);
    } else {
      saveOverridesLocal(storageKey, next);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    showToast("Wijzigingen opgeslagen");
  }

  function handleReset() {
    if (!isAdmin) return;
    const ok = window.confirm(
      "Alle lokale aanpassingen voor dit tabblad wissen en teruggaan naar de standaardgegevens?"
    );
    if (!ok) return;
    localStorage.removeItem(storageKey);
    localStorage.removeItem(tagsStorageKey);
    localStorage.removeItem(deletedStorageKey);
    localStorage.removeItem(addedStorageKey);
    localStorage.removeItem(homeStorageKey);
    localStorage.removeItem(postcodeInfoStorageKey);
    setOverrides({});
    setTagOverrides({});
    setDeletedAdvisors({});
    setAddedAdvisors({});
    setHomeOverrides({});
    setPostcodeInfoOverrides({});
    if (firebaseEnabled) {
      saveOverridesShared(firebasePath, {});
      saveOverridesShared(tagsFirebasePath, {});
      saveOverridesShared(deletedFirebasePath, {});
      saveOverridesShared(addedFirebasePath, {});
      saveOverridesShared(homeFirebasePath, {});
      saveOverridesShared(postcodeInfoFirebasePath, {});
    }
    setSelected(null);
    setDraft("");
    setPanelAdvisor(null);
    showToast("Hersteld naar standaardgegevens");
  }

  const namesToPostcodes = useMemo(() => {
    return Object.entries(postcodeNames).map(([pc, name]) => ({ pc, name, lower: name.toLowerCase() }));
  }, [postcodeNames]);

  function runSearch() {
    const entries = searchFields.map((s) => s.trim()).filter(Boolean);
    const results = [];
    const missing = [];
    entries.forEach((entry, i) => {
      const isPostcode = /^\d{4}$/.test(entry);
      let matchedPostcodes = [];
      if (isPostcode && availablePostcodes.has(entry)) {
        matchedPostcodes = [entry];
      } else if (!isPostcode) {
        const needle = entry.toLowerCase();
        matchedPostcodes = namesToPostcodes.filter((n) => n.lower.includes(needle)).map((n) => n.pc);
      }
      if (matchedPostcodes.length) {
        matchedPostcodes.forEach((pc) => {
          const advisors = advisorNames.filter((name) => (advisorPostcodes[name] || []).includes(pc));
          results.push({
            postcode: pc,
            name: postcodeNames[pc],
            color: SEARCH_COLORS[i],
            advisors,
            prio: postcodeInfo[pc]?.prio || "",
            alt: altFor(pc),
            remark: postcodeInfo[pc]?.remark || "",
          });
        });
      } else {
        missing.push(entry);
      }
    });
    setActiveSearch(results);
    setSearchError(missing.length ? `Niet gevonden: ${missing.join(", ")}` : "");

    if (results.length && mapRef.current) {
      const points = results.map((r) => postcodeToCentroid[r.postcode]).filter(Boolean);
      if (points.length === 1) {
        mapRef.current.flyTo(points[0], 12);
      } else if (points.length > 1) {
        mapRef.current.flyToBounds(points, { padding: [60, 60], maxZoom: 12 });
      }
    }
  }

  function updateSearchField(i, value) {
    setSearchFields((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  }

  function addSearchField() {
    setSearchFields((prev) => (prev.length < MAX_SEARCH_FIELDS ? [...prev, ""] : prev));
  }

  function clearSearch() {
    setActiveSearch([]);
    setSearchFields(["", ""]);
    setSearchError("");
  }

  const advisorSearchHighlight = useMemo(() => {
    const map = {};
    activeSearch.forEach(({ color, advisors }) => {
      advisors.forEach((name) => {
        if (!map[name]) map[name] = [];
        map[name].push(color);
      });
    });
    return map;
  }, [activeSearch]);

  const unknownInDraft = draft
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && (!/^\d{4}$/.test(s) || !availablePostcodes.has(s)));

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Adviseurs</h1>
        <p className={firebaseEnabled ? "sync-status live" : "sync-status local"}>
          {firebaseEnabled ? "● Live gedeeld met iedereen" : "○ Enkel lokaal (niet gedeeld)"}
        </p>
        <p className="hint role-badge">{isAdmin ? "Beheerder · kan bewerken" : "Bekijker · geen bewerkrechten"}</p>
        {isAdmin && (
          <button className="reset-btn" onClick={() => setNotesPanelOpen(true)} title="Notities op de kaart toevoegen of verwijderen">
            🗒️ Notities beheren
          </button>
        )}
        {isAdmin && (
          <button className="reset-btn" onClick={handleReset} title="Wist eventuele lokale aanpassingen en gaat terug naar de standaardgegevens">
            ↺ Herstel naar standaardgegevens
          </button>
        )}
        {isAdmin && (
          <form className="add-advisor-form" onSubmit={addAdvisor}>
            <input
              type="text"
              placeholder="Naam nieuwe adviseur"
              value={newAdvisorName}
              onChange={(e) => { setNewAdvisorName(e.target.value); setAddAdvisorError(""); }}
            />
            <button type="submit" className="add-advisor-btn" title="Adviseur toevoegen">+</button>
          </form>
        )}
        {addAdvisorError && <p className="warning">{addAdvisorError}</p>}
        <p className="hint">
          Klik op een naam om de regio te tonen (gestreept = alternatief bij verlof){isAdmin ? " · dubbelklik om te bewerken" : ""} · klik op een postcode voor info
        </p>
        <ul className="advisor-list">
          {advisorNames.map((name, i) => {
            const searchHit = advisorSearchHighlight[name];
            const nameTags = advisorTags[name] || [];
            const oldPrioTag = tagDefs.find((td) => td.bold && nameTags.includes(td.id));
            const isTierA = profiles[name]?.tier === "A";
            const isPrio = Boolean(oldPrioTag) || isTierA;
            const prioLabel = oldPrioTag?.label || "A-Adviseur";
            const prioEmoji = oldPrioTag?.emoji || "👑";
            const inactive = isInactive(name);
            const nameTypes = profiles[name]?.propertyTypes || [];
            const typeIcons = PROPERTY_TYPE_DEFS.filter((t) => nameTypes.includes(t.id));
            return (
              <li key={name} className={inactive ? "advisor-row inactive" : "advisor-row"}>
                <button
                  className={selected === name ? "active" : ""}
                  style={
                    searchHit
                      ? { borderLeft: `4px solid ${searchHit[0]}`, background: searchHit[0] + "1a" }
                      : selected === name
                      ? { borderColor: colorForIndex(i), background: colorForIndex(i) + "22" }
                      : {}
                  }
                  onClick={() => selectAdvisor(name)}
                  onDoubleClick={isAdmin ? () => openAdvisorPanel(name) : undefined}
                  title={isAdmin ? "Dubbelklik om te bewerken" : undefined}
                >
                  <span className="advisor-row-top">
                    <span className="dot" style={{ background: inactive ? "#bbb" : colorForIndex(i) }} />
                    <span style={isPrio ? { fontWeight: 700, background: "#FFD70055", padding: "1px 5px", borderRadius: "4px" } : {}}>{name}</span>
                    {isPrio && <span title={prioLabel}>{prioEmoji}</span>}
                    {advisorHomePostcode[name] && (
                      <span className="home-pc">{advisorHomePostcode[name]}</span>
                    )}
                    {(overrides[name] || tagOverrides[name]) && <span className="edited-mark" title="Aangepast">●</span>}
                  </span>
                  {(inactive || typeIcons.length > 0) && (
                    <span className="advisor-row-icons">
                      {typeIcons.map((t) => <span key={t.id} title={t.label}>{t.emoji}</span>)}
                      {inactive && <span className="inactive-badge" title="Momenteel niet actief">niet actief</span>}
                    </span>
                  )}
                </button>
                <button
                  className="profile-btn"
                  onClick={() => (isAdmin ? openAdvisorPanel(name) : setPanelAdvisor(name))}
                  title="Profiel bekijken"
                  aria-label={`Profiel van ${name}`}
                >
                  👤
                </button>
              </li>
            );
          })}
        </ul>

        {selected && isAdmin && (
          <div className="editor">
            <h2>{selected}</h2>
            <p className="hint">Postcodes, gescheiden door komma</p>
            <p className="hint">Of klik een postcode op de kaart om toe te voegen/verwijderen</p>
            <textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
            {unknownInDraft.length > 0 && (
              <p className="warning">Onbekend of ongeldig: {unknownInDraft.join(", ")}</p>
            )}
            <div className="editor-actions">
              <button className="save-btn" onClick={handleSave}>
                {saved ? "Opgeslagen ✓" : "Opslaan"}
              </button>
              <span className="count">{draft.split(",").map((s) => s.trim()).filter(Boolean).length} postcodes</span>
            </div>
          </div>
        )}
      </aside>

      <main className="map-wrap">
        <div className="search-bar">
          {searchFields.map((val, i) => (
            <input
              key={i}
              type="text"
              placeholder={i === 0 ? "Postcode of plaats, bv. 2500 of Lier" : `Postcode of plaats ${i + 1} (optioneel)`}
              value={val}
              onChange={(e) => updateSearchField(i, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              style={{ borderLeft: `3px solid ${SEARCH_COLORS[i]}` }}
            />
          ))}
          <div className="search-actions">
            <button className="search-btn" onClick={runSearch}>Zoek</button>
            {searchFields.length < MAX_SEARCH_FIELDS && (
              <button className="search-add" onClick={addSearchField} title="Nog een postcode toevoegen">+ veld</button>
            )}
            {activeSearch.length > 0 && (
              <button className="search-clear" onClick={clearSearch}>Wissen</button>
            )}
          </div>
          {searchError && <span className="search-error">{searchError}</span>}
          {activeSearch.length > 0 && (
            <div className="search-results">
              {activeSearch.map(({ postcode, name, color, advisors, prio, alt, remark }) => (
                <div key={postcode} className="search-result-row">
                  <span className="search-result-pc" style={{ color }}>
                    {postcode}{name ? ` · ${name}` : ""}{prio ? ` · Prio ${prio}` : ""}
                  </span>
                  <span className="search-result-names">
                    {advisors.length
                      ? advisors.map((n, idx) => {
                          const isPrio = tagDefs.some((td) => td.bold && (advisorTags[n] || []).includes(td.id)) || profiles[n]?.tier === "A";
                          return (
                            <span key={n} style={isPrio ? { fontWeight: 700 } : {}}>
                              {n}{idx < advisors.length - 1 ? ", " : ""}
                            </span>
                          );
                        })
                      : "niemand toegewezen"}
                  </span>
                  {(alt || remark) && (
                    <span className="search-result-extra">
                      {[alt && `Alternatief bij verlof: ${withInactiveMark(alt)}`, remark].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <MapContainer ref={mapRef} center={center} zoom={initialZoom} zoomControl={false} style={{ height: "100%", width: "100%" }}>
          <ZoomControl position="topright" />
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapEvents onZoom={setZoom} onBounds={setMapBounds} />

          {postcodesGeo && (
            <GeoJSON
              ref={advisorLayerRef}
              data={postcodesGeo}
              style={styleFn}
              renderer={canvasRenderer}
              onEachFeature={(feature, layer) => {
                layer.on("click", (e) => handlePostcodeClickRef.current(feature.properties.postcode, e.latlng));
              }}
            />
          )}

          {!showPostcodeLabels &&
            zoneLabels.map(({ zone, lat, lng }) => (
              <CircleMarker key={"zone-" + zone} center={[lat, lng]} radius={1} interactive={false} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
                <Tooltip permanent direction="center" className="zone-label">{zone}</Tooltip>
              </CircleMarker>
            ))}

          {showPostcodeLabels &&
            visiblePostcodeLabels.map(({ pc, lat, lng }) => (
              <CircleMarker key={"pc-" + pc} center={[lat, lng]} radius={1} interactive={false} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
                <Tooltip permanent direction="center" className="postcode-label">
                  {pc}{postcodeInfo[pc]?.prio && <sup className="postcode-prio">P{postcodeInfo[pc].prio}</sup>}
                </Tooltip>
              </CircleMarker>
            ))}

          {Object.entries(notesByPostcode).map(([pc, list]) => {
            const c = postcodeToCentroid[pc];
            if (!c) return null;
            return (
              <CircleMarker key={"note-" + pc} center={c} radius={1} interactive={false} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
                <Tooltip permanent direction="top" className="sticky-note-wrap">
                  <div
                    className="sticky-note"
                    style={{ transform: `scale(${Math.min(1.2, Math.max(0.55, (zoom - 6) / 5))})` }}
                  >
                    {groupNotesByName(list).map((g) => (
                      <div key={g.name}>{g.name} {g.dates.map(shortDate).join(" en ")}</div>
                    ))}
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}

          <Pane name="homes" style={{ zIndex: 700 }}>
            {selected && homeCoords[selected] && (
              <Marker
                position={homeCoords[selected]}
                icon={L.divIcon({ html: "🏠", className: "home-house-icon", iconSize: [26, 26], iconAnchor: [13, 26] })}
              />
            )}
            {Object.entries(homeCoords).map(([name, latlng]) => {
              const isSel = selected === name;
              const dotSize = isSel ? 14 : 8;
              const dotColor = isSel ? highlightColor : "#444";
              return (
                <Marker
                  key={name}
                  position={latlng}
                  // offset into the top-right corner of the postcode, like a
                  // notification badge, instead of sitting on the postcode label
                  icon={L.divIcon({
                    html: `<span class="home-dot" style="width:${dotSize}px;height:${dotSize}px;background:${dotColor};"></span>`,
                    className: "home-dot-icon",
                    iconSize: [20, 20],
                    iconAnchor: [1, 19],
                  })}
                  eventHandlers={{ click: () => selectAdvisor(name) }}
                >
                  <Tooltip>
                    {name} · {postcodeNames[advisorHomePostcode[name]] || ""} ({advisorHomePostcode[name]})
                  </Tooltip>
                </Marker>
              );
            })}
          </Pane>
        </MapContainer>
      </main>

      {isAdmin && notesPanelOpen && (
        <>
          <div className="advisor-panel-backdrop" onClick={() => setNotesPanelOpen(false)} />
          <div className="advisor-panel notes-panel">
            <div className="advisor-panel-header">
              <h2>Notities</h2>
              <button className="advisor-panel-close" onClick={() => setNotesPanelOpen(false)} aria-label="Sluiten">×</button>
            </div>

            <div className="notes-form">
              <input
                type="text"
                placeholder="Postcode"
                value={noteDraftPostcode}
                onChange={(e) => setNoteDraftPostcode(e.target.value)}
              />
              <input
                type="text"
                placeholder="Naam"
                value={noteDraftName}
                onChange={(e) => setNoteDraftName(e.target.value)}
              />
              <input
                type="date"
                value={noteDraftDate}
                onChange={(e) => setNoteDraftDate(e.target.value)}
              />
              {noteError && <p className="warning">{noteError}</p>}
              <button className="save-btn" onClick={addNote}>+ Toevoegen</button>
            </div>

            <div className="notes-list">
              {activeNotes.length === 0 && <p className="hint">Geen actieve notities</p>}
              {activeNotes
                .slice()
                .sort((a, b) => a.expires.localeCompare(b.expires))
                .map((n) => (
                  <div key={n.id} className="notes-list-row">
                    <span>{n.postcode} · {n.name} · {shortDate(n.expires)}</span>
                    <button className="notes-list-delete" onClick={() => deleteNote(n.id)} aria-label="Verwijder">×</button>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}

      {panelAdvisor && (() => {
        // merged with the defaults: Firebase drops empty arrays, so a saved
        // profile can come back without `propertyTypes`/`languages`
        const viewProfile = { ...emptyProfile(), ...(profiles[panelAdvisor] || {}) };
        return (
          <>
            <div className="advisor-panel-backdrop" onClick={closeAdvisorPanel} />
            <div className="advisor-panel">
              <div className="advisor-panel-header">
                {isAdmin ? (
                  <input
                    type="text"
                    className="advisor-panel-name-input"
                    value={panelNameDraft}
                    onChange={(e) => { setPanelNameDraft(e.target.value); setPanelNameError(""); }}
                  />
                ) : (
                  <h2>{panelAdvisor}</h2>
                )}
                <button className="advisor-panel-close" onClick={closeAdvisorPanel} aria-label="Sluiten">×</button>
              </div>
              {panelNameError && <p className="warning">{panelNameError}</p>}

              {isAdmin && profileDraft ? (
                <>
                  <div className="profile-photo"><ProfileAvatar gender={profileDraft.gender} /></div>

                  <div className="profile-section">
                    <p className="hint">Thuisbasis (postcode)</p>
                    <input
                      type="text"
                      className="advisor-panel-home-input"
                      placeholder="Postcode"
                      value={panelHomeDraft}
                      onChange={(e) => setPanelHomeDraft(e.target.value)}
                    />
                    {panelHomeDraft.trim() && postcodeNames[panelHomeDraft.trim()] && (
                      <p className="hint">{postcodeNames[panelHomeDraft.trim()]}</p>
                    )}
                    {panelHomeInvalid && <p className="warning">Onbekende postcode</p>}
                  </div>

                  {tagDefs.some((td) => td.bold) && (
                    <div className="profile-section">
                      <p className="hint">Prioriteit</p>
                      {tagDefs.filter((td) => td.bold).map((td) => (
                        <label key={td.id} className="profile-checkbox-row">
                          <input
                            type="checkbox"
                            checked={panelTags.includes(td.id)}
                            onChange={() => togglePanelTag(td.id)}
                          />
                          <span>{td.emoji} {td.label}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="profile-section">
                    <label className="profile-checkbox-row">
                      <input
                        type="checkbox"
                        checked={Boolean(profileDraft.inactive)}
                        onChange={(e) => updateProfileField("inactive", e.target.checked)}
                      />
                      <span>Momenteel niet actief</span>
                    </label>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Profielfoto</p>
                    <div className="profile-radio-row">
                      <label><input type="radio" name="gender" checked={profileDraft.gender === "m"} onChange={() => updateProfileField("gender", "m")} /> Man</label>
                      <label><input type="radio" name="gender" checked={profileDraft.gender === "v"} onChange={() => updateProfileField("gender", "v")} /> Vrouw</label>
                    </div>
                  </div>

                  <div className="profile-section">
                    <p className="hint">👑 Type adviseur</p>
                    <div className="profile-radio-row">
                      <label><input type="radio" name="tier" checked={profileDraft.tier === "A"} onChange={() => updateProfileField("tier", "A")} /> 👑 A-Adviseur</label>
                      <label><input type="radio" name="tier" checked={profileDraft.tier === "B"} onChange={() => updateProfileField("tier", "B")} /> B-Adviseur</label>
                    </div>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Type panden</p>
                    <div className="profile-checkbox-grid">
                      {PROPERTY_TYPE_DEFS.map((t) => (
                        <label key={t.id} className="profile-checkbox-row">
                          <input
                            type="checkbox"
                            checked={profileDraft.propertyTypes.includes(t.id)}
                            onChange={() => toggleProfileListField("propertyTypes", t.id)}
                          />
                          <span>{t.emoji} {t.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Panden vanaf (€)</p>
                    <input
                      type="number"
                      min="0"
                      step="10000"
                      placeholder="bv. 200000"
                      value={profileDraft.pandenVanaf}
                      onChange={(e) => updateProfileField("pandenVanaf", e.target.value)}
                    />
                  </div>

                  <div className="profile-section">
                    <p className="hint">Meeste interesse in</p>
                    <input
                      type="text"
                      placeholder="bv. villa's, appartementen"
                      value={profileDraft.meesteInteresse}
                      onChange={(e) => updateProfileField("meesteInteresse", e.target.value)}
                    />
                  </div>

                  <div className="profile-section">
                    <p className="hint">In regio</p>
                    <input
                      type="text"
                      placeholder="bv. Lier, Kempen"
                      value={profileDraft.regio}
                      onChange={(e) => updateProfileField("regio", e.target.value)}
                    />
                  </div>

                  <div className="profile-section">
                    <p className="hint">Welke talen</p>
                    <div className="profile-radio-row">
                      {LANGUAGE_DEFS.map((lang) => (
                        <label key={lang} className="profile-checkbox-row">
                          <input
                            type="checkbox"
                            checked={profileDraft.languages.includes(lang)}
                            onChange={() => toggleProfileListField("languages", lang)}
                          />
                          <span>{lang}</span>
                        </label>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Andere taal, vrij in te voeren"
                      value={profileDraft.languagesExtra}
                      onChange={(e) => updateProfileField("languagesExtra", e.target.value)}
                    />
                  </div>

                  <div className="profile-section">
                    <p className="hint">Doet een afspraak voor ENKEL een thuisbatterij</p>
                    <div className="profile-radio-row">
                      <label><input type="radio" name="thuisbatterijEnkel" checked={profileDraft.thuisbatterijEnkel === "ja"} onChange={() => updateProfileField("thuisbatterijEnkel", "ja")} /> 👍 Ja!</label>
                      <label><input type="radio" name="thuisbatterijEnkel" checked={profileDraft.thuisbatterijEnkel === "nee"} onChange={() => updateProfileField("thuisbatterijEnkel", "nee")} /> 👎 Nee!</label>
                    </div>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Eerste/laatste afspraak: max. … min van thuisbasis</p>
                    <input
                      type="number"
                      min="0"
                      placeholder="Minuten"
                      value={profileDraft.travelRadiusMin}
                      onChange={(e) => updateProfileField("travelRadiusMin", e.target.value)}
                    />
                  </div>

                  <div className="profile-section">
                    <p className="hint">Extra info</p>
                    <textarea rows={4} value={profileDraft.extraInfo} onChange={(e) => updateProfileField("extraInfo", e.target.value)} />
                  </div>

                  <div className="editor-actions">
                    <button className="save-btn" onClick={saveAdvisorPanel}>
                      {panelSaved ? "Opgeslagen ✓" : "Opslaan"}
                    </button>
                    <button className="panel-close-btn" onClick={closeAdvisorPanel}>Sluiten</button>
                  </div>
                  <div className="advisor-panel-danger">
                    <button className="delete-btn" onClick={deleteAdvisor}>Verwijder</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="profile-photo"><ProfileAvatar gender={viewProfile.gender} /></div>
                  {isInactive(panelAdvisor) && <p className="inactive-badge">Momenteel niet actief</p>}
                  {viewProfile.tier && (
                    <p className="profile-tier">{viewProfile.tier === "A" ? "👑 A-Adviseur" : "B-Adviseur"}</p>
                  )}

                  <div className="profile-section">
                    <p className="hint">Type panden</p>
                    <div className="profile-chip-row">
                      {PROPERTY_TYPE_DEFS.filter((t) => viewProfile.propertyTypes.includes(t.id)).map((t) => (
                        <span key={t.id} className="profile-chip">{t.emoji} {t.label}</span>
                      ))}
                      {viewProfile.propertyTypes.length === 0 && <span className="hint">Nog niet ingevuld</span>}
                    </div>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Panden vanaf</p>
                    <p>{viewProfile.pandenVanaf ? formatEuro(viewProfile.pandenVanaf) : "Nog niet ingevuld"}</p>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Meeste interesse in</p>
                    <p>{viewProfile.meesteInteresse || "Nog niet ingevuld"}</p>
                  </div>

                  <div className="profile-section">
                    <p className="hint">In regio</p>
                    <p>{viewProfile.regio || "Nog niet ingevuld"}</p>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Welke talen</p>
                    <p>{[...viewProfile.languages, viewProfile.languagesExtra].filter(Boolean).join(", ") || "Nog niet ingevuld"}</p>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Doet een afspraak voor ENKEL een thuisbatterij</p>
                    <p>
                      {viewProfile.thuisbatterijEnkel === "ja"
                        ? "👍 Ja!"
                        : viewProfile.thuisbatterijEnkel === "nee"
                        ? "👎 Nee!"
                        : "Nog niet ingevuld"}
                    </p>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Thuisbasis</p>
                    <p>
                      {advisorHomePostcode[panelAdvisor]
                        ? `${advisorHomePostcode[panelAdvisor]} · ${postcodeNames[advisorHomePostcode[panelAdvisor]] || ""}`
                        : "Nog niet ingevuld"}
                    </p>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Reisradius eerste/laatste afspraak</p>
                    <p>{viewProfile.travelRadiusMin ? `max. ${viewProfile.travelRadiusMin} min van thuisbasis` : "Nog niet ingevuld"}</p>
                  </div>

                  <div className="profile-section">
                    <p className="hint">Extra info</p>
                    <p className="profile-extra-info">{viewProfile.extraInfo || "-"}</p>
                  </div>

                  <div className="editor-actions">
                    <button className="panel-close-btn" onClick={closeAdvisorPanel}>Sluiten</button>
                  </div>
                </>
              )}
            </div>
          </>
        );
      })()}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
