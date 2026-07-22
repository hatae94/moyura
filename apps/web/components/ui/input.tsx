// @MX:NOTE [AUTO] canonical primitive — apps/web 공용 Input.
// @MX:REASON presentational only — controlled/uncontrolled 표시만 담당하고 폼 제출/검증 로직은
// 콜사이트가 소유한다(login-form.tsx 패턴 근거). input-background 시맨틱 토큰만 소비한다.
"use client";

import { useId } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, disabled, className, id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-semibold text-foreground">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        className={cn(
          "w-full rounded-2xl border bg-input-background px-4 py-3.5 text-foreground transition-shadow",
          "focus:outline-none focus:ring-2 focus:ring-primary/25",
          error ? "border-destructive focus:border-destructive" : "border-border focus:border-primary",
          disabled && "opacity-50",
          className,
        )}
        {...rest}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
