import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // @moyura/api-client 는 raw TypeScript 소스를 export 하므로 Next 가 트랜스파일하도록 등록한다.
  transpilePackages: ["@moyura/api-client"],
  // 모노레포 루트를 Turbopack 파일시스템 루트로 고정
  // (홈 디렉터리의 stray lockfile로 인한 워크스페이스 루트 오탐 방지)
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
