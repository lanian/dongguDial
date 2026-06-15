# 기능 강화 기록 — 테마/편집/조직도 (2026-06-15)

기관용 행정전화부로서 세 가지 기능을 추가했다. 모두 순수 바닐라 JS(no-build),
사용자 데이터는 기기 로컬에서만 관리한다.

## 1) 화면 테마 (시스템/라이트/다크)
- 설정에 테마 세그먼트. `Storage.getTheme/setTheme`(localStorage).
- `applyTheme()`가 `<html data-theme>`로 적용. CSS는 다크 토큰을
  `html[data-theme="dark"]`(수동) + `@media(prefers-color-scheme:dark) html:not([data-theme])`(시스템)으로 분기.

## 2) 연락처 편집·추가 (로컬 오버레이)
- 원본 `data/contacts.json`은 불변. 사용자 변경은 localStorage 오버레이로 관리:
  - 편집: 기본 연락처는 `edits[id]` 부분 오버레이, 추가 연락처는 `custom[]` 객체 갱신
  - 추가: `custom[]`에 `id="u…"`로 신규
  - 삭제: 커스텀은 제거, 기본은 `edits[id].__deleted`
- `Data.rebuild()`가 base + custom에 오버레이를 병합해 유효 목록 재구성(`_edited`/`_custom` 플래그).
- UI: 상세 편집(✎), FAB(+) 추가, 편집 폼 오버레이(`#editor`), 삭제, 설정의 "편집·추가 초기화".
- 백업(export/import) v2에 `edits`/`custom`/`theme` 포함(구버전 백업도 호환).

## 3) 조직도 (부서 → 팀 → 인원)
- `Data.groupedByOrg()` 부서별 팀 그룹 트리. 탭 "조직도"(`tab-org`).
- `UI.renderOrgView()` 부서 접기/펼치기 + 팀 서브헤더 + 들여쓴 멤버 행.

## 접근성/구조
- 오버레이 3종(상세/설정/편집) 중첩 대응: 포커스 **스택**(push/pop), `topOverlay()` 기준
  Esc·Tab 트랩·popstate, `syncInert()`로 배경 inert 동기화.
- FAB 가시성: 오버레이 없음 + 검색 아님 + (전체|조직도) 탭일 때만.
- SW 캐시 `donggu-dial-v7`.

## 검증
- node 통합 테스트: 조직도 트리, 편집/추가/숨김/초기화, 백업 export v2/import(replace) 라운드트립 통과.
- JS 문법, DOM id·아이콘 심볼·UI 메서드 참조 무결성, 리소스 서빙 200 확인.
