// @MX:NOTE [AUTO] canonical primitive — apps/web 공용 Avatar.
// @MX:REASON presentational only — 네트워크 요청은 없다(image 로드 실패 감지는 순수 브라우저 이벤트).
// rounded-full 은 앱 전역 60회 반복 관측(아바타/필/아이콘버튼)에서 도출. next/image 미의존(REQ-SB-003 —
// react-vite 빌더 유지 근거, CP-1) — img 는 콜사이트가 이미 검증한 URL 을 그대로 렌더하는 표시 전용이다.
"use client";

import { useState } from "react";

import { cn } from "./cn";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  src?: string;
  alt?: string;
  /** 이미지 부재/실패 시 표시할 이니셜 소스 문자열(첫 글자만 사용). */
  fallback?: string;
  size?: AvatarSize;
  /** 스토리링 아바타(gradient-ring 유틸) 래핑 여부. */
  gradientRing?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-13 w-13 text-xl",
};

export function Avatar({
  src,
  alt = "",
  fallback,
  size = "md",
  gradientRing = false,
  className,
}: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(src) && !imageFailed;
  const initial = fallback?.trim().charAt(0).toUpperCase() || "?";

  const circle = (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        showImage ? "bg-muted" : "bg-gradient-brand text-white",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- presentational primitive, next/image 미의존(REQ-SB-003/CP-1)
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );

  if (!gradientRing) return circle;

  return <span className="gradient-ring">{circle}</span>;
}
