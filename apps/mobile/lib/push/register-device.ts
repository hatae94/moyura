// 디바이스 토큰 등록/해제 얇은 래퍼 (SPEC-CHAT-002 R-PUSH-005/003, T-009) — device-gated.
//
// @MX:NOTE: [AUTO] 토큰 전달은 bridge-protocol 확장이 아니라 REST 직접 등록이다(R-1 — bridge 무수정).
// expo-notifications 로 권한 요청 + 디바이스 push 토큰을 획득하고, SecureStore access token 을 Bearer 로
// POST /devices(등록)/DELETE /devices/:token(해제, 로그아웃 연동) 한다. 순수 결정(페이로드 조립/플랫폼
// 정규화)은 register-device-core.ts 에 위임하고(vitest), 이 래퍼는 expo/RN/REST I/O 만 담당한다.
//
// 주의: Expo Go 는 원격 push 토큰을 발급하지 못한다(dev build 필요 — AC-5 device-gated). 따라서 이 모듈의
// 런타임은 실기기 dev build 에서만 완전 동작하며, 자동 게이트는 tsc(타입 검사)까지다.
// 보안: 토큰 값을 절대 로깅하지 않는다(token-store/bridge 와 동일 원칙).
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { API_BASE_URL } from "../env";
import { loadTokens } from "../auth/token-store";
import {
  buildRegisterDeviceBody,
  normalizePlatform,
  resolveUnregisterToken,
} from "./register-device-core";

// R-3 orphan token 신뢰성: 등록 성공 시 획득한 토큰을 모듈 스코프에 보관한다. 로그아웃 해제는 이 값을
// 사용하고 expo getDevicePushTokenAsync 를 재획득하지 않는다 — 로그아웃 시점에 권한 취소/Expo Go 로
// 재획득이 실패하면 해제가 건너뛰어져 orphan token 이 남기 때문이다(MEDIUM-CRAFT). 앱 인스턴스 수명 동안만
// 유지되는 in-memory 캐시다(콜드스타트에선 다음 로그인 등록이 다시 채운다).
let lastRegisteredToken: string | null = null;

// 디바이스 push 토큰을 획득한다(권한 요청 포함). 권한 거부/획득 실패 시 null(등록 생략 — 비차단).
async function acquireDeviceToken(): Promise<string | null> {
  try {
    const settled = await Notifications.getPermissionsAsync();
    let granted = settled.granted;
    if (!granted && settled.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) {
      // 권한 미허용 — 토큰 미획득(등록 생략). 다음 로그인/포그라운드에서 재시도 가능.
      return null;
    }
    const token = await Notifications.getDevicePushTokenAsync();
    // DevicePushToken.data 는 네이티브에서 문자열(FCM/APNs 토큰). web 은 객체이나 네이티브 앱만 대상이다.
    return typeof token.data === "string" ? token.data : null;
  } catch {
    // 권한/토큰 획득 실패(Expo Go·시뮬레이터·키체인 등) — 비차단으로 흡수(no-op). 토큰 내용 비노출.
    return null;
  }
}

// SecureStore access token 을 Bearer 로 실어 인증 요청을 보낸다(없으면 호출 생략 — 미인증).
async function authedFetch(
  path: string,
  init: RequestInit,
): Promise<Response | null> {
  const tokens = await loadTokens();
  if (!tokens?.access) {
    return null; // 미인증 — 등록/해제 대상 아님(가드가 어차피 401).
  }
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access}`,
    },
  });
}

/**
 * 현재 디바이스의 push 토큰을 백엔드에 등록한다(REQ-PUSH-002, AuthContext signed-in 효과에서 호출).
 *
 * 권한 거부/토큰 미획득/페이로드 조립 실패/미인증이면 조용히 생략한다(비차단 — 로그인 흐름을 막지 않는다).
 * 성공 시 등록된 토큰 문자열을 반환한다(로그아웃 시 해제 대상). 실패는 null 반환 + 비throw.
 *
 * @returns 등록된 디바이스 토큰, 등록하지 못했으면 null
 */
export async function registerDevice(): Promise<string | null> {
  const platform = normalizePlatform(Platform.OS);
  if (!platform) {
    // android/ios 가 아니면 등록 대상 아님(web 등 — 게스트 푸시 비범위).
    return null;
  }
  const rawToken = await acquireDeviceToken();
  if (!rawToken) {
    return null;
  }
  const body = buildRegisterDeviceBody(rawToken, platform);
  if (!body) {
    return null;
  }
  try {
    const res = await authedFetch("/devices", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (res && res.ok) {
      // 등록 성공(2xx) — 토큰을 모듈 스코프에 보관해 로그아웃 해제가 재획득 없이 쓰게 한다(R-3).
      lastRegisteredToken = body.token;
      return body.token;
    }
    return null;
  } catch {
    // 네트워크 실패 — best-effort 비차단(다음 로그인/포그라운드에서 재시도).
    return null;
  }
}

/**
 * 디바이스 토큰을 백엔드에서 해제한다(REQ-PUSH-003 / R-3 — 로그아웃 연동, orphan token 방지).
 *
 * 해제 토큰은 resolveUnregisterToken 으로 결정한다: 명시 인자 > 등록 시 보관한 토큰 > null. expo
 * getDevicePushTokenAsync 를 로그아웃 시점에 재획득하지 않는다 — 권한 취소/Expo Go 에서 재획득이
 * 실패하면 해제가 건너뛰어져 orphan token 이 남기 때문이다(MEDIUM-CRAFT). 보관 토큰도 없으면 no-op.
 * 미인증/네트워크 실패도 비throw 로 흡수한다(로그아웃 흐름 비차단). 성공 시 보관 토큰을 비운다.
 *
 * @param token 해제할 디바이스 토큰(registerDevice 가 돌려준 값). 미지정이면 등록 시 보관한 토큰을 쓴다.
 */
export async function unregisterDevice(token?: string | null): Promise<void> {
  const target = resolveUnregisterToken(token, lastRegisteredToken);
  if (!target) {
    return; // 해제할 토큰 없음(등록한 적 없거나 보관 토큰 부재) — no-op. 재획득하지 않는다(R-3).
  }
  try {
    await authedFetch(`/devices/${encodeURIComponent(target)}`, {
      method: "DELETE",
    });
    // 해제 성공 — 보관 토큰을 비운다(다음 로그인에서 registerDevice 가 다시 채운다).
    lastRegisteredToken = null;
  } catch {
    // 네트워크 실패 — best-effort 비차단. 보관 토큰은 유지해 다음 해제 기회에 재시도한다(orphan 최소화).
  }
}
