import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] /me 응답 스키마. @nestjs/swagger가 이 DTO로 OpenAPI 모델을 생성한다.
// profile의 공개 표현 — id(= Supabase sub), name(nullable), createdAt만 노출한다(R-B1 최소 필드).
export class ProfileResponseDto {
  @ApiProperty({
    description: 'Supabase auth user id(`sub`) — profile의 PK',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  id!: string;

  // SPEC-MOBILE-004 T-001: 사용자 표시 이름. 이름 미보유(null) 사용자는 온보딩 가드의 리다이렉트 대상이다.
  // nullable: true 로 openapi-typescript가 `string | null` 타입을 생성하게 한다(웹 가드의 권위 있는 출처).
  @ApiProperty({
    description: '사용자 표시 이름(미보유 시 null — 온보딩 가드 대상)',
    example: '홍길동',
    nullable: true,
    type: String,
  })
  name!: string | null;

  @ApiProperty({
    description: 'profile 최초 생성 시각(ISO-8601)',
    example: '2026-06-02T09:59:34.000Z',
  })
  createdAt!: string;
}
