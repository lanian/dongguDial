# 비상연락망 (dongguDial PWA)

부서별 직원 연락처를 빠르게 찾아 전화·문자할 수 있는 **설치형 웹앱(PWA)**.
Android 앱 `net.donggu.contact` 의 "연락처" 기능을 가볍게 웹으로 옮긴 버전이다.
빌드 도구·프레임워크 없이 **순수 HTML/CSS/바닐라 JS** 로 동작한다.

## 기능

- **부서별 연락처 목록 + 상세** — 부서 → 멤버 정렬 순으로 그룹핑, 상세 화면에서 전화/문자/사내번호 바로 걸기
- **검색** — 이름·부서·팀·직책·업무·전화번호 + 한글 초성 검색 (예: `ㄱㄷㅎ` → 김도현)
- **즐겨찾기 / 최근** — 단말 로컬(`localStorage`) 저장, 백엔드 불필요
- **오프라인 / 홈 화면 설치** — Service Worker 캐싱 + Web App Manifest, 네트워크 없이도 동작

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
    { "id": 1, "name": "경영지원본부", "sortOrder": 10 }
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
실데이터로 바꾸려면 이 파일만 교체하면 된다. (예: 기존 SQLite `User` 테이블을 위 형식의 JSON 으로 export)

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

```bash
python3 tools/make_icons.py
```

## 캐시 버전 올리기

`data/contacts.json` 외 셸 파일(JS/CSS/HTML)을 바꾸면 `sw.js` 의 `CACHE` 값을
`donggu-dial-v2` 처럼 올려야 사용자 기기에서 새 버전이 받아진다.
(연락처 데이터는 네트워크 우선 캐시라 버전 변경 없이도 갱신된다.)
