# UI/UX 개선 검토 & 구현 기록 (2026-06-15)

디자인팀(비주얼·디자인 시스템 / 인터랙션·접근성) 2인 검토 결과를 통합해 **P0~P2 전체**를 구현했다.
순수 HTML/CSS/바닐라 JS(no-build) 제약을 유지했다.

## P0 — 접근성·기반
- [x] **디자인 토큰 체계화** — `:root`에 spacing/radius/type/shadow/z + `--brand-rgb`/`--brand-link`/`--badge-alpha` (`css/styles.css`)
- [x] **이모지/문자 아이콘 → 인라인 SVG 스프라이트** — `index.html` `<symbol>` + `.ic{stroke:currentColor}`, `UI.icon()` 헬퍼. 색·정렬·다크모드 일괄 해결
- [x] **탭 ARIA 완성** — `aria-selected`/`aria-controls`/roving `tabindex` + ←→ 키 이동, `main[role=tabpanel]` `aria-labelledby`
- [x] **상세/설정 오버레이 포커스 관리** — `role=dialog aria-modal`, 진입 포커스·복원, 배경 `inert`+`aria-hidden`, 스크롤 잠금, Tab 포커스 트랩
- [x] **Esc로 오버레이/검색 닫기**
- [x] **목록 행 키보드 접근** — `role=button`+`tabindex`+Enter/Space+`focus-visible`, 접근 라벨
- [x] **검색 결과 라이브 안내** — `#result-status[role=status]` sr-only, main의 과도한 aria-live 제거
- [x] **링크/전화번호 명도 대비** — `--brand-link`(라이트 진하게/다크 밝게), `--on-surface-muted` 보강
- [x] **sticky 헤더 safe-area/실측** — `app.js syncStickyOffsets()`가 `--header-h`/`--tabs-h` 실측 갱신

## P1 — 체감 품질
- [x] 검색 **디바운스(120ms)** + `DocumentFragment` 일괄 렌더
- [x] **터치 타깃 44px** (mini-btn/search-clear/tab/toast-dismiss)
- [x] **로딩 스켈레톤** + **에러 재시도 CTA**
- [x] **reduced-motion** 전역 가드
- [x] **다크 theme-color** 분기 + 검색창 토큰화
- [x] **목록 행 즐겨찾기 별 버튼** + 진동 피드백, 상세 별 `aria-pressed`
- [x] **행 전화 발신 시 최근 기록**
- [x] 상태 배지(점+텍스트, 색약 대응)·버튼 시각 통일(`--brand-rgb`)

## P2 — 다듬기
- [x] 장식 이모지/아이콘 `aria-hidden`, quick 비활성 `aria-disabled`
- [x] manifest 보강 — `id`/`display_override`/`categories`/`shortcuts`(즐겨찾기·설정)
- [x] 토스트 토큰화(`--inverse-surface`) + 업데이트 토스트 닫기, 설치/업데이트 동시표시 방지
- [x] info-row 아이콘 정렬·라벨 위계·chevron, 오버스크롤 `contain`
- [x] **앱 아이콘 브랜드 식별성** — 인물 + 비상(빨강 십자) 배지 (`tools/make_icons.py`)
- [x] 죽은 코드 정리 — `formatPhone` 실제 적용(전화번호 하이픈 포맷), `.fav-star` → 행 별버튼으로 대체

## 비고
- 검색 결과 하이라이트(`<mark>`)는 후속 과제로 남김(현재는 평면 결과 + 부서 sub 표기).
- SW 캐시 `donggu-dial-v3`로 상향(셸 파일 변경 반영).
