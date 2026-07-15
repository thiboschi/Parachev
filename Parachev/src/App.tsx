import {BrowserRouter, Routes, Route, Link} from "react-router-dom"
import DashBoard from "./pages/DashBoard";
import Page404 from "./pages/Page404";

import "./App.css";

function App() {

  return (
    <main>
      <BrowserRouter>
        {/* <nav>
          <Link to="/">DashBoard</Link>
          <Link to="/contact">Contact</Link>
        </nav>  */}
        <Routes>
          <Route path="/" element={<DashBoard />} />
          <Route path="/error" element={<Page404 />} />
        </Routes>
      </BrowserRouter>
      
    </main>
  );
}

export default App;
