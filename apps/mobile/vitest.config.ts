// SPEC-MOBILE-001 / SPEC-WEBVIEW-SHELL-001 순수 함수 단위 테스트용 최소 vitest 설정.
//
// 대상은 lib/web-url.ts, lib/auth/oauth-bridge.ts, hooks/*-core.ts 의 순수 TS 함수뿐이다
// (JSX/RN import 없음 → vitest+esbuild 가 RN preset 없이 처리한다).
// App.tsx / oauth.ts / 훅 본체(useAppLifecycle.ts·useAuthBridge.ts) 는 expo/RN 모듈을 import
// 하므로 node 환경 테스트에서 제외한다(추출 분기 로직은 *-core.ts 순수 모듈로 분리해 테스트한다).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "hooks/**/*.test.ts"],
    // web-url.ts 모듈 import 시 평가되는 WEB_URL 부팅 가드를 통과시키기 위한 테스트용 env.
    // (resolveWebUrl 자체는 인자를 받는 순수 함수라 이 값에 의존하지 않는다.)
    env: {
      EXPO_PUBLIC_WEB_URL: "http://localhost:3000",
    },
  },
});
