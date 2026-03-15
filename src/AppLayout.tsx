import { Outlet } from "react-router-dom";
import AppNav from "./AppNav";
import SiteFooter from "./components/SiteFooter";
import "./AppLayout.css";

export default function AppLayout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-container">
          <AppNav />
        </div>
      </header>

      <div className="app-container">
        <main className="app-main">
          <Outlet />
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}
