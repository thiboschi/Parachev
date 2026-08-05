import {BrowserRouter, Routes, Route} from "react-router-dom"
import Page from "./pages/page";
import Prevision from "./pages/prevision";
import Search from "./pages/search";
import Create from "./pages/create";

import "./App.css";

function App() {

  return (
    <main className="@container/main">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/prevision" element={<Prevision/>} />
          <Route path="/search" element={<Search/>} />
          <Route path="/create" element={<Create/>} />
        </Routes>
      </BrowserRouter>

    </main>
  );
}

export default App;
