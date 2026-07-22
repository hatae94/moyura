// @MX:NOTE [AUTO] canonical primitive — apps/web 공용 Button.
// @MX:REASON presentational only(데이터 fetching/네트워크/next//supabase/bridge import 없음)이라
// Storybook 에서 standalone 렌더가 보장된다. globals.css 시맨틱 토큰만 Tailwind 유틸로 소비하고
// 인라인 hex 색/radius 를 하드코딩하지 않는다(SD-1 연기 확정 — 단일출처 globals.css 보존).
"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "./cn";

export type ButtonVariant = "primary" | "gradient" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 비동기 처리 중 여부 — 스피너 표시 + 자동 disable. onClick 의 async 처리 자체는 콜사이트 소유. */
  loading?: boolean;
  children?: ReactNode;
}

// 관측된 반복 패턴 기반(login-form.tsx 등) — 신규 색/값 발명 없이 기존 토큰만 조합한다.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  gradient: "bg-gradient-brand text-white shadow-lg shadow-primary/25",
  secondary: "border border-border bg-card text-foreground shadow-sm hover:bg-muted",
  ghost: "text-muted-foreground hover:text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-2 text-sm gap-1.5",
  md: "px-4 py-3 text-sm gap-2",
  lg: "px-6 py-3.5 text-base gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={cn(
        "inline-flex items-center justify-center rounded-2xl font-bold transition-all active:scale-[0.98]",
        "disabled:opacity-50 disabled:active:scale-100",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
