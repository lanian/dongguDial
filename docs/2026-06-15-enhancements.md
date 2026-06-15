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

## 4) 부서 관리 (로컬 오버레이) — 추가
- 설정 → **부서 관리**(`#deptmgr`): 부서 직제순 목록(직속 인원·하위부서 수), 탭 시 편집.
- **부서 편집/추가**(`#dept-editor`): 부서명, 상위부서(순환 방지: 자기·자손 제외), 직제 순서(sortOrder). level은 상위 깊이로 자동.
- 저장 위치: `deptEdits`(기본 부서 오버레이) / `deptCustom`(추가 부서). `Data.rebuild`가 부서→연락처 순으로 병합.
- 삭제 가드: 직속 인원 또는 하위 부서가 있으면 삭제 차단.
- 백업 v3에 `deptEdits`/`deptCustom` 포함. 초기화는 연락처+부서 함께.
- 오버레이 처리 일반화: `overlayList()`(중첩 우선순위) 기반 `closeTop`/`topOverlay`/Esc·Tab·popstate.
- 비고: 조직도는 인원 있는 부서만 표시(빈 부서는 부서관리에서 관리). SW 캐시 v11.

## 5) CSV·Excel 가져오기 + id 충돌 수정 — 추가
- `js/import.js`(의존성 없음): CSV 파서(따옴표/CRLF/BOM), XLSX 파서(브라우저 `DecompressionStream('deflate-raw')`로 압축 해제 + 정규식 XML 파싱), CSV 인코딩 자동 판별(UTF-8/CP949).
- 설정 → **연락처 가져오기(CSV·Excel)**: 열 제목 별칭 자동 매핑(이름·부서·상위부서·직책·담당업무·휴대전화·사내번호·생년월일·재직상태), 부서 자동 생성(상위부서로 위계 연결), 재직상태 정규화, 미리 건수 확인. **CSV 양식 다운로드** 제공.
- 버그 수정: `addContact`/`addDept`가 `Date.now()` 기반 id라 **같은 ms 다건 추가 시 id 충돌**(부서가 자기 부모가 되어 조직도 무한 재귀). `uid()`(타임스탬프+증가 카운터)로 해결.
- SW 캐시 v13(import.js 포함).

## 6) 부서 관리 전문가 검토 반영 (시스템설계/UX/코드품질 3팀)
정합성 버그:
- id 타입 혼용(숫자 base/문자열 custom) → 저장 parseInt로 deptId NaN/null 추락 → realDeptId()로 복원
- 부서명 변경 미동기화 → rebuild에서 deptById 기준 dept명 단일 원천화(+사본화로 base 변형 제거)
- 재부모화 자손 level 미갱신 → depthOf(parentId 체인) 동적 깊이
- 부모 삭제 시 자식/인원 누락 → groupedByOrg 고아 루트 승격

UX:
- 직제 순서 ▲▼ 형제 이동(숫자 입력 제거, 편집 시 순서 보존), 하위 추가 프리필,
  삭제 시 상위로 이동(인원 무손실), 빈 부서 안내, 조직도→부서관리 진입

리팩터:
- 연락처/부서 오버레이 CRUD를 overlayStore 팩토리로 일반화(중복 제거)
- membersByDept 맵으로 그룹/카운트 O(n)
- (보류) app.js의 부서관리 컨트롤러 별도 모듈 분리는 회귀 위험·저효용으로 후속 과제

검증: jsdom 시나리오(정합성 9, UX 8, 가져오기/전체대체/3계층) 전부 통과. SW 캐시 v19.

## 7) 사원정보(상세) UI 전문가 검토 반영 (인터랙션·접근성 / 비주얼 2팀, P0~P2)
접근성:
- 다이얼로그 접근명에 사람 이름 설정(detail aria-label)
- 편집/삭제로 목록 재생성 시 포커스 복귀 폴백(document.contains→listEl)
- 값 없는 통신 quick(전화/문자/사내)을 disabled 버튼으로(포커스·시각 비활성), 아바타 약한색 대비 보정(#c2410c→#b45309)
위계·동선:
- 히어로에 재직상태 배지(휴직/파견/교육), quick 통신/유틸(공유·저장) 톤 분리, 라벨 '사내→사내전화'·13px
- 번호 값 자체를 전화 링크로(중복 전화버튼 제거, 복사만), 카드 2섹션(연락처/소속)
- 조직 breadcrumb(국›과›팀) 탭→조직도 이동(Data.deptPath), 부서 대표번호(부서 리더 사내번호) 노출, 즐겨찾기 토글 스낵
비주얼:
- info-row 아이콘 상단 정렬, 다크모드 카드 보더 전환, 히어로 brand 옅은 그라데이션, info-value break-all은 전화행만
검증: jsdom 상세 9/9 + 회귀(정합성9·UX8·가져오기·대체) 통과. SW 캐시 v20.

## 8) 사원 사진 관리 (로컬 + 백업 포함)
- js/photos.js: IndexedDB 영구 저장 + 메모리 캐시(동기 렌더). 미지원 시 캐시 폴백.
- 업로드 시 canvas로 256px 정사각 JPEG 압축(중앙 크롭), 연락처 id별 저장.
- 아바타(목록/상세)에 사진 표시, 없으면 이니셜 폴백. 상세 히어로 사진 탭→확대 뷰어(#photo-viewer, 오버레이 스택 최상위).
- 편집 폼에 사진 선택/제거(미리보기), 저장 시 Photos.set/remove, 연락처 삭제 시 사진 제거.
- 백업(export)에 photos(dataURL map) 포함, import 시 Photos.importMap 복구. 초기화/전체대체 시 Photos.clearAll.
- 부팅 시 Photos.loadAll 후 렌더. SW 캐시 v23(photos.js 포함).
- 검증: jsdom 사진 10/10 + 회귀(정합성9·UX8·상세9·대체) 통과.
