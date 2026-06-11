// (main) 그룹 레이아웃 — 세션 가드 + 공유 하단 탭바 (SPEC-MOBILE-003 R-WB1/R-WB3/R-WB4).
//
// 세션 가드(R-WB1): /me 페이지와 동일한 패턴 — Supabase getSession() 으로 쿠키 세션을 읽고,
//   없으면 /login 으로 redirect 한다. (신원의 권위 있는 검증은 백엔드 가드가 수행 — me/page.tsx 참조.)
//
// 셸 모드 감지(R-WB3/R-WB4, flash-free): 하단 탭바는 데스크톱 브라우저에서만 보이고, 네이티브
//   WebView 셸 안에서는 숨긴다(네이티브 탭바와의 이중 탭바 금지). 하이드레이션 flash 를 막기 위해
//   <head> 의 인라인 스크립트가 *콘텐츠 페인트 전에* 셸 여부를 판정해 html[data-shell] 을 세팅한다:
//     - window.__MOYURA_NATIVE_SHELL__ === true (WebViewShell 이 injectedJavaScriptBeforeContentLoaded
//       로 콘텐츠 로드 전 주입) → data-shell="native"
//     - window.ReactNativeWebView 존재(RN WebView 런타임 전역) → data-shell="native" (마커 미도착 fail-safe)
//   둘 다 없는 데스크톱 브라우저는 셸 모드가 확정적으로 부재 → data-shell 미설정 → 탭바 표시(R-WB4).
//   CSS 규칙(globals.css)이 html[data-shell="native"] [data-bottom-tab-bar] { display:none } 으로 숨긴다.
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { BottomTabBar } from "./_components/BottomTabBar";

// R-WB4 fail-safe: 콘텐츠 페인트 전에 실행되는 인라인 스크립트. 네이티브 WebView 안이면(마커 또는
// ReactNativeWebView 전역) 탭바를 숨길 수 있도록 data-shell="native" 를 세팅한다. 데스크톱 브라우저는
// 어느 쪽도 참이 아니므로 속성 미설정 → 탭바가 확정적으로 보인다. try/catch 로 어떤 환경에서도 무해.
const SHELL_DETECT_SCRIPT = `try{if(window.__MOYURA_NATIVE_SHELL__===true||!!window.ReactNativeWebView){document.documentElement.dataset.shell="native"}}catch(e){}`;

export default async function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();

  // getSession() 은 쿠키에서 세션을 읽는다(/me 와 동일 가드 패턴 — R-WB1).
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      {/* R-WB3/R-WB4: 콘텐츠 페인트 전 셸 모드 판정(하이드레이션 flash 없이 탭바 숨김). */}
      <script
        // 인라인 부트스트랩 스크립트 — DOM 페인트 전에 동기 실행되어야 한다(R-WB4).
        dangerouslySetInnerHTML={{ __html: SHELL_DETECT_SCRIPT }}
      />
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      {/* 셸 모드(네이티브 WebView)에서는 globals.css 규칙으로 숨겨진다 — 네이티브 탭바만 표시. */}
      <BottomTabBar notificationCount={2} />
    </div>
  );
}
