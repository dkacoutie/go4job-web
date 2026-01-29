import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./buttons.css"; // ✅ doit venir APRÈS index.css
import App from "./App";

// ✅ IMPORTANT: charge le client Supabase (et le window.supabase en DEV si tu l’as ajouté)
import "./lib/supabaseClient";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
