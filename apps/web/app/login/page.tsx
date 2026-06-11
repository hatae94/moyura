// 로그인/회원가입 페이지 (Server Component, SPEC-LOGIN-UI-001).
//
// Figma Make "Meetup" LoginScreen 디자인을 호스팅한다. 소셜 버튼은 클라이언트 컴포넌트
// 내부의 form + hidden provider 로 기존 signInWithOAuthAction 에 배선되므로(OD-1), 이 페이지는
// 더 이상 소셜 액션을 직접 import 하지 않는다.
//
// OAuth 미배선(R-F3)이나 콜백 음성 경로에서 ?error= 로 복귀하면, 그 값을 initialError 로 전달해
// 이메일 폼 상단 에러 박스에 표시한다(OD-2).
import { LoginForm } from "./login-form";
// SPEC-MOBILE-002 R-R2/OD-10: /login 도착 시 네이티브에 session:cleared 를 1회 통지한다
// (server redirect 와 경합하지 않는 client 지점 — 일반 브라우저면 no-op).
import { LogoutBridgeNotifier } from "@/lib/native-bridge/LogoutBridgeNotifier";

// Next 16: searchParams 는 Promise 다(await 필수).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // size-full 풀스크린 레이아웃을 채우는 LoginScreen 만 호스팅한다(R-H1).
  return (
    <>
      {/* SPEC-MOBILE-002 R-R2/OD-10: 네이티브 SecureStore 토큰 클리어 통지(WebView 안에서만). */}
      <LogoutBridgeNotifier />
      <LoginForm initialError={error} />
    </>
  );
}
