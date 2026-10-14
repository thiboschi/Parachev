import * as React from "react"
import { IconArchive, IconCalculator, IconDashboard, IconFileText, IconSearch } from "@tabler/icons-react"
import { NavMain } from "@/components/dashboard/nav-main"
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"

export const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/",
      icon: IconDashboard,
    },
    {
      title: "Recherche",
      url: "/recherche",
      icon: IconSearch,
    },
    {
      title: "Chiffrage",
      url: "/chiffrage",
      icon: IconCalculator,
      separatorBefore: true,
    },
    {
      title: "Modèle d'offre",
      url: "/modele-offre",
      icon: IconFileText,
    },
    {
      title: "Offres",
      url: "/offres",
      icon: IconArchive,
    },
  ]
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="data-[slot=sidebar-menu-button]:p-1.5!"/>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
    </Sidebar>
  )
}