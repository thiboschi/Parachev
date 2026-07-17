import {BrowserRouter, Routes, Route} from "react-router-dom"
import Page from "./pages/page";
import Prevision from "./pages/prevision";
import Chiffrage from "./pages/chiffrage";
import Search from "./pages/search";

import "./App.css";

function App() {

  return (
    <main className="@container/main">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/chiffrage" element={<Chiffrage/>} />
          <Route path="/prevision" element={<Prevision/>} />
          <Route path="/search" element={<Search/>} />
        </Routes>
      </BrowserRouter>

    </main>
  );
}

export default App;
