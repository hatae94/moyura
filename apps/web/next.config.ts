import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // dev 서버를 LAN IP(모바일 실기기/WebView 검증)로 접근할 때 Next 의 cross-origin dev
  // 보호가 HMR WebSocket 등 _next 리소스를 차단해 하이드레이션이 깨진다. dev 전용 신뢰 오리진을
  // 허용한다(프로덕션 무영향). 다른 개발 머신 IP 는 여기 추가한다.
  allowedDevOrigins: ["192.168.219.102"],
  // @moyura/api-client 는 raw TypeScript 소스를 export 하므로 Next 가 트랜스파일하도록 등록한다.
  transpilePackages: ["@moyura/api-client"],
  // 모노레포 루트를 Turbopack 파일시스템 루트로 고정
  // (홈 디렉터리의 stray lockfile로 인한 워크스페이스 루트 오탐 방지)
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
