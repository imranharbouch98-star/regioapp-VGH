import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set } from "firebase/database";
import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

// only initialize if configured -- lets the app still run locally without
// Firebase set up yet (falls back to local-only storage, see App.jsx)
export const firebaseEnabled = Boolean(firebaseConfig.databaseURL);

let db = null;
let auth = null;
if (firebaseEnabled) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
}

// Firebase Realtime Database forbids ".", "#", "$", "/", "[", "]" in object
// keys, but the app uses advisor names (e.g. "Sven V.", "Tom H.") directly as
// keys everywhere. Transparently escape/unescape those characters right at
// the Firebase boundary so the rest of the app never has to know about it.
const FORBIDDEN_KEY_CHARS = /[.#$/[\]]/g;
const ESCAPED_KEY_CHARS = /~(\d+)~/g;

function escapeKey(key) {
  return key.replace(FORBIDDEN_KEY_CHARS, (ch) => `~${ch.charCodeAt(0)}~`);
}

function unescapeKey(key) {
  return key.replace(ESCAPED_KEY_CHARS, (_, code) => String.fromCharCode(Number(code)));
}

function mapTopLevelKeys(obj, mapKey) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  Object.entries(obj).forEach(([k, v]) => { out[mapKey(k)] = v; });
  return out;
}

export function subscribeToOverrides(path, callback) {
  if (!db) return () => {};
  const overridesRef = ref(db, path);
  const unsubscribe = onValue(
    overridesRef,
    (snapshot) => {
      callback(mapTopLevelKeys(snapshot.val(), unescapeKey) || {});
    },
    (err) => console.error(`Firebase: kan "${path}" niet lezen`, err)
  );
  return unsubscribe;
}

// a rejected write (no connection, or no write permission) would otherwise
// fail silently while the screen already shows the change -- tell the UI
export function saveOverridesShared(path, overrides) {
  if (!db) return Promise.resolve();
  return set(ref(db, path), mapTopLevelKeys(overrides, escapeKey)).catch((err) => {
    console.error(`Firebase: kan "${path}" niet opslaan`, err);
    window.dispatchEvent(new CustomEvent("firebase-save-error"));
  });
}

// Logging in = signing in to one of two shared Firebase Auth accounts, with
// the typed code as that account's password. Firebase checks the code (and
// rate-limits guessing); nothing about it lives in the app itself. The two
// accounts are created once in the Firebase Console.
export const ADMIN_EMAIL = import.meta.env.VITE_FIREBASE_ADMIN_EMAIL || "admin@vgh.local";
export const VIEWER_EMAIL = import.meta.env.VITE_FIREBASE_VIEWER_EMAIL || "viewer@vgh.local";

export function roleForUser(user) {
  if (!user) return null;
  return user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "admin" : "viewer";
}

// what the user can actually do is enforced by the database rules (read:
// any signed-in account, write: only the admin account) -- see
// database.rules.json. Session-only persistence so a sign-in doesn't
// silently survive a browser restart on a shared machine.
export async function signInWithCode(email, code) {
  if (!auth) throw new Error("Firebase is niet geconfigureerd");
  await setPersistence(auth, browserSessionPersistence);
  await signInWithEmailAndPassword(auth, email, code);
}

export function firebaseSignOut() {
  if (!auth) return Promise.resolve();
  return signOut(auth);
}

// callback(user | null); fires once Firebase has restored any existing session
export function subscribeToAuth(callback) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}
