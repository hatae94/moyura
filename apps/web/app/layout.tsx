import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
// 환경변수 가드를 앱 부팅 경로(root layout)에서 실행한다.
// NEXT_PUBLIC_API_BASE_URL 미설정 시 API_BASE_URL 평가 단계에서 throw 한다(R-E4).
import "@/lib/env";
// SPEC-MOBILE-002 R-T3/R-T4: 네이티브 셸(WebView) 안에서만 토큰 동기화 리스너를 설치한다.
// 일반 브라우저에서는 no-op 이라 순수 웹 동작에 영향이 없다(window.ReactNativeWebView 가드).
import { NativeBridgeProvider } from "@/lib/native-bridge/NativeBridgeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "moyura",
  description: "간편하게 모임을 만들고 일정·장소·투표를 한곳에서",
};

// 웹 줌 비활성화(사용자 요청) — 핀치 줌인/줌아웃 차단 + iOS 인풋 포커스 시 자동 줌인 방지.
// maximumScale=1 + userScalable=false 가 두 동작을 모두 막는다(네이티브 셸 WebView·모바일 브라우저 공통).
// 앱 같은 고정 레이아웃 UX 의도 — 폼/투표/채팅 입력 포커스 시 화면이 확대되지 않는다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // 브랜드 오렌지(globals.css --primary) — 모바일 브라우저 주소창/상태바 틴트를 브랜드와 일치.
  themeColor: "#ff6b35",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // 높이 권위: h-full(=height:100%) 은 모바일 웹에서 정적 large viewport 로 해석돼 인-플로 하단 탭바가
      // 잘리는 100vh 문제를 일으킨다. h-svh-fixed(height:100svh, vh 폴백 — globals.css)로 문서 루트를 small
      // viewport 에 고정해, 아래의 body(min-h-full=100% of svh)·(main) 셸까지 svh 로 일관 정렬한다(문서 스크롤/
      // 하단 여백 없음). 네이티브 WebView 는 크롬이 없어 svh==전체 높이라 무해(탭바는 data-shell CSS 로 숨김).
      className={`${geistSans.variable} ${geistMono.variable} h-svh-fixed antialiased`}
    >
      {/* body min-h-full 은 이제 svh 인 html 에 앵커되어 min-height:100% == svh 로 해석된다(셸보다 큰 높이를
          강제하지 않음 — 셸 아래 빈 공간/문서 스크롤 방지). flex-col 로 자식(셸/풀스크린 페이지)을 세로 배치. */}
      <body className="min-h-full flex flex-col">
        {/* SPEC-MOBILE-002: 네이티브 토큰 동기화 브리지(WebView 안에서만 동작, 일반 브라우저 no-op). */}
        <NativeBridgeProvider />
        {children}
      </body>
    </html>
  );
}
