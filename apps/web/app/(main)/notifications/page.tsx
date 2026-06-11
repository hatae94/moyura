// /notifications 플레이스홀더 (SPEC-MOBILE-003 R-WB2) — 기능 없음, 배지만 mock(Exclusions).
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function NotificationsPage() {
  return (
    <PlaceholderTab
      emoji="🔔"
      title="알림"
      description="모임 초대, 일정 변경, 투표 알림을 여기서 확인하세요."
    />
  );
}
