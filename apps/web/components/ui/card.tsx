// @MX:NOTE [AUTO] canonical primitive — apps/web 공용 Card(surface).
// @MX:REASON presentational only. rounded-2xl + bg-card 는 앱 전역 103회 반복 관측(research §1.3)에서
// 도출한 표준 surface 다. globals.css 시맨틱 토큰만 소비하고 인라인 hex/radius 를 하드코딩하지 않는다.
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  /** 상단 슬롯(제목/액션 등) — asChild 없는 단순 slot prop. */
  header?: ReactNode;
  /** 하단 슬롯(액션 바 등). */
  footer?: ReactNode;
  children?: ReactNode;
}

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export function Card({
  padding = "md",
  header,
  footer,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card shadow-sm",
        PADDING_CLASSES[padding],
        className,
      )}
      {...rest}
    >
      {header ? <div className="mb-3 font-semibold text-card-foreground">{header}</div> : null}
      {children}
      {footer ? <div className="mt-3 border-t border-border pt-3">{footer}</div> : null}
    </div>
  );
}
