// 동적 Expo 설정 — Firebase 설정 파일을 EAS 클라우드 환경변수에서 주입한다.
//
// app.json 을 정적 베이스(ConfigContext.config)로 받아, android/ios 의 googleServicesFile 경로만
// EAS Environment Variables(file 타입, environment 별 development/production)에서 주입한다:
//   - GOOGLE_SERVICES_JSON  → android.googleServicesFile (google-services.json)
//   - GOOGLE_SERVICES_PLIST → ios.googleServicesFile     (GoogleService-Info.plist)
// EAS 빌드 시 file 타입 env 가 파일로 materialize 되어 그 경로가 주입된다 — 로컬 credentials/ 파일을
// 커밋하거나 로컬에서 관리할 필요가 없다. 미설정(env 없음)이면 googleServicesFile 미지정 →
// 순수 JS 빌드/시뮬레이터(FCM 미사용 경로)에는 영향이 없다.
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // ExpoConfig 는 name/slug 필수 — app.json 이 제공하지만 타입상 보강(폴백은 app.json 값과 동일).
  name: config.name ?? "모여라",
  slug: config.slug ?? "moyura",
  android: {
    ...config.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
  },
  ios: {
    ...config.ios,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_PLIST ?? config.ios?.googleServicesFile,
  },
});
