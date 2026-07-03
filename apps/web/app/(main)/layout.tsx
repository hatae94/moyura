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
import { headers } from "next/headers";

import { createApiClient } from "@moyura/api-client";

import { requireNamedSession } from "@/lib/auth/require-named-session";
import { API_BASE_URL } from "@/lib/env";
import { getUnreadCount } from "@/lib/notifications/api";

import { BottomTabBar } from "./_components/BottomTabBar";
import { NavStateReporter } from "./_components/NavStateReporter";
import { NotificationCountProvider } from "./_components/NotificationCountProvider";
import { ShellModeEffect } from "./_components/ShellModeEffect";
import { ShellSessionAnnouncer } from "./_components/ShellSessionAnnouncer";

// R-WB4 fail-safe: 콘텐츠 페인트 전에 실행되는 인라인 스크립트. 네이티브 WebView 안이면(마커 또는
// ReactNativeWebView 전역) 탭바를 숨길 수 있도록 data-shell="native" 를 세팅한다. 데스크톱 브라우저는
// 어느 쪽도 참이 아니므로 속성 미설정 → 탭바가 확정적으로 보인다. try/catch 로 어떤 환경에서도 무해.
const SHELL_DETECT_SCRIPT = `try{if(window.__MOYURA_NATIVE_SHELL__===true||!!window.ReactNativeWebView){document.documentElement.dataset.shell="native"}}catch(e){}`;

export default async function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // [HARD] CSP nonce(R-T8 연동): proxy.ts 가 요청 헤더에 주입한 per-request x-nonce 를 읽어 인라인
  // 셸 감지 스크립트에 부여한다. nonce 없는 인라인 스크립트는 `'nonce-...' 'strict-dynamic'` CSP 가
  // 차단한다('unsafe-inline' 은 nonce 존재 시 무시됨) — 누락 시 셸 모드 탭바 숨김이 통째로 무력화.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // SPEC-MOBILE-004 REQ-MOB4-004: 세션 가드(R-WB1)에 이름 온보딩 가드를 합친다.
  //   세션 없음 → /login, 세션 있음 + Profile.name 미보유 → /onboarding(이 (main) 그룹 밖).
  // 데스크톱 웹도 이 server-side 가드로 자동 커버된다(AC-7). 미충족 시 내부에서 redirect 한다.
  const { session } = await requireNamedSession();

  // Notifications M4b: 하단 탭 배지의 초기 미읽음 카운트를 서버에서 fetch 한다(하드코딩 mock 대체).
  //   graceful degrade: 조회 실패는 셸 진입을 절대 막지 않는다 → 0(배지 숨김)으로 폴백. 이후 실시간
  //   신호(user:{sub} → NotificationCountProvider 재조회)가 자가 치유한다. 토큰은 Bearer 헤더로만 전달(R-D4).
  let initialUnreadCount = 0;
  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => session.access_token,
    });
    initialUnreadCount = await getUnreadCount(api);
  } catch (err) {
    // 비차단 폴백(0). 관측을 위해 서버 로그만 남긴다(토큰/민감정보 미노출).
    console.error("[moyura/web] 초기 미읽음 알림 카운트 조회 실패 — 배지 0 으로 폴백", err);
  }

  return (
    // Notifications M4b: 셸 전체를 카운트 프로바이더로 감싼다. children(서버 컴포넌트)은 그대로 통과하고,
    //   BottomTabBar 와 M5 알림 탭(children 하위)이 useNotificationCount() 로 실카운트/refresh/reset 을 소비한다.
    <NotificationCountProvider
      initialCount={initialUnreadCount}
      sub={session.user.id}
      accessToken={session.access_token}
    >
      {/* 문서 스크롤 셸: 고정 높이를 두지 않는다. flex-1 로 body(min-h-dvh)를 채워(짧은 콘텐츠도 화면을 채움),
          콘텐츠가 길면 함께 자라 문서가 스크롤된다(→ 브라우저 크롬 접힘). 하단 탭바는 흐름 밖 position:fixed 다. */}
      <div className="flex flex-1 flex-col bg-background">
      {/* R-WB3/R-WB4: 콘텐츠 페인트 전 셸 모드 판정(하이드레이션 flash 없이 탭바 숨김). */}
      <script
        // 인라인 부트스트랩 스크립트 — DOM 페인트 전에 동기 실행되어야 한다(R-WB4).
        // CSP 통과를 위해 per-request nonce 필수(위 주석 참조).
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: SHELL_DETECT_SCRIPT }}
      />
      {/* F2(D-V3): soft-navigation 으로 (main) 진입 시 인라인 스크립트가 재실행되지 않는 갭을 보강.
          데스크톱은 no-op(전역 미존재). 초기 로드 flash-free 는 위 인라인 스크립트가 담당한다. */}
      <ShellModeEffect />
      {/* SPEC-MOBILE-NAV-001 M2(REQ-MOBNAV-010): (main) 그룹의 헤더 필요 route(/home/[id]) 및 나머지
          route 진입/soft-nav 시 nav:state 를 네이티브로 보고한다(셸 모드 한정, 데스크톱 no-op). moims 그룹
          (chat/schedule/expenses/new)은 (main) 밖이라 moims/layout.tsx 가 리포터를 2차 마운트한다.
          비-헤더 route(탭 루트·/me)에서도 보고하지만 네이티브 decideHeader 가 헤더를 숨긴다(REQ-MOBNAV-003)
          — 헤더 페이지를 벗어날 때 헤더를 내리기 위해 오히려 필요한 보고다. 출력 없는 null effect. */}
      <NavStateReporter />
      {/* F1'(D-V2 재수정): (main) 진입 = 서버 검증 세션. 셸 모드면 쿠키 세션을 네이티브로 핸드오버해
          SecureStore 시딩 + (tabs) 마운트를 유발한다. server-action 로그인은 onAuthStateChange 를
          발생시키지 않으므로 이 mount 경로가 필요하다. 데스크톱은 no-op. */}
      <ShellSessionAnnouncer />
      {/* 콘텐츠 영역: 문서 스크롤이므로 overflow-hidden/min-h-0 제거(콘텐츠가 흐름대로 자람). flex-1 로
          짧은 콘텐츠도 화면을 채운다(빈 상태 중앙 정렬 유지). pb-bottom-tab: 하단 고정 탭바에 콘텐츠 끝이
          가리지 않도록 탭바 높이+안전영역만큼 하단 여백(globals.css). data-bottom-tab-spacer: 네이티브 셸
          (탭바 숨김)에서는 이 여백을 0 으로 되돌리는 CSS 규칙의 대상 표식(앱 하단 빈 공간 방지). */}
      <div data-bottom-tab-spacer className="flex flex-1 flex-col pb-bottom-tab">
        {children}
      </div>
        {/* 셸 모드(네이티브 WebView)에서는 globals.css 규칙으로 숨겨진다 — 네이티브 탭바만 표시.
            배지 카운트는 prop 하드코딩이 아니라 NotificationCountProvider 컨텍스트에서 실시간으로 소비한다. */}
        <BottomTabBar />
      </div>
    </NotificationCountProvider>
  );
}
