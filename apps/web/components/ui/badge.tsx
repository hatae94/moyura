// @MX:NOTE [AUTO] canonical primitive — apps/web 공용 Badge(pill).
// @MX:REASON presentational only. rounded-full pill + tone 배색은 members-section.tsx RoleBadge
// 반복 패턴(bg-gradient-brand-soft/text-gradient-brand, bg-muted 등)에서 그대로 도출했다.
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

export type BadgeTone = "primary" | "muted" | "destructive" | "gradient";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  primary: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
  gradient: "bg-gradient-brand-soft text-gradient-brand",
};

export function Badge({ tone = "muted", className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
