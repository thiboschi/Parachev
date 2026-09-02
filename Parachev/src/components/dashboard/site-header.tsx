import { useLocation } from "react-router-dom"
import { data } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function SiteHeader() {
  const { pathname } = useLocation()
  const title =
    data.navMain.find((item) => item.url === pathname)?.title ?? "Dashboard"
  
  const [dossier, setDossier] = useState<string | null>(null);

  useEffect(() => {
    invoke<string | null>("obtenir_dossier_configure").then(setDossier);
  }, []);

  async function handleChoisirDossier() {
    const chemin = await invoke<string | null>("choisir_dossier_surveille");
    if (chemin) setDossier(chemin);
  }

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="hidden sm:flex"/>
          <Button onClick={handleChoisirDossier}>
            {dossier ? `Dossier : ${dossier}` : "Choisir le dossier à surveiller"}
          </Button>
        </div>
      </div>
    </header>
  )
}