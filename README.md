# 행정전화부 (dongguDial PWA)

부서별 직원 연락처를 빠르게 찾아 전화·문자할 수 있는 **설치형 웹앱(PWA)**.
Android 앱 `net.donggu.contact` 의 "연락처" 기능을 가볍게 웹으로 옮긴 버전이다.
빌드 도구·프레임워크 없이 **순수 HTML/CSS/바닐라 JS** 로 동작한다.

## 기능

- **부서별 연락처 목록 + 상세** — 부서 → 멤버 정렬 순으로 그룹핑, 상세 화면에서 전화/문자/사내번호 바로 걸기
- **검색** — 이름·부서·팀·직책·업무·전화번호 + 한글 초성 검색 (예: `ㄱㄷㅎ` → 김도현), 결과 하이라이트
- **부서 빠른 이동·접기 / 정렬** — 부서 칩 점프 + 섹션 접기, 부서순↔가나다순 전환(가나다 인덱스)
- **연락처 복사·공유·저장** — 번호 클립보드 복사, Web Share 공유, `.vcf`(vCard) 다운로드로 기기 주소록 저장 (모두 로컬)
- **조직도** — 부서 → 팀 → 인원 트리(부서 접기/펼치기, 처음엔 접힌 채 시작), 기관 조직 구조 한눈에. **사원 순서 편집**: ≡ 핸들을 끌어 같은 부서 내 정렬은 물론 다른 부서 영역으로 끌어 소속까지 변경
- **연락처 편집·추가** — 상세에서 편집(✎), FAB(+)로 추가, 삭제. **모두 기기 로컬 오버레이**로 저장되며 백업에 포함(원본 JSON은 불변, 초기화 가능)
- **부서 관리** — 설정 → 부서 관리에서 부서(국/실/관/과/팀) 추가·수정·삭제(행에서 바로 삭제), 트리 접기/펼치기, ≡ 핸들 드래그로 직제 순서·상위부서 변경. 로컬 오버레이(백업 포함), 인원/하위부서 있는 부서는 상위로 올린 뒤 삭제
- **CSV·Excel 가져오기** — 설정에서 `.csv`/`.xlsx` 명부 일괄 추가. 열 제목 자동 매핑(이름·직책·휴대전화·사내번호·생년월일·재직상태). **조직 위계는 `상위부서`/`부서`/`팀` 계층 열로 자동 구성** — 비어 있지 않은 가장 말단(팀) 부서에 인원 배치, 없는 부서는 체인으로 자동 생성. 한글 인코딩(UTF-8/CP949) 자동 판별, 의존성 없이 브라우저 내장 `DecompressionStream`으로 xlsx 처리. 양식(CSV) 다운로드 제공
- **화면 테마** — 시스템 / 라이트 / 다크 선택(설정)
- **즐겨찾기 / 최근** — 단말 로컬(`localStorage`) 저장, 백엔드 불필요
- **데이터 백업 / 복구** — 설정(⚙)에서 즐겨찾기·최근을 JSON 파일로 내보내기/가져오기(병합). 기기 교체·재설치 시 개인 설정 이전
- **오프라인 / 홈 화면 설치** — Service Worker 캐싱 + Web App Manifest, 네트워크 없이도 동작
- **접근성 / 디자인 시스템** — `:root` 디자인 토큰, 인라인 SVG 아이콘, 탭·다이얼로그 ARIA, 키보드 내비게이션·포커스 관리, 라이트/다크 대비, reduced-motion 대응 (상세: `docs/2026-06-15-uiux-improvements.md`)

> **로컬 전용 원칙**: 모든 사용자 데이터는 기기 안에서만 관리된다. 백업은 서버 업로드가 아니라
> 사용자 기기로의 **파일 다운로드/업로드**이며, 어떤 데이터도 외부로 전송되지 않는다.

## 실행

정적 파일이므로 아무 정적 서버로나 띄우면 된다. (Service Worker 는 `https` 또는 `localhost` 에서만 동작)

```bash
# 예: 파이썬 내장 서버
python3 -m http.server 8000
# → http://localhost:8000
```

## 배포

### GitHub Pages (자동)

`.github/workflows/deploy.yml` 가 포함되어 있어 기본 브랜치에 push 하면 자동 배포된다.

1. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 설정
2. 기본 브랜치(`main`)에 머지/푸시하면 워크플로가 실행되어 배포
   (현재 작업 브랜치 `claude/donggudial-pwa-contacts-vda1jn` 도 트리거에 포함되어 있어, 머지 전에도 테스트 배포 가능)
3. 배포 주소: `https://<계정>.github.io/dongguDial/`

> 모든 경로가 상대 경로(`./`, `js/`, `data/`)라 `/dongguDial/` 같은 서브경로에서도 그대로 동작한다.

### Cloudflare Pages / Netlify (대안)

빌드 단계가 없으므로 설정이 거의 없다.

| 항목 | 값 |
|------|-----|
| Build command | (비움) |
| Build output / Publish directory | `/` (저장소 루트) |

폴더째 올리거나 저장소를 연결하면 바로 서빙된다.

## 데이터

연락처는 정적 JSON `data/contacts.json` 에 들어 있다. (현재는 데모 데이터)

```jsonc
{
  "version": 1,
  "departments": [
    { "id": 20, "name": "행정복지국", "parentId": 0,  "level": 0, "sortOrder": 300 },
    { "id": 21, "name": "자치행정과", "parentId": 20, "level": 1, "sortOrder": 310 }
  ],
  "contacts": [
    {
      "id": 1, "name": "김도현",
      "deptId": 1, "dept": "경영지원본부", "team": "인사팀",
      "position": "본부장", "work": "총괄",
      "phone": "010-1234-5601",   // 휴대전화
      "tel": "02-555-0101",       // 사내번호
      "birth": "1972-03-14",
      "status": "재직",            // 재직 | 휴직 | 파견 | 교육 | 미설정
      "memberSortOrder": 1
    }
  ]
}
```

필드는 Android 앱의 `User` 테이블 / `Sawon` 모델과 동일한 의미를 따른다.

**부서는 직제순으로 구성**된다. `sortOrder`(직제 정렬, 작을수록 위), `parentId`(상위 부서 id, 최상위는 0),
`level`(0=국/실/직속, 1=과/담당관)로 위계를 표현한다. 목록·조직도·부서 칩은 모두 `sortOrder`(직제) 순서를
따르고, 조직도는 **국 → 과 → 인원** 트리로 렌더된다. `contacts[].deptId`는 소속 부서(과 또는 직속 국) id를 가리킨다.

### 실데이터로 교체 — `tools/export_contacts.py`

기존 SQLite DB(`User` + `Department` 테이블)에서 위 형식의 JSON 을 바로 뽑아낸다. (표준 라이브러리만 사용)

```bash
python3 tools/export_contacts.py <평문.sqlite>            # → data/contacts.json
python3 tools/export_contacts.py db.sqlite -o out.json   # 출력 경로 지정
python3 tools/export_contacts.py db.sqlite --include-inactive  # 비활성 부서 포함
```

처리 내용:
- `Department` 의 `sort_order` 순으로 부서 정렬, 기본은 `is_active=1` 만 포함
- `employment_status` 정규화(`재직중`→`재직`, `미입력`→`미설정` 등)
- 이름 없는 행(섹션 헤더/플레이스홀더) 제외
- `dept_id`, `member_sort_order` 순으로 정렬, Department 테이블이 없으면 `dept` 텍스트로 부서 자동 생성

> **운영 DB(`appdb.sqlite`)는 SQLCipher 로 암호화**되어 있다. 먼저 SQLCipher 로
> 복호화한 평문 SQLite 파일을 만든 뒤 이 스크립트에 넘긴다. (복호화 명령 예시는
> 스크립트 상단 docstring 참고)

## 구조

```
index.html              앱 셸 + 마크업
manifest.webmanifest    PWA 매니페스트
sw.js                   Service Worker (오프라인 캐시)
css/styles.css          스타일 (라이트/다크 자동)
js/storage.js           즐겨찾기·최근 (localStorage)
js/data.js              데이터 로드/검색/그룹핑
js/ui.js                목록·상세 렌더링
js/app.js               탭/검색/라우팅/SW 등록/설치 프롬프트
data/contacts.json      연락처 데이터 (교체 대상)
icons/                  PWA 아이콘 (tools/make_icons.py 로 생성)
```

## 아이콘 재생성

앱 아이콘은 **광주광역시 동구 공식 심볼마크**(빨강 태양 + 파랑 까치 'G' + 초록 잎)다.
원본 마크는 공식 CI에서 추출·정리한 `tools/assets/donggu-symbol.png`(투명 PNG)이며,
`make_icons.py`가 흰 배경에 합성해 아이콘을 생성한다.

```bash
pip install pillow           # 1회
python3 tools/make_icons.py  # icons/icon-192·512·maskable-512 생성
```

다른 마크로 교체하려면 `tools/assets/donggu-symbol.png`를 바꾸고 다시 실행하거나,
같은 크기(192/512)의 PNG를 `icons/`에 직접 덮어쓰면 된다.

## 캐시 버전 올리기

`data/contacts.json` 외 셸 파일(JS/CSS/HTML)을 바꾸면 `sw.js` 의 `CACHE` 값을
`donggu-dial-v2` 처럼 올려야 사용자 기기에서 새 버전이 받아진다.
(연락처 데이터는 네트워크 우선 캐시라 버전 변경 없이도 갱신된다.)
