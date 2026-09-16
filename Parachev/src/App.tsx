import {BrowserRouter, Routes, Route} from "react-router-dom"
import { Toaster } from "sonner";
import Page from "./pages/dashboard";
import Prevision from "./pages/prevision";
import Search from "./pages/search";
import Coefficients from "./pages/coefficients";
import Chiffrage from "./pages/chiffrage";

import "./App.css";

function App() {

  return (
    <main className="@container/main">
      <Toaster richColors position="top-right" />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/prevision/:affaire" element={<Prevision/>} />
          <Route path="/search" element={<Search/>} />
          <Route path="/coefficients" element={<Coefficients/>} />
          <Route path="/chiffrage" element={<Chiffrage/>} />
        </Routes>
      </BrowserRouter>

    </main>
  );
}

export default App;
