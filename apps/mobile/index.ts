// expo-router 커스텀 엔트리 (SPEC-MOBILE-003 R-RT1/R-RT4) — env 가드 보존 + 라우터 부팅.
//
// [HARD] 순서가 계약이다(tasks.md 엔트리 패턴): `./lib/env` side-effect 가 *첫 줄*,
// `expo-router/entry` 가 *마지막 줄*이다. package.json 의 main 은 "index.ts" 로 유지한다 —
// main 을 "expo-router/entry" 로 직접 바꾸면 env 가드 side-effect 가 첫 렌더 전에 실행되지 않아
// EXPO_PUBLIC_API_BASE_URL 미설정 시 silent 하게 잘못된 호스트로 동작한다(R-E4 회귀).
//
// 환경변수 가드를 앱 부팅 경로(엔트리)에서 *먼저* 실행한다 — EXPO_PUBLIC_API_BASE_URL 미설정 시
// API_BASE_URL 평가 단계에서 throw 한다(R-E4/R-RT4). expo-router/entry 보다 반드시 앞서야 한다.
import './lib/env';

// expo-router 진입 — app/ 디렉터리 파일 기반 라우팅을 부팅한다(R-RT1). 마지막 import 여야
// 위 env 가드 side-effect 가 라우터 부팅 전에 평가된다(R-RT4 첫 렌더 전 가드 보존).
import 'expo-router/entry';
