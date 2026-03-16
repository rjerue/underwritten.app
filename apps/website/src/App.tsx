import { Route, Routes } from "react-router-dom";

import { AboutRoute } from "./pages/about-route";
import { EditorPage } from "./pages/editor-page";

export function App() {
  return (
    <Routes>
      <Route element={<EditorPage />} path="/" />
      <Route element={<AboutRoute />} path="/about" />
    </Routes>
  );
}
