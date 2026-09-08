import {BrowserRouter, Routes, Route} from "react-router-dom"
import Page from "./pages/dashboard";
import Prevision from "./pages/prevision";
import Search from "./pages/search";

import "./App.css";

function App() {

  return (
    <main className="@container/main">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/prevision/:affaire" element={<Prevision/>} />
          <Route path="/search" element={<Search/>} />
        </Routes>
      </BrowserRouter>

    </main>
  );
}

export default App;
