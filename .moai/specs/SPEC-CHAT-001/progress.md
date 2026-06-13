# SPEC-CHAT-001 Progress

- Started: 2026-06-13 (autonomous batch, 2/3). Mode: sub-agent sequential, TDD jest, coverage 85%, branch feature/SPEC-MOBILE-004, local-only, auto-proceed.
- Depends: SPEC-MOIM-001 (assertMember, moim_member.nickname — committed). DB :54322 up.
- Complexity vs MOIM: manual SQL migration (trigger broadcast_chat_message security-definer + realtime.messages RLS + chat_message default-deny RLS) via `prisma migrate dev --create-only`; NEW dep @nestjs/event-emitter (pin NestJS 11 compatible); Supabase Realtime Broadcast; web chat UI; CSP wss: in proxy.ts.
- Verification reality: jest covers sendMessage(assertMember 403/insert/event-emit) + getHistory(keyset). Realtime end-to-end (AC-1 propagation) + RLS subscription denial (AC-4) are DB/realtime-level — may need live integration or runtime-gating. Decide status at sync (completed if core automatable + structural realtime verified; in-progress if realtime/RLS genuinely unverifiable auto).
- nickname design (gate): broadcast/event payload EXCLUDES nickname (thin trigger); web resolves senderId→nickname via member list; push (CHAT-002) resolves server-side. Event contract chat-events.ts owned by chat, CHAT-002 one-way depends.
- Strategy phase pending.

## 2026-06-14 구현 완료(TDD jest) — status: in-progress(런타임 게이트 대기)

- T-001~T-010 전부 구현. 백엔드 jest 169 passed(16 suites), 신규 chat 19개(service 8 + integration 11).
- chat 표면 커버리지: stmts 100% / branch 85.71% / funcs 100% / lines 100%(85% 목표 충족).
- 게이트 통과: backend test+typecheck(0 err), api-client generate+typecheck, web lint+typecheck+build, prisma migrate status(no drift).
- psql 존재 단언(실 DB :54322): broadcast_chat_message fn=1, chat_message_broadcast trigger=1, realtime.messages SELECT policy=1, chat_message relrowsecurity=true, content CHECK=1 — 전부 존재.
- 신규 dep: @nestjs/event-emitter@^3.1.0(EventEmitterModule.forRoot()). 마이그레이션: 20260613175232_add_chat(수동 트리거/RLS/CHECK SQL, realtime 정책은 shadow DB 가드).
- 마이그레이션 이슈 해결: Prisma shadow DB는 realtime/auth 스키마 부재 → realtime.messages 정책을 to_regnamespace('realtime') 가드 DO 블록으로 감싸 검증 통과(실 DB에서만 생성).
- 런타임/라이브 검증 대기(자동 게이트 불가 — 디바이스/스택 게이트 원칙): AC-1c(broadcast 종단 수신), AC-4(비멤버 RLS 구독 거부), AC-5(브라우저 런타임 구독). test/chat.live.mts(수동 실행 스크립트) 작성 — CI 게이트 아님. status를 in-progress로 유지(구조적 존재만 psql로 확인).
