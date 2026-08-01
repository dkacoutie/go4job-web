import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./buttons.css";
import App from "./App";

// IMPORTANT: charge le client Supabase (et le window.supabase en DEV si tu l'as ajoute)
import "./lib/supabaseClient";
import { initPwa } from "./lib/pwa";

initPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
