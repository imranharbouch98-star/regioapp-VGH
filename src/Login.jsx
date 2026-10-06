import { useState } from "react";
import { firebaseEnabled, adminSignIn } from "./firebase.js";

// no built-in fallback codes: each client deployment sets its own in .env /
// Vercel, and with nothing set nobody can log in (instead of a shared default)
const VIEW_CODE = import.meta.env.VITE_ACCESS_CODE || "";
// only used when Firebase isn't configured (local dev) -- there's no shared
// database to protect in that case, so a plain code is fine as a fallback
const LOCAL_ADMIN_CODE = import.meta.env.VITE_ADMIN_ACCESS_CODE || "";
// the single shared admin account's email (created once in the Firebase
// Console); the login form itself only asks for the password
const ADMIN_EMAIL = import.meta.env.VITE_FIREBASE_ADMIN_EMAIL || "admin@vgh.local";

export default function Login({ onSuccess }) {
  const [mode, setMode] = useState("viewer");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode(next) {
    setMode(next);
    setError("");
  }

  function handleViewerSubmit(e) {
    e.preventDefault();
    if (!VIEW_CODE) {
      setError("Toegangscode is niet ingesteld (VITE_ACCESS_CODE)");
    } else if (code.trim() === VIEW_CODE) {
      onSuccess("viewer");
    } else {
      setError("Foute code, probeer opnieuw");
    }
  }

  async function handleAdminSubmit(e) {
    e.preventDefault();
    setError("");

    if (!firebaseEnabled) {
      if (!LOCAL_ADMIN_CODE) {
        setError("Beheerderscode is niet ingesteld (VITE_ADMIN_ACCESS_CODE)");
      } else if (password === LOCAL_ADMIN_CODE) {
        onSuccess("admin");
      } else {
        setError("Foute code, probeer opnieuw");
      }
      return;
    }

    setBusy(true);
    try {
      await adminSignIn(ADMIN_EMAIL, password);
      onSuccess("admin");
    } catch {
      setError("Foute code, probeer opnieuw");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "admin") {
    return (
      <div className="login-screen">
        <form className="login-box" onSubmit={handleAdminSubmit}>
          <h1>Beheerder inloggen</h1>
          <p className="hint">Voer de beheerderscode in</p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder="Beheerderscode"
          />
          {error && <p className="warning">{error}</p>}
          <button type="submit" className="save-btn" disabled={busy}>
            {busy ? "Bezig..." : "Inloggen"}
          </button>
          <button type="button" className="login-switch" onClick={() => switchMode("viewer")}>
            ← Terug naar normale login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-box" onSubmit={handleViewerSubmit}>
        <h1>Adviseurs regiokaart</h1>
        <p className="hint">Voer de toegangscode in</p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(""); }}
          placeholder="Toegangscode"
        />
        {error && <p className="warning">{error}</p>}
        <button type="submit" className="save-btn">Openen</button>
        <button type="button" className="login-switch" onClick={() => switchMode("admin")}>
          Ben je beheerder? Log hier in →
        </button>
      </form>
    </div>
  );
}
