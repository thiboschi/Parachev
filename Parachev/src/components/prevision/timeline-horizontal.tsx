// src/components/timeline-horizontal.tsx
import { cn } from "@/lib/utils"

type TimelineItem = {
  date: string
  title: string
  description?: string
  done?: boolean
}

export function TimelineHorizontal({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="flex w-full">
      {items.map((item, i) => (
        <li key={i} className="relative flex-1">
          {/* Ligne de connexion (sauf dernier) */}
          {i < items.length - 1 && (
            <div className="absolute left-[calc(50%+12px)] right-[calc(-50%+12px)] top-1.25 h-px bg-border" />
          )}
          <div className="flex flex-col items-center text-center gap-2">
            <span
              className={cn(
                "size-2.5 rounded-full ring-4 ring-background",
                item.done ? "bg-primary" : "bg-muted-foreground/40"
              )}
            />
            <div>
              <time className="text-xs text-muted-foreground">{item.date}</time>
              <h3 className="text-sm font-medium leading-tight">{item.title}</h3>
              {item.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.description}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}