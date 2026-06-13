import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 느슨한 결합 정적 검사(REQ-PUSH-004 / AC-3). apps/backend/src/chat/** 가 push 모듈을 import하지
// 않음을 소스 트리 정적 스캔으로 보장한다(chat → push 의존 방향 절대 불가 — HARD). push는 chat이
// export한 이벤트 계약(chat-events.ts)에만 단방향 의존한다(역방향 import 0).

const CHAT_DIR = join(__dirname, '..', 'chat');
const PUSH_DIR = __dirname;

// 디렉터리(재귀)의 .ts 파일 목록을 모은다(.spec.ts 포함 — 테스트도 push를 import하면 결합이므로 검사).
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// import/require 문에서 push 모듈을 참조하는 라인을 찾는다('../push' / './push' 경로).
// chat-events.ts import는 chat 자신의 파일이므로 대상이 아니며, push가 chat-events를 import하는 것은 허용이다.
function findPushImports(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf8');
  return content
    .split('\n')
    .filter((line) => {
      const isImportish = /\b(import|require)\b/.test(line);
      if (!isImportish) {
        return false;
      }
      // chat/** 에서 push 디렉터리를 가리키는 상대경로 import 탐지.
      return /from\s+['"]\.{1,2}\/push(\/|['"])/.test(line) || /['"]\.{1,2}\/push(\/|['"])/.test(line);
    });
}

describe('느슨한 결합 정적 검사 (REQ-PUSH-004 / AC-3)', () => {
  it('apps/backend/src/chat/** 는 push 모듈을 import하지 않는다 (chat ↛ push)', () => {
    const chatFiles = collectTsFiles(CHAT_DIR);
    expect(chatFiles.length).toBeGreaterThan(0); // 스캔 대상 존재 보장(빈 디렉터리 통과 방지).

    const violations: string[] = [];
    for (const file of chatFiles) {
      const hits = findPushImports(file);
      if (hits.length > 0) {
        violations.push(`${file}:\n  ${hits.join('\n  ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('push 모듈은 chat-events.ts 계약만 chat에서 import한다 (단방향 — chat.service/controller 미import)', () => {
    const pushFiles = collectTsFiles(PUSH_DIR);
    const forbiddenChatImports: string[] = [];
    for (const file of pushFiles) {
      const content = readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const m = /from\s+['"]\.{1,2}\/chat\/([^'"]+)['"]/.exec(line);
        if (m && m[1] !== 'chat-events') {
          // push가 chat의 service/controller/module 등 계약 외 모듈을 import하면 위반(역결합).
          forbiddenChatImports.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(forbiddenChatImports).toEqual([]);
  });
});
