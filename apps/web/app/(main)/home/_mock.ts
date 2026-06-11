// /home 모임 카드 mock 데이터 (SPEC-MOBILE-003 R-WB2, Figma Make HomeTab MOCK_MEETUPS).
//
// 실 데이터/API 연동 없음(Exclusions) — 렌더 전용 mock. MeetupDetail 은 후속 SPEC 으로 제외이므로
// 카드는 탭/네비게이션 동작 없이 표시만 한다.

/** 모임 상태 — 필터 칩(전체/예정/완료)과 상태 배지에 매핑된다. */
export type MeetupStatus = "upcoming" | "ongoing" | "past";

export interface Meetup {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  memberCount: number;
  maxMembers: number;
  status: MeetupStatus;
  emoji: string;
  /** 카드 좌측 커버 배경색(Tailwind 유틸 클래스). */
  coverColor: string;
}

export const MOCK_MEETUPS: readonly Meetup[] = [
  {
    id: "1",
    title: "한강 피크닉 🌸",
    date: "6월 14일 토요일",
    time: "오후 3:00",
    location: "여의도 한강공원",
    memberCount: 8,
    maxMembers: 12,
    status: "upcoming",
    emoji: "🌸",
    coverColor: "bg-rose-100",
  },
  {
    id: "2",
    title: "팀 회식",
    date: "6월 12일 목요일",
    time: "오후 7:00",
    location: "강남구 논현동",
    memberCount: 6,
    maxMembers: 6,
    status: "upcoming",
    emoji: "🍻",
    coverColor: "bg-amber-100",
  },
  {
    id: "3",
    title: "등산 모임",
    date: "5월 25일 일요일",
    time: "오전 8:00",
    location: "북한산국립공원",
    memberCount: 10,
    maxMembers: 10,
    status: "past",
    emoji: "⛰️",
    coverColor: "bg-green-100",
  },
  {
    id: "4",
    title: "보드게임 카페",
    date: "5월 18일 토요일",
    time: "오후 2:00",
    location: "홍대 입구역",
    memberCount: 5,
    maxMembers: 8,
    status: "past",
    emoji: "🎲",
    coverColor: "bg-purple-100",
  },
];
