// 동적 Expo 설정 (app.json 대체) — dev/prod 변형 분기 + Firebase 설정 EAS 클라우드 주입.
//
// 변형 판별: EAS 빌드 시 EAS_BUILD_PROFILE(프로파일명)이 주입된다.
//   - "production" 프로파일 → prod 변형
//   - 그 외(local / local-sim) 및 로컬 expo start/run(미설정) → dev(debug) 변형
// dev/prod 로 번들 id·패키지·앱 이름을 분기해 두 변형을 한 기기에 공존 설치할 수 있다.
//
// Firebase(FCM) 설정 파일은 EAS Environment Variables(file 타입, environment 별 development/production)
// 에서 주입한다(GOOGLE_SERVICES_JSON / GOOGLE_SERVICES_PLIST) — 로컬 credentials/ 관리 불필요.
import type { ConfigContext, ExpoConfig } from "expo/config";

const IS_PROD = process.env.EAS_BUILD_PROFILE === "production";

// dev/prod 분기 값(번들 id·패키지·앱 이름). debug 변형은 별도 id 라 prod 앱과 공존 설치 가능.
const BUNDLE_ID = IS_PROD ? "com.hatae.moyura" : "com.hatae.moyura.debug";
const APP_NAME = IS_PROD ? "모여라" : "모여라 debug";

// iOS Google Sign-In reversed client scheme — EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID 에서 파생해 변형(dev/prod)
// 별 iOS OAuth 클라이언트와 자동 일치시킨다. 형식: com.googleusercontent.apps.<client-id 앞부분>.
// 변형별 client id 는 EAS env / eas.json 프로파일 / 로컬 .env 의 EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID 로 주입.
// 미설정 시 prod 클라이언트로 폴백(기존 동작 보존).
const IOS_GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const IOS_URL_SCHEME = IOS_GOOGLE_CLIENT_ID
  ? `com.googleusercontent.apps.${IOS_GOOGLE_CLIENT_ID.replace(/\.apps\.googleusercontent\.com$/, "")}`
  : "com.googleusercontent.apps.1069980037272-4k1a3qlvm4ounerhrmcdp4v3vpeodhii";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default (_ctx: ConfigContext): ExpoConfig => ({
  name: APP_NAME,
  slug: "moyura",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "moyura",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
    // Firebase(FCM) — EAS file env(GOOGLE_SERVICES_PLIST, environment 별 dev/prod)에서 주입(미설정 시 생략).
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST,
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    package: BUNDLE_ID,
    // Firebase(FCM) — EAS file env(GOOGLE_SERVICES_JSON, environment 별 dev/prod)에서 주입(미설정 시 생략).
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-secure-store",
    "expo-splash-screen",
    "expo-router",
    [
      "expo-notifications",
      {
        icon: "./assets/icon.png",
        color: "#E6F4FE",
      },
    ],
    [
      "@react-native-google-signin/google-signin",
      {
        // iOS reversed client scheme — 변형별 EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID 에서 파생(위 IOS_URL_SCHEME).
        // dev/prod iOS OAuth 클라이언트가 번들 id 분기와 자동으로 일치한다(env 미설정 시 prod 폴백).
        iosUrlScheme: IOS_URL_SCHEME,
      },
    ],
    "./plugins/withModularHeaders",
  ],
  extra: {
    eas: {
      projectId: "93aad097-382c-4703-97f0-88632529962e",
    },
    router: {},
  },
  owner: "hatae94",
});
