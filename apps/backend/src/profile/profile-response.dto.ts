import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] /me 응답 스키마. @nestjs/swagger가 이 DTO로 OpenAPI 모델을 생성한다.
// profile의 공개 표현 — id(= Supabase sub)와 createdAt만 노출한다(R-B1 최소 필드).
export class ProfileResponseDto {
  @ApiProperty({
    description: 'Supabase auth user id(`sub`) — profile의 PK',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  id!: string;

  @ApiProperty({
    description: 'profile 최초 생성 시각(ISO-8601)',
    example: '2026-06-02T09:59:34.000Z',
  })
  createdAt!: string;
}
