import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";


export default function Accueil() {
 

return (
  <div className="page">
    <h1>Accueil</h1>

    <nav>
      <Link to="/affaire"> Test </Link>
    </nav>
  </div>
);
}
