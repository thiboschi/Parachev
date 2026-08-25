import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { invoke } from "@tauri-apps/api/core";

export default function Page() {

  const [affaire, setAffaire] = useState("");
  const [, setResultat] = useState<Record<string, number> | null>(null);

  // ↓ la fonction handler, définie AVANT le return du composant
  async function handlePrevisualiser() {
  try {
    const heures = await invoke<Record<string, number>>("previsualiser_affaire", { affaire });
    console.log("Résultat:", heures);
    setResultat(heures);
  } catch (e) {
    console.error("Erreur invoke:", e);
  }
}

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <input value={affaire} onChange={(e) => setAffaire(e.target.value)} />
              <button onClick={handlePrevisualiser}>
                Prévisualiser
              </button>

              <div className="px-4 lg:px-6">
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}