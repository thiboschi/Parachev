import "./Accueil.css";

export default function Accueil() {

return (
  <div>
    <div className="navbar">
      <h1>Paracheve</h1>

      <div className="search-bar">
        <input type="text" className="search-input" placeholder="Rechercher..."/>
        <button className="search-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
      </div>

      <div className="dropdown">
        <button className="dropdown-btn">Action ▾</button>
        <div className="dropdown-content">
          <a href="#">Importer un fichier</a>
          <a href="#">Créer une affaire</a>
        </div>
      </div>

    </div>

  
    


    {/* <nav>
      <Link to="/affaire"> Test </Link>
    </nav> */}
  </div>
);
}
