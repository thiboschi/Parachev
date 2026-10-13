import {BrowserRouter, Routes, Route} from "react-router-dom"
import { Toaster } from "sonner";
import Page from "./pages/dashboard";
import Prevision from "./pages/prevision";
import Recherche from "./pages/recherche";
import Chiffrage from "./pages/chiffrage";
import ModeleOffre from "./pages/modele-offre";

import "./App.css";

function App() {

  return (
    <main className="@container/main">
      <Toaster richColors position="top-right" />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/prevision/:affaire" element={<Prevision/>} />
          <Route path="/recherche" element={<Recherche/>} />
          <Route path="/chiffrage" element={<Chiffrage/>} />
          <Route path="/modele-offre" element={<ModeleOffre/>} />
        </Routes>
      </BrowserRouter>

    </main>
  );
}

export default App;
