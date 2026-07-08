import { Routes, Route } from "react-router-dom";
import Accueil from "./Pages/Accueil";
import Detail from "./Pages/Details";
import "./App.css";

function App() {

  return (
    <main className="container">
      <Routes>
        <Route path='/' element={<Accueil/>}/>
        <Route path='/affaire' element={<Detail/>}/>
      </Routes>
    </main>
  );
}

export default App;
