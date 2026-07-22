// 여러 className 후보를 안전하게 합치는 경량 헬퍼(falsy 값 제거).
// clsx/tailwind-merge 는 아직 설치되어 있지 않으므로(신규 의존성 추가 회피), 5 primitive 가
// 공통으로 쓰는 최소 구현을 로컬로 둔다(SPEC-WEB-STORYBOOK-001).
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
