import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Chiffrage from "./Details_SubPage/Chiffrage";
import Document from "./Details_SubPage/Document";
import Previsions from "./Details_SubPage/Previsions";

export default function Detail() {
 

return (
  <div className="page">
    {/* <Routes>
      <Route path='/affaire/:num_commande/Previsions' element={<Previsions/>}/>
      <Route path='/affaire/:num_commande/Chiffrage' element={<Chiffrage/>}/>
      <Route path='/affaire/:num_Commande/Document' element={<Document/>}/>
    </Routes> */}

    <h1>Details</h1>

  </div>
);
}
