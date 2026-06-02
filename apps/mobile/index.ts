import { registerRootComponent } from 'expo';

// 환경변수 가드를 앱 부팅 경로(엔트리)에서 실행한다.
// EXPO_PUBLIC_API_BASE_URL 미설정 시 API_BASE_URL 평가 단계에서 throw 한다(R-E4).
import './lib/env';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
