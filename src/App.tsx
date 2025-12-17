import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./HomePage";
import AuthPage from "./AuthPage";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth" element={<AuthPage />} />
      </Routes>
    </BrowserRouter>
  );
}
