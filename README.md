# HazCargo Mobile (개발 코드명)

> `hazcargo-mobile`은 개발 코드명이며, 실제 앱 이름과 Android package ID는 아직 확정되지 않았습니다.

해상 위험물(IMDG) 검토를 지원하기 위해 개인이 독립적으로 개발·운영하는 공개 Android 앱 프로젝트입니다.

## 기존 프로젝트와의 관계

이 저장소는 회사 내부 프로그램인 `daniel-oh55/DG_ASSISTANT`와 **완전히 분리된 신규 독립 프로젝트**입니다.

- 기존 저장소의 코드, 데이터, 이미지, 문구, 환경변수, 설정 파일을 복사하지 않습니다.
- 기존 시스템의 저장소·DB·API·Supabase·배포 환경을 공유하지 않습니다.
- `DG_ASSISTANT`의 공식 모바일 버전이나 후속 제품이 아닙니다.

자세한 내용은 [docs/PROJECT_BOUNDARY.md](docs/PROJECT_BOUNDARY.md)를 참고하세요.

## 프로젝트 성격

- 개인이 독립적으로 개발·운영하는 공개 앱
- Google Play 스토어 출시 예정
- Android 우선
- 무료 광고형 앱 검토
- 초기 로그인·회원가입 없음

## 기술 스택

- Node.js 24 LTS
- npm
- React + TypeScript (strict mode)
- Vite
- ESLint / Prettier
- Vitest / React Testing Library
- GitHub Actions

이번 단계에서는 Capacitor와 Android 네이티브 프로젝트를 포함하지 않습니다. 앱 이름과 Android package ID가 확정된 이후 다음 PR에서 추가할 예정입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## 테스트 · 빌드

```bash
npm run lint
npm run format:check
npm run test
npm run build
```

## 현재 미구현 기능

- 위험물 Class 안내, UN번호 조회, 격리·혼적 판정의 실제 데이터/로직
- Capacitor 및 Android 네이티브 프로젝트
- Supabase, API 서버 연동
- 로그인/회원가입
- 광고(AdMob) 연동
- 다국어 지원

현재 화면은 방향성 확인을 위한 자리표시자(placeholder)이며, 카드를 눌러도 실제 조회나 판정은 수행되지 않습니다.

## 데이터 안내

IMO 라이선스 및 사용 허가가 확정되기 전까지 실제 IMDG 데이터(원문, 표, UN번호 데이터베이스 등)를 이 저장소에 포함하지 않습니다. 자세한 내용은 [docs/DATA_RIGHTS_POLICY.md](docs/DATA_RIGHTS_POLICY.md)를 참고하세요.
