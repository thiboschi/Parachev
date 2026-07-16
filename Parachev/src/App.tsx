import {BrowserRouter, Routes, Route} from "react-router-dom"
import Page from "./pages/page";
import Page404 from "./pages/Page404";
import DashBoard from "./pages/DashBoard";

import "./App.css";

function App() {

  return (
    <main className="@container/main">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/test" element={<Page404/>} />
          <Route path="/test2" element={<DashBoard/>} />
        </Routes>
      </BrowserRouter>
      
    </main>
  );
}

export default App;
