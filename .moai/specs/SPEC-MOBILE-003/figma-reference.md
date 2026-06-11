# Figma Make 원본 소스 (참조 전용 — 그대로 복사 금지, Next.js 16 + Tailwind v4에 맞게 적응)

Source: https://www.figma.com/make/VDxYuSp4OwOTJuF53c4gnc/One-time-Event-App (접근 검증 2026-06-11)
주의: 이 코드는 Vite 기반 React 웹 프로토타입. apps/web에 적응할 때 Next.js App Router 관용구(서버/클라이언트 컴포넌트 분리, next/link 불필요 — 탭은 Link)로 재구성할 것.
MeetupDetail은 SPEC 제외 — 모임 카드는 탭(클릭) 동작 없이 렌더만.

## 디자인 토큰 (src/styles/theme.css 발췌 — light 모드)

```css
:root {
  --font-size: 16px;
  --font-family: 'Nunito', sans-serif;
  --background: #faf9f7;
  --foreground: #1a1714;
  --card: #ffffff;
  --card-foreground: #1a1714;
  --primary: #ff6b35;
  --primary-foreground: #ffffff;
  --secondary: #fff4ef;
  --secondary-foreground: #c44a1a;
  --muted: #f0ede8;
  --muted-foreground: #8a8074;
  --accent: #fff4ef;
  --accent-foreground: #ff6b35;
  --destructive: #e53935;
  --destructive-foreground: #ffffff;
  --border: rgba(26, 23, 20, 0.08);
  --input-background: #f0ede8;
  --ring: #ff6b35;
  --radius: 1rem;
}
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input-background: var(--input-background);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
```
폰트(Nunito) 도입은 선택 — next/font로 간단히 가능할 때만, 아니면 기존 폰트 유지하고 보고.

## BottomTabBar.tsx (원본)

```tsx
import { Home, Compass, Bell, User } from 'lucide-react';

export type TabId = 'home' | 'explore' | 'notifications' | 'profile';

const TABS = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'explore', label: '탐색', icon: Compass },
  { id: 'notifications', label: '알림', icon: Bell },
  { id: 'profile', label: '마이', icon: User },
];

export function BottomTabBar({ activeTab, onTabChange, notificationCount = 0 }) {
  return (
    <div className="relative bg-card border-t border-border">
      <div className="flex items-stretch">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => onTabChange(tab.id)}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 relative transition-colors">
              <div className="relative">
                <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8}
                  className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                {tab.id === 'notifications' && notificationCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-semibold leading-none ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>
      <div className="h-safe-area-inset-bottom bg-card" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
    </div>
  );
}
```
적응 지침: 웹에서는 button+onTabChange 대신 next/link `<Link href="/home">` 등 라우트 이동으로. activeTab은 usePathname()으로 도출.

## HomeTab.tsx (원본 요약 — 전체 구조 보존)

```tsx
const MOCK_MEETUPS = [
  { id: '1', title: '한강 피크닉 🌸', date: '6월 14일 토요일', time: '오후 3:00', location: '여의도 한강공원', memberCount: 8, maxMembers: 12, status: 'upcoming', emoji: '🌸', coverColor: 'bg-rose-100' },
  { id: '2', title: '팀 회식', date: '6월 12일 목요일', time: '오후 7:00', location: '강남구 논현동', memberCount: 6, maxMembers: 6, status: 'upcoming', emoji: '🍻', coverColor: 'bg-amber-100' },
  { id: '3', title: '등산 모임', date: '5월 25일 일요일', time: '오전 8:00', location: '북한산국립공원', memberCount: 10, maxMembers: 10, status: 'past', emoji: '⛰️', coverColor: 'bg-green-100' },
  { id: '4', title: '보드게임 카페', date: '5월 18일 토요일', time: '오후 2:00', location: '홍대 입구역', memberCount: 5, maxMembers: 8, status: 'past', emoji: '🎲', coverColor: 'bg-purple-100' },
];

// StatusBadge: upcoming='예정'(bg-primary/10 text-primary) | ongoing='진행중'(bg-green-100 text-green-700) | past='완료'(bg-muted text-muted-foreground), rounded-full px-2 py-0.5 text-xs font-semibold

// MeetupCard: bg-card rounded-2xl p-4 shadow-sm border border-border
//  - 좌측: w-12 h-12 rounded-xl {coverColor} 이모지
//  - 우측: 제목(font-bold truncate) + StatusBadge + ChevronRight
//  - Calendar 아이콘 + "{date} {time}", MapPin + location, Users + "{memberCount}/{maxMembers}"
//  - [SPEC 제외] onPress/MeetupDetail 이동 없음 — 렌더 전용

// CreateMeetupButton: bg-primary text-primary-foreground rounded-2xl p-5 flex justify-between shadow-lg shadow-primary/20
//  - "새 모임 만들기" font-bold text-lg / "일정·장소·투표를 한곳에서" text-sm /80
//  - 우측 w-10 h-10 bg-white/20 rounded-xl + Plus 아이콘

export function HomeTab({ user }) {
  // filter: 'all' | 'upcoming' | 'past' (useState — 클라이언트 컴포넌트)
  const displayName = user?.user_metadata?.name || user?.email?.split('@')[0] || '게스트';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후에요' : '좋은 저녁이에요';
  // upcomingCount 배너: Clock 아이콘 + "예정된 모임이 {n}개 있어요" (bg-secondary rounded-xl px-3 py-2)
  // 헤더: px-5 pt-12 pb-5 — greeting 👋 + "{displayName}님"(text-2xl font-extrabold) + 우측 아바타(w-10 h-10 rounded-full bg-primary 이니셜)
  // 스크롤 영역: flex-1 overflow-y-auto px-5 pb-6 — CreateMeetupButton → 필터 칩(전체/예정/완료, rounded-full px-4 py-1.5) → 카드 리스트(gap-3)
  // 빈 상태: 🗓️ + "모임이 없어요" + "위 버튼으로 첫 모임을 만들어보세요!"
}
```

## PlaceholderTab.tsx (원본)

```tsx
export function PlaceholderTab({ emoji, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div className="text-5xl">{emoji}</div>
      <h2 className="text-xl font-extrabold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      <div className="mt-2 px-4 py-1.5 rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        준비 중이에요
      </div>
    </div>
  );
}
```

플레이스홀더 콘텐츠: explore=🔍 탐색 "공개 모임을 찾아보고 참여해보세요. 곧 오픈 예정이에요!" / notifications=🔔 알림 "모임 초대, 일정 변경, 투표 알림을 여기서 확인하세요." / profile=👤 마이 "내 프로필, 참여한 모임 기록을 관리하세요."
