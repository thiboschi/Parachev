"use client"

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"

import { cn } from "@/lib/utils"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"

const Combobox = ComboboxPrimitive.Root

const ComboboxValue = ComboboxPrimitive.Value

function ComboboxTrigger({ ...props }: ComboboxPrimitive.Trigger.Props) {
  return <ComboboxPrimitive.Trigger data-slot="combobox-trigger" {...props} />
}

/** Déclencheur au même aspect que `SelectTrigger`. */
function ComboboxSelectTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "flex h-8 w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50",
        className
      )}
      {...props}
    >
      <span className="line-clamp-1 flex flex-1 text-left">{children}</span>
      <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
    </ComboboxPrimitive.Trigger>
  )
}

/** Popup avec, en tête, le champ de recherche qui filtre la liste. */
function ComboboxContent({
  className,
  children,
  placeholder = "Rechercher…",
  vide = "Aucun résultat",
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    placeholder?: string
    /** Texte affiché quand la recherche ne trouve rien. */
    vide?: string
  }) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "z-50 flex max-h-[min(20rem,var(--available-height))] w-(--anchor-width) min-w-36 origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b px-2">
            <SearchIcon className="pointer-events-none size-3.5 shrink-0 text-muted-foreground" />
            <ComboboxPrimitive.Input
              data-slot="combobox-input"
              placeholder={placeholder}
              className="h-8 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ComboboxPrimitive.Empty className="px-2 py-3 text-center text-sm text-muted-foreground empty:hidden">
            {vide}
          </ComboboxPrimitive.Empty>
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "min-h-0 flex-1 scroll-py-1 overflow-y-auto overscroll-contain p-1 empty:hidden",
        className
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

export {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxSelectTrigger,
  ComboboxTrigger,
  ComboboxValue,
}
