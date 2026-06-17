// Expo config plugin — Podfile 에 use_modular_headers! 를 주입한다 (SPEC-MOBILE-004 빌드 인에이블).
//
// 배경: @react-native-google-signin/google-signin 의 iOS 의존 GoogleSignIn 8.x 가 AppCheckCore 를
// 끌어오고, AppCheckCore 는 GoogleUtilities/RecaptchaInterop(모듈 미정의)에 의존한다. Swift static
// 라이브러리로 통합하려면 이들이 module map 을 생성해야 하므로 use_modular_headers! 가 필요하다
// (pod install 의 "do not define modules" 에러 해소). prebuild 가 Podfile 을 재생성하므로 수동 편집
// 대신 이 config plugin 으로 매 prebuild 마다 자동 주입해 영속화한다.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile",
      );
      let contents = fs.readFileSync(podfilePath, "utf8");
      if (!contents.includes("use_modular_headers!")) {
        // Podfile 루트 스코프(target 선언 직전)에 전역 주입한다.
        contents = contents.replace(
          /target 'app' do/,
          "use_modular_headers!\n\ntarget 'app' do",
        );
        fs.writeFileSync(podfilePath, contents);
      }
      return config;
    },
  ]);
};
