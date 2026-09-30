import { useLocation } from "react-router-dom"
import { data } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { IndexationProgress } from "@/components/dashboard/indexation-progress"
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

export function SiteHeader() {
  const { pathname } = useLocation()
  const title =
    data.navMain.find((item) => item.url === pathname)?.title ?? "Dashboard"

  const [dossier, setDossier] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    invoke<string | null>("obtenir_dossier_configure").then(setDossier);
  }, []);

  async function handleChoisirDossier() {
    const chemin = await invoke<string | null>("choisir_dossier_surveille");
    if (chemin) setDossier(chemin);
  }

  function handleCalibrer() {
    setCalibrating(true);
    toast.promise(
      invoke("recalibrer")
        .then(() => {
          // Permet à la page Coefficients (si elle est montée) de
          // rafraîchir son affichage sans avoir besoin d'un store partagé.
          window.dispatchEvent(new Event("coefficients-updated"));
        })
        .finally(() => setCalibrating(false)),
      {
        loading: "Calcul des coefficients…",
        success: "Coefficients recalculés",
        error: (e) => (e instanceof Error ? e.message : String(e)),
      }
    );
  }

  return (
    <header className="relative flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{title}</h1>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <IndexationProgress />
          <Button variant="ghost" size="sm" className="hidden sm:flex"/>
          <Button variant="outline" onClick={handleCalibrer} disabled={calibrating}>
            {calibrating ? "Calibration…" : "Calibrer"}
          </Button>
          <Button onClick={handleChoisirDossier}>
            {dossier ? `Dossier` : "Choisir le dossier à surveiller"}
          </Button>
        </div>
      </div>
    </header>
  )
}