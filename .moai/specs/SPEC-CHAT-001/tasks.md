# Task Decomposition — SPEC-CHAT-001 (모임 채팅 코어)

Approved: 2026-06-13 (autonomous, auto-proceed). TDD jest, coverage 85% on automatable surface. Branch feature/SPEC-MOBILE-004. Local-only.
Corrections: (1) realtime.broadcast_changes 7-arg (level default), internal realtime.send private=true → matches private-channel+RLS design; payload is `payload.record`. (2) BigInt PK → DTO `.toString()` + cursor BigInt() parse (NestJS can't JSON-serialize BigInt). (3) non-existent moim send: assertMember throws 404 → CONVERT to 403 in chat (acceptance edge = 403, non-leak). CSP wss: CONFIRMED needed in proxy.ts connect-src. New dep @nestjs/event-emitter@^3.1.0 (peer ^11 OK). content 400 manual (no class-validator) + DB CHECK.
STATUS TARGET: in-progress (realtime end-to-end AC-1c + RLS subscription AC-4 + browser runtime AC-5 not jest-auto-verifiable; psql asserts existence only; runtime/live verification pending — device-gated principle).

| Task | Description | REQ / AC | Verify tier | Deps | Status |
|------|-------------|----------|-------------|------|--------|
| T-001 | ChatMessage(BigInt PK, @@index([moimId,id desc])) + Moim.messages back-relation | REQ-001/003 | typecheck | - | pending |
| T-002 | add_chat migration --create-only + manual SQL: content CHECK, broadcast_chat_message() security-definer (broadcast_changes 7-arg), chat_message_broadcast AFTER INSERT trigger, realtime.messages SELECT policy (moim_member + realtime.topic()), chat_message RLS enable default-deny [@MX:WARN] | REQ-002/004 | psql existence (auto) + live/manual (behavior) | T-001 | pending |
| T-003 | ChatService.sendMessage(sub,moimId,content) — assertMember (404→403 convert) → insert → row [@MX:ANCHOR] | REQ-001/005 / AC-1a,3 | jest unit | T-001 | pending |
| T-004 | ChatService.getHistory(sub,moimId,{cursor?,limit}) — keyset desc, row[] | REQ-003 / AC-2 | jest unit | T-003 | pending |
| T-005 | chat-events.ts (CHAT_MESSAGE_CREATED + ChatMessageCreatedPayload{messageId:string,moimId,senderId,preview}, NO nickname) [@MX:ANCHOR] + EventEmitterModule.forRoot + @nestjs/event-emitter@^3.1.0 + emit in sendMessage | REQ-001 / AC-1b | jest unit (emit spy) | T-003 | pending |
| T-006 | ChatController(POST/GET /moims/:id/messages, guard) + DTOs(BigInt→string, cursor parse 400) + content 400 + ChatModule(imports Auth,Moim) + app.module + integration spec | REQ-001/003/005 / AC-1a,2,3,400 | jest integration | T-003,004,005 | pending |
| T-007 | web lib/chat/useChatChannel.ts — private channel + setAuth(token) + on broadcast INSERT (payload.record) + cleanup | REQ-006 / AC-5(sub) | web build/lint | - | pending |
| T-008 | web /moims/[id]/chat/page.tsx (member list→nickname map, history, subscribe, send) + proxy.ts wss: in connect-src | REQ-006 / AC-5 | web build/lint + manual | T-007,T-006 | pending |
| T-009 | openapi + api-client regen (generate+typecheck) + gates (jest 85% automatable, backend typecheck, web build+lint) | gates | auto | T-006,T-008 | pending |
| T-010 | psql existence assertions (function/trigger/policy/RLS) + .moai/project/db refresh; (optional) live chat.live.mts for AC-1c/AC-4 behavior | REQ-002/004 / AC-1c,4 | psql auto + live/manual | T-002 | pending |

## MX plan
- @MX:ANCHOR: chat-events.ts contract (CHAT-002 one-way dep), ChatService.sendMessage (entry, emit origin)
- @MX:WARN+REASON: broadcast_chat_message() migration SQL (security-definer + Prisma-diff-invisible drift, realtime schema dep)
- @MX:NOTE: insert→emit order/error-isolation, realtime.messages RLS authz meaning, keyset desc cursor, nickname-resolution-on-consumer design (thin trigger), BigInt string serialization

## Gates
jest 85% (sendMessage/getHistory/controller 400·403·keyset·emit), backend:typecheck 0, api-client:generate+typecheck, web build+lint, psql: broadcast_chat_message fn + chat_message_broadcast trigger + realtime.messages policy + chat_message RLS enabled all exist. AC-1c/AC-4/AC-5 runtime = live/manual (status in-progress).
