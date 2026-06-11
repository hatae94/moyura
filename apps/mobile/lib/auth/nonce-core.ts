// per-session 브리지 nonce 생성기 (SPEC-MOBILE-002 R-T8/OD-11) — 순수 모듈(expo/RN import 0).
//
// cold-start 마다 1회 생성되는 unguessable nonce 를 만든다. 이 nonce 는 네이티브가 신뢰 origin 채널
// (injectedJavaScriptBeforeContentLoaded)로 웹에 1회 확립하고, 이후 모든 브리지 메시지(양방향)가
// 이 nonce 를 싣는다(R-T8). 동일 page 의 임의 스크립트(서드파티/XSS)는 nonce 를 모르므로
// session:restore 위조(세션 고정)·토큰 탈취가 불가능하다.
//
// 난수원: WebCrypto(globalThis.crypto.getRandomValues)를 우선 사용한다 — node(vitest)·최신 Hermes
// 모두 제공한다. 미지원 런타임에서는 다중 draw Math.random 합성으로 폴백한다(위협 모델상 충분 —
// 공격자는 네이티브 메모리/주입 JS 내용을 관측할 수 없고, nonce 만 추측 불가하면 된다).

/** 128-bit nonce(16바이트) — hex 32자. */
const NONCE_BYTES = 16;

/** 바이트 배열을 소문자 hex 문자열로 변환한다. */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * per-session one-time nonce 를 생성한다(R-T8/OD-11).
 *
 * WebCrypto 가 있으면 CSPRNG(getRandomValues), 없으면 Math.random 다중 draw 폴백으로 16바이트(128-bit)
 * 엔트로피를 만들고 hex 로 인코딩한다.
 *
 * @returns 32자 소문자 hex nonce
 */
export function generateBridgeNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webcrypto && typeof webcrypto.getRandomValues === "function") {
    webcrypto.getRandomValues(bytes);
    return toHex(bytes);
  }
  // 폴백: Math.random 다중 draw(위협 모델상 충분 — nonce 추측 불가성만 요구).
  for (let i = 0; i < NONCE_BYTES; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return toHex(bytes);
}
