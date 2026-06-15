# 부서 직제 구조 (2026-06-15)

기관 행정전화부는 **직제순**으로 구성한다.

## 모델 (parentId 기반 임의 깊이 트리)
- **최상위(level 0)**: 국 / 실 / 담당관(관) / 소 / 사무국 등은 **모두 같은 레벨**. `parentId = 0`.
- **하위**: `parentId = 상위 부서 id`로 임의 깊이 표현.
  - **국 → 과 → 팀** (3단)
  - **실/관 → 팀** (과 없이 바로 팀)
  - **관/소/사무국 → (직속 인원)** (하위 없이 인원만)
- `level`은 표시용 깊이 힌트(0=부서, 1=과, 2=팀…). 실제 위계는 `parentId`로 계산.
- **직제 정렬**: `sortOrder`(작을수록 위). 목록·부서 칩·조직도 모두 이 순서.
- 인원의 `deptId`는 소속 말단 부서 id(국·실·관 직속이면 그 id, 과/팀이면 그 id).

## 렌더링
- **부서순/전체**: `sortOrder`(직제) 순 섹션.
- **조직도**: `Data.groupedByOrg()`가 `parentId`로 **재귀 트리**(node = {dept, members, children, count})를 만들고,
  `UI.renderOrgView`/`orgNode`가 깊이별로 재귀 렌더(각 레벨 접기, 좌측 트리 라인, 리더 강조, 누적 인원수 배지).

## 데이터 예
```jsonc
{ "id": 10, "name": "기획실",     "parentId": 0,  "level": 0, "sortOrder": 200 }, // 실 = 부서 레벨
{ "id": 11, "name": "기획예산과", "parentId": 10, "level": 1, "sortOrder": 210 }, // 과 = 팀 레벨
{ "id": 12, "name": "감사담당관", "parentId": 0,  "level": 0, "sortOrder": 230 }  // 관 = 국과 동일 레벨
```

실제 명부/직제는 `tools/export_contacts.py`가 SQLite `Department`(parent_id/level/sort_order)에서
이 형식으로 내보낸다.

## 조직도 UI
트리형으로 개선: 상단 요약(총 부서·인원), 부서(국/실/관) 헤더에 **대표(장) 이름·직책 + 인원수 배지**,
하위 과/팀은 **좌측 트리 라인**으로 들여쓰기, **부서·팀 2단 접기**, 리더(장/담당관/위원) 행 강조(좌측 액센트+굵게).
(`UI.renderOrgView`, `.org-*` 스타일)
