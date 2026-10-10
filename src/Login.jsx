import { useState } from "react";
import { firebaseEnabled, signInWithCode, ADMIN_EMAIL, VIEWER_EMAIL } from "./firebase.js";

// With Firebase configured, both codes are checked by Firebase (they're the
// passwords of the viewer/admin accounts) and these two are ignored. They're
// only for local testing without Firebase -- no built-in fallback codes.
const LOCAL_VIEW_CODE = import.meta.env.VITE_ACCESS_CODE || "";
const LOCAL_ADMIN_CODE = import.meta.env.VITE_ADMIN_ACCESS_CODE || "";

function loginErrorMessage(err) {
  if (err?.code === "auth/too-many-requests") return "Te veel pogingen, probeer het later opnieuw";
  if (err?.code === "auth/network-request-failed") return "Geen verbinding, probeer opnieuw";
  return "Foute code, probeer opnieuw";
}

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

  async function submitCode(role, typed) {
    setError("");

    if (!firebaseEnabled) {
      const expected = role === "admin" ? LOCAL_ADMIN_CODE : LOCAL_VIEW_CODE;
      if (!expected) {
        setError(`Code is niet ingesteld (${role === "admin" ? "VITE_ADMIN_ACCESS_CODE" : "VITE_ACCESS_CODE"})`);
      } else if (typed === expected) {
        onSuccess(role);
      } else {
        setError("Foute code, probeer opnieuw");
      }
      return;
    }

    // App picks up the signed-in account itself via the auth listener
    setBusy(true);
    try {
      await signInWithCode(role === "admin" ? ADMIN_EMAIL : VIEWER_EMAIL, typed);
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleViewerSubmit(e) {
    e.preventDefault();
    submitCode("viewer", code.trim());
  }

  function handleAdminSubmit(e) {
    e.preventDefault();
    submitCode("admin", password);
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
        <h1>Makelaars regiokaart</h1>
        <p className="hint">Voer de toegangscode in</p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(""); }}
          placeholder="Toegangscode"
        />
        {error && <p className="warning">{error}</p>}
        <button type="submit" className="save-btn" disabled={busy}>
          {busy ? "Bezig..." : "Openen"}
        </button>
        <button type="button" className="login-switch" onClick={() => switchMode("admin")}>
          Ben je beheerder? Log hier in →
        </button>
      </form>
    </div>
  );
}
