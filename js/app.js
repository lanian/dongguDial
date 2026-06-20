/**
 * 앱 컨트롤러: 탭/검색/상세/설정 라우팅, 접근성(포커스·키보드), 서비스워커, 설치.
 */
(function () {
  "use strict";

  var APP_VERSION = "117"; // SW 캐시(donggu-dial-vNN)와 함께 갱신
  // 조직도 헤더 높이: CSS 토큰(--org-hdr-h)을 단일 소스로 읽어 JS 상수 이중정의(동기화 누락)를 제거
  var ORG_HDR_H = (function () {
    var v = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--org-hdr-h"), 10);
    return v > 0 ? v : 44; // 폴백
  })();
  var listEl = document.getElementById("list");
  var scrollRegion = document.getElementById("scroll-region");
  var resultStatus = document.getElementById("result-status");
  var searchInput = document.getElementById("search-input");
  var searchClear = document.getElementById("search-clear");
  var tabsNav = document.querySelector(".tabs");
  var appBar = document.querySelector(".app-bar");
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var detailEl = document.getElementById("detail");
  var detailBody = document.getElementById("detail-body");
  var detailBack = document.getElementById("detail-back");
  var detailFav = document.getElementById("detail-fav");
  var settingsEl = document.getElementById("settings");
  var editorEl = document.getElementById("editor");
  var editorBody = document.getElementById("editor-body");
  var deptMgrEl = document.getElementById("deptmgr");
  var deptMgrBody = document.getElementById("deptmgr-body");
  var deptEditorEl = document.getElementById("dept-editor");
  var deptEditorBody = document.getElementById("dept-editor-body");
  var deptEditId = null;
  var fab = document.getElementById("fab-add");
  var sortSeg = document.getElementById("sort-seg");
  var alphaRail = document.getElementById("alpha-rail");
  var snackbar = document.getElementById("snackbar");
  var sortBtns = Array.prototype.slice.call(document.querySelectorAll(".sort-seg .seg-btn"));
  var themeBtns = Array.prototype.slice.call(document.querySelectorAll(".theme-seg .seg-btn[data-theme]"));

  var photoViewerEl = document.getElementById("photo-viewer");
  var deptPickerEl = document.getElementById("dept-picker");
  var deptPickerOpts = null;
  var favGroupPickerEl = document.getElementById("fav-group-picker");
  var favGroupPickerContact = null;
  // 접힘 상태는 콜드스타트(PWA 재시작)에도 유지되도록 localStorage 에서 복원한다.
  var _orgStored = Storage.getOrgCollapsed(); // null=한 번도 초기화 안 됨(=첫 진입)
  var current = { tab: "all", query: "", detailId: null, sort: "dept", collapsed: {},
    orgCollapsed: _orgStored || {}, favCollapsed: Storage.getFavCollapsed(),
    orgReorder: false, deptMgrCollapsed: {}, selectMode: false, selected: {} };
  var editId = null;
  var searchPushed = false; // 검색 활성 시 히스토리 항목 push 여부(뒤로가기로 검색어부터 비우기 위함)
  var orgInit = _orgStored !== null; // 저장된 상태가 있으면 '첫 진입 전부 접기'를 건너뜀
  var pendingPhoto; // undefined=변경없음, null=제거, {thumb,full}=새 사진(legacy string도 허용)
  var pendingDefaultIcon; // undefined=변경없음, true=기본 아이콘(실루엣), false=아님
  var bgEls = [appBar, tabsNav, listEl];
  var focusStack = [];

  function pushFocus() { focusStack.push(document.activeElement); }
  function popFocus() {
    var el = focusStack.pop();
    if (el && el !== listEl && document.contains(el) && el.focus) { el.focus(); return; }
    // 복원 대상이 없으면: 키보드 기기·리스트 화면이면 검색창을 선포커스해 한글도 첫 글자부터 입력되게,
    // 그 외에는 리스트 컨테이너로 폴백.
    if (kbDevice && isTypeToSearchContext()) {
      try { searchInput.focus({ preventScroll: true }); } catch (e) { searchInput.focus(); }
    } else if (listEl && listEl.focus) { listEl.focus(); }
  }
  // 오버레이(중첩 가능) — topmost 우선 순서. close 함수는 hoisting됨.
  function overlayList() {
    return [
      { el: favGroupPickerEl, close: closeFavGroupPicker },
      { el: deptPickerEl, close: closeDeptPicker },
      { el: photoViewerEl, close: closePhotoViewer },
      { el: deptEditorEl, close: closeDeptEditor },
      { el: deptMgrEl, close: closeDeptMgr },
      { el: editorEl, close: closeEditor },
      { el: settingsEl, close: closeSettings },
      { el: detailEl, close: closeDetail },
    ];
  }
  function anyOverlayOpen() { return overlayList().some(function (o) { return !o.el.hidden; }); }
  function topOverlayObj() {
    var l = overlayList();
    for (var i = 0; i < l.length; i++) if (!l[i].el.hidden) return l[i];
    return null;
  }
  function topOverlay() { var o = topOverlayObj(); return o ? o.el : null; }
  function closeTop(fromPop) { var o = topOverlayObj(); if (o) o.close(fromPop); }
  // 오버레이를 코드에서 직접 닫을 때 호출하는 history.back(). 이 back 으로 생기는 popstate 는
  // "이미 처리된 우리 back" 이므로 popstate 핸들러가 1회 무시해야 한다(중첩 오버레이에서 아래
  // 오버레이까지 닫히는 것을 방지). 실제 사용자 뒤로가기(state 변화)는 그대로 closeTop 처리.
  var selfPops = 0;
  function backFromOverlay() { selfPops++; history.back(); }
  // 열린 오버레이를 우선순위(topmost-first)대로 z-index 재배치 → DOM 순서와 무관하게 항상 최신이 위
  function restack() {
    var open = overlayList().filter(function (o) { return !o.el.hidden; });
    open.forEach(function (o, i) { o.el.style.zIndex = String(20 + open.length - i); });
  }
  function syncInert() { setBgInert(anyOverlayOpen()); restack(); maybeReloadForUpdate(); }

  // 새 SW가 제어권을 잡았을 때(controllerchange) 보류해 둔 자동 새로고침을, 작업 중이
  // 아닐 때(오버레이/편집기 닫힘) 수행한다. 편집 중 강제 reload로 인한 데이터 손실 방지.
  var swPendingReload = false, swRefreshing = false;
  function maybeReloadForUpdate() {
    if (!swPendingReload || swRefreshing) return;
    if (anyOverlayOpen()) return; // 편집 등 작업 중 — 닫힐 때 다시 시도
    swRefreshing = true;
    window.location.reload();
  }
  function updateFab() {
    // FAB(사원 추가)는 '전체' 탭에서만. 조직도는 보기/구조 전용이라 노출하지 않음
    var show = !anyOverlayOpen() && !current.query && current.tab === "all" && !current.selectMode;
    fab.hidden = !show;
  }

  // ---------- 배경 비활성화(오버레이용) ----------
  function setBgInert(on) {
    bgEls.forEach(function (e) {
      if (on) {
        e.setAttribute("aria-hidden", "true");
        e.setAttribute("inert", "");
      } else {
        e.removeAttribute("aria-hidden");
        e.removeAttribute("inert");
      }
    });
    document.body.classList.toggle("overlay-open", on);
  }

  // ---------- 렌더 ----------
  function onFavChanged() {
    // 즐겨찾기 탭에서 해제 시 목록 갱신 (그 외엔 행 버튼만 갱신)
    if (!current.query && current.tab === "favorites") render();
  }

  // 정렬 세그먼트(앱바)는 전체 탭에서만 노출
  function showTools(on) {
    sortSeg.hidden = !on;
  }
  function showAlphaRail(on) {
    alphaRail.hidden = !on;
  }

  var alphaOffsets = {}; // 초성 → 해당 섹션의 scrollRegion 기준 자연 위치(미리 계산)
  var alphaOrder = [];   // [{key, top}] 위에서 아래 순(현재 위치 표시용)
  function buildAlphaRail(groups) {
    alphaRail.textContent = "";
    alphaOffsets = {};
    alphaOrder = [];
    // 각 섹션 위치를 'sticky 끈 상태'로 한 번에 미리 측정(스크럽 중 매번 측정/리플로우 방지).
    listEl.classList.add("measure-no-sticky");
    var frag = document.createDocumentFragment();
    groups.forEach(function (g) {
      var h = document.getElementById("grp-" + g.key);
      var top = h ? sectionTop(h) : 0;
      alphaOffsets[g.key] = top;
      alphaOrder.push({ key: g.key, top: top });
      var b = document.createElement("button");
      b.type = "button";
      b.className = "alpha-key";
      b.textContent = g.key;
      b.dataset.key = g.key;
      b.setAttribute("aria-label", g.key + "로 이동");
      b.addEventListener("click", function () { jumpToAlpha(g.key); }); // 키보드(Enter)용
      frag.appendChild(b);
    });
    listEl.classList.remove("measure-no-sticky");
    alphaRail.appendChild(frag);
    alphaCurrentKey = null;
    updateCurrentAlpha(); // 초기 현재 위치 표시
  }
  function jumpToAlpha(key) {
    var top = alphaOffsets[key];
    if (top != null) scrollRegion.scrollTo({ top: top, behavior: "auto" });
  }

  // 리스트를 직접 스크롤할 때 현재 구간의 초성을 인덱스바에 자동 표시(스크럽 중엔 스킵).
  var alphaCurrentKey = null, alphaRafPending = false;
  function setCurrentAlphaKey(key) {
    if (key === alphaCurrentKey) return;
    alphaCurrentKey = key;
    var keys = alphaRail.children;
    for (var i = 0; i < keys.length; i++) keys[i].classList.toggle("is-current", keys[i].dataset.key === key);
  }
  function updateCurrentAlpha() {
    if (alphaRail.hidden || alphaScrubbing || !alphaOrder.length) return;
    var y = scrollRegion.scrollTop, cur = alphaOrder[0].key;
    for (var i = 0; i < alphaOrder.length; i++) {
      if (alphaOrder[i].top <= y + 2) cur = alphaOrder[i].key; else break;
    }
    setCurrentAlphaKey(cur);
  }
  scrollRegion.addEventListener("scroll", function () {
    if (alphaRafPending) return;
    alphaRafPending = true;
    requestAnimationFrame(function () { alphaRafPending = false; updateCurrentAlpha(); });
  }, { passive: true });

  // ---------- 가나다 인덱스 바: 드래그 스크럽 + 현재 글자 버블 + 햅틱 ----------
  var alphaBubble = null, alphaActiveKey = null, alphaScrubbing = false;
  function showAlphaBubble(k) {
    if (!alphaBubble) {
      alphaBubble = document.createElement("div");
      alphaBubble.className = "alpha-bubble";
      alphaBubble.setAttribute("aria-hidden", "true");
      document.body.appendChild(alphaBubble);
    }
    alphaBubble.textContent = k;
    alphaBubble.classList.add("is-on");
  }
  function hideAlphaBubble() { if (alphaBubble) alphaBubble.classList.remove("is-on"); }
  // clientY 위치의 인덱스 키(글자)를 찾는다. 위/아래 경계는 첫/마지막 키로 클램프.
  function alphaKeyAt(clientY) {
    var keys = alphaRail.querySelectorAll(".alpha-key");
    if (!keys.length) return null;
    for (var i = 0; i < keys.length; i++) {
      if (clientY <= keys[i].getBoundingClientRect().bottom) return keys[i];
    }
    return keys[keys.length - 1];
  }
  function activateAlphaKey(key) {
    if (!key) return;
    if (key !== alphaActiveKey) {
      if (alphaActiveKey) alphaActiveKey.classList.remove("is-active");
      alphaActiveKey = key;
      key.classList.add("is-active");
      if (navigator.vibrate) navigator.vibrate(3); // 글자 바뀔 때만 짧은 햅틱
    }
    showAlphaBubble(key.dataset.key);
    jumpToAlpha(key.dataset.key); // 미리 측정한 자연 위치로 점프(sticky 왜곡 없음)
  }
  function endAlphaScrub() {
    if (!alphaScrubbing) return;
    alphaScrubbing = false;
    hideAlphaBubble();
    if (alphaActiveKey) { alphaActiveKey.classList.remove("is-active"); alphaActiveKey = null; }
    alphaCurrentKey = null; // 스크럽 후 현재 위치 표시 재동기화
    updateCurrentAlpha();
  }
  function alphaScrubTo(clientY) { activateAlphaKey(alphaKeyAt(clientY)); }
  // 모바일: Touch Events. 터치는 touchstart 대상(레일)으로 move/end가 암묵 캡처되어
  // 손가락이 레일 밖으로 나가거나 어디서 떼든 항상 잡힌다(Pointer 캡처 불필요·더 안정적).
  alphaRail.addEventListener("touchstart", function (e) {
    if (alphaRail.hidden || !e.touches[0]) return;
    alphaScrubbing = true;
    alphaScrubTo(e.touches[0].clientY);
    e.preventDefault(); // 페이지 스크롤 및 합성 click(중복 점프) 방지
  }, { passive: false });
  alphaRail.addEventListener("touchmove", function (e) {
    if (!alphaScrubbing || !e.touches[0]) return;
    alphaScrubTo(e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  alphaRail.addEventListener("touchend", endAlphaScrub);
  alphaRail.addEventListener("touchcancel", endAlphaScrub);
  // 데스크톱: 마우스 드래그(터치 기기에선 touchstart preventDefault로 합성 마우스가 안 옴)
  function onAlphaMouseMove(e) { if (alphaScrubbing) alphaScrubTo(e.clientY); }
  function onAlphaMouseUp() {
    endAlphaScrub();
    document.removeEventListener("mousemove", onAlphaMouseMove);
    document.removeEventListener("mouseup", onAlphaMouseUp);
  }
  alphaRail.addEventListener("mousedown", function (e) {
    if (alphaRail.hidden) return;
    alphaScrubbing = true;
    alphaScrubTo(e.clientY);
    document.addEventListener("mousemove", onAlphaMouseMove);
    document.addEventListener("mouseup", onAlphaMouseUp);
    e.preventDefault();
  });

  // sticky 헤더는 offsetTop/rect 가 스크롤에 따라 '상단에 쌓인 위치'로 왜곡되어
  // 위쪽 섹션 점프가 망가진다. 측정 시 sticky 를 잠깐 꺼서 섹션의 '자연 위치'
  // (scrollRegion 기준)를 정확히 구한다. (한 JS 틱 안이라 화면 깜빡임 없음)
  function sectionTop(el) {
    var top = 0, node = el;
    while (node && node !== scrollRegion) { top += node.offsetTop; node = node.offsetParent; }
    return top;
  }
  function measuredTop(el) {
    listEl.classList.add("measure-no-sticky");
    var top = sectionTop(el);
    listEl.classList.remove("measure-no-sticky");
    return top;
  }
  function scrollToEl(el, behavior, offset) {
    if (!el) return;
    var top = measuredTop(el) - (offset || 0); // offset: 계단식 sticky 헤더에 가리지 않도록 보정
    scrollRegion.scrollTo({ top: Math.max(0, top), behavior: behavior || "smooth" });
  }

  function render() {
    // 렌더 중 예외가 나면 화면 전환이 멈춘 것처럼 보이므로(탭만 활성·리스트 그대로),
    // 오류를 삼키지 말고 화면에 노출해 원인을 바로 파악할 수 있게 한다.
    try {
      renderBody();
    } catch (e) {
      if (window.console && console.error) console.error("[render] 오류:", e);
      try {
        listEl.textContent = "";
        var box = document.createElement("div");
        box.setAttribute("style", "padding:24px;white-space:pre-wrap;font-size:13px;line-height:1.5;color:var(--on-surface)");
        box.textContent = "화면을 그리는 중 오류가 발생했습니다.\n\n" +
          ((e && e.stack) || (e && e.message) || String(e));
        listEl.appendChild(box);
      } catch (e2) {}
    }
    if (current.selectMode) applySelectionToRows(); // 재렌더 후 선택 표시 복원
    updateFab();
  }

  // ---------- 행 sub 텍스트 마퀴(흐름) ----------
  // 평소엔 1줄 말줄임(높이 균일). 마우스 호버 / 키보드 포커스 / 모바일 길게누름(홀드) 시,
  // 그 행의 부서·업무 텍스트가 넘칠 때만 좌우로 흘려 전체를 읽을 수 있게 한다.
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
  function startMarquee(row) {
    if (!row) return;
    if (reduceMotion && reduceMotion.matches) return;
    var sub = row.querySelector(".row-sub");
    if (!sub || sub.classList.contains("is-marquee")) return;
    var overflow = sub.scrollWidth - sub.clientWidth;
    if (overflow <= 4) return; // 다 보이면 흐를 필요 없음
    sub.style.setProperty("--marquee-x", "-" + (overflow + 6) + "px");
    sub.style.setProperty("--marquee-ms", Math.max(1600, overflow * 28) + "ms");
    sub.classList.add("is-marquee");
  }
  function stopMarquee(row) {
    var sub = row && row.querySelector(".row-sub.is-marquee");
    if (!sub) return;
    sub.classList.remove("is-marquee");
    sub.style.removeProperty("--marquee-x");
    sub.style.removeProperty("--marquee-ms");
  }
  function rowOf(e) { return e.target && e.target.closest ? e.target.closest(".row") : null; }
  function leaving(e, row) { return !(e.relatedTarget && row.contains(e.relatedTarget)); }
  function stopAllMarquee() {
    var on = listEl.querySelectorAll(".row-sub.is-marquee");
    for (var i = 0; i < on.length; i++) stopMarquee(on[i].closest(".row"));
  }
  // 데스크톱: 호버. 터치에서 합성되는 가짜 마우스 이벤트는 무시(마퀴가 멈추지 않고 남는 것 방지).
  var lastTouch = 0;
  listEl.addEventListener("mouseover", function (e) {
    if (Date.now() - lastTouch < 600) return;
    var r = rowOf(e); if (r) startMarquee(r);
  });
  listEl.addEventListener("mouseout", function (e) {
    if (Date.now() - lastTouch < 600) return;
    var r = rowOf(e); if (r && leaving(e, r)) stopMarquee(r);
  });
  // 키보드 포커스
  listEl.addEventListener("focusin", function (e) { var r = rowOf(e); if (r) startMarquee(r); });
  listEl.addEventListener("focusout", function (e) { var r = rowOf(e); if (r && leaving(e, r)) stopMarquee(r); });
  // 모바일: 길게 누르면(홀드) 그 행이 흐름. 가볍게 탭하면 평소대로 상세 열림.
  var holdTimer = null, holdRow = null, holdX = 0, holdY = 0;
  function endHold() { clearTimeout(holdTimer); if (holdRow) { stopMarquee(holdRow); holdRow = null; } }
  listEl.addEventListener("touchstart", function (e) {
    lastTouch = Date.now();
    var t = e.touches && e.touches[0]; if (!t) return;
    var r = rowOf(e); if (!r) return;
    holdRow = r; holdX = t.clientX; holdY = t.clientY;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () { if (holdRow) startMarquee(holdRow); }, 350);
  }, { passive: true });
  listEl.addEventListener("touchmove", function (e) {
    var t = e.touches && e.touches[0]; if (!holdRow || !t) return;
    if (Math.abs(t.clientX - holdX) > 10 || Math.abs(t.clientY - holdY) > 10) endHold();
  }, { passive: true });
  listEl.addEventListener("touchend", function () { lastTouch = Date.now(); endHold(); });
  listEl.addEventListener("touchcancel", endHold);
  // 스크롤하면 진행 중인 마퀴 정리(남아있는 애니메이션 방지)
  scrollRegion.addEventListener("scroll", stopAllMarquee, { passive: true });

  // ---------- 행 상호작용 이벤트 위임 ----------
  // 행마다 리스너를 달지 않고 listEl 한 곳에서 처리(긴 목록 재렌더 비용·GC 부담↓).
  // 즐겨찾기(data-act=fav)·전화(data-act=call)는 위임, 그 외 행 클릭은 상세 열기.
  // (그룹지정·최근제거·순서이동 버튼은 자체 리스너에서 stopPropagation 하므로 여기 안 옴.
  //  선택 모드는 캡처 단계 핸들러가 먼저 가로채므로 여기서는 무시한다.)
  listEl.addEventListener("click", function (e) {
    if (current.selectMode) return;
    var t = e.target;
    var actEl = t && t.closest ? t.closest("[data-act]") : null;
    if (actEl && listEl.contains(actEl)) {
      var arow = actEl.closest(".row[data-id]");
      var ac = arow && Data.getById(arow.dataset.id);
      if (!ac) return;
      if (actEl.dataset.act === "fav") {
        var nowFav = Storage.toggleFavorite(ac.id);
        actEl.classList.toggle("is-on", nowFav);
        actEl.setAttribute("aria-pressed", nowFav ? "true" : "false");
        actEl.setAttribute("aria-label", nowFav ? "즐겨찾기 해제" : "즐겨찾기 추가");
        if (navigator.vibrate) navigator.vibrate(10);
        onFavChanged();
      } else if (actEl.dataset.act === "call") {
        Storage.pushRecent(ac.id); // 기본 tel: 동작은 그대로 진행
      }
      return;
    }
    var row = t && t.closest ? t.closest(".row[data-id]") : null;
    if (row) { var c = Data.getById(row.dataset.id); if (c) openDetail(c); }
  });
  listEl.addEventListener("keydown", function (e) {
    if (current.selectMode) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    var row = e.target && e.target.closest ? e.target.closest(".row[data-id]") : null;
    if (!row || e.target !== row) return; // 행 자체 포커스일 때만(내부 버튼은 네이티브 처리)
    e.preventDefault();
    var c = Data.getById(row.dataset.id);
    if (c) openDetail(c);
  });

  function renderBody() {
    var q = current.query.trim();
    if (q) {
      showTools(false); showAlphaRail(false);
      var results = Data.search(q);
      var hlTerms = Data.highlightTerms(q);
      if (results.length && current.sort === "dept") {
        // 부서순일 때는 검색 결과도 부서 섹션으로 묶어서 표시
        UI.renderDeptView(listEl, Data.groupContactsByDept(results), {
          onOpen: openDetail, onFav: onFavChanged, query: hlTerms,
          onDeptJump: showDeptInOrg,
        });
      } else {
        UI.renderFlat(listEl, results, {
          onOpen: openDetail, onFav: onFavChanged, query: hlTerms,
          emptyMsg: "‘" + q + "’ 검색 결과가 없습니다.\n" +
            "연산자: 공백=모두포함 · -제외 · 부서:·직책:·직급:·상태: · \"구\" · |=또는",
        });
      }
      resultStatus.textContent = results.length + "건 검색됨";
      return;
    }
    resultStatus.textContent = "";

    if (current.tab === "all") {
      var allGroups = Data.groupedByDept(); // 비어 있으면 = 연락처 0건
      if (!allGroups.length) {
        showTools(false); showAlphaRail(false);
        listEl.textContent = "";
        listEl.appendChild(UI.onboarding({
          title: "연락처가 비어 있어요",
          msg: "명부 파일(CSV·Excel)을 가져오거나\n오른쪽 아래 + 버튼으로 직접 추가할 수 있어요.",
          actions: [
            { label: "연락처 가져오기", primary: true, onClick: function () {
              document.getElementById("import-contacts-btn").click();
            } },
            { label: "직접 추가", onClick: function () { openEditor(null); } },
          ],
        }));
        return;
      }
      showTools(true);
      if (current.sort === "name") {
        var ng = Data.groupedByName();
        UI.renderNameView(listEl, ng, { onOpen: openDetail, onFav: onFavChanged });
        buildAlphaRail(ng);
        showAlphaRail(true);
      } else {
        showAlphaRail(false);
        UI.renderDeptView(listEl, allGroups, {
          onOpen: openDetail, onFav: onFavChanged,
          onDeptJump: showDeptInOrg,
        });
      }
      return;
    }

    showTools(false); showAlphaRail(false);
    if (current.tab === "org") {
      var depts = Data.getDepartments();
      if (!orgInit) { // 처음 조직도 진입 시 모두 접힌 상태로 시작(이후엔 저장된 상태 복원)
        depts.forEach(function (d) { current.orgCollapsed[d.id] = true; });
        Storage.setOrgCollapsed(current.orgCollapsed); // 키 존재=초기화 표식
        orgInit = true;
      }
      var allCol = depts.length > 0 && depts.every(function (d) { return current.orgCollapsed[d.id]; });
      UI.renderOrgView(listEl, Data.groupedByOrg(), {
        onOpen: openDetail, onFav: onFavChanged,
        collapsed: current.orgCollapsed,
        onToggle: function (id) {
          current.orgCollapsed[id] = !current.orgCollapsed[id];
          Storage.setOrgCollapsed(current.orgCollapsed); // 콜드스타트에도 유지
          var expanded = !current.orgCollapsed[id];
          render();
          // 토글 시 render()가 DOM을 재생성해 포커스가 소실되므로 같은 헤더로 복원하고,
          // 상태 변화를 aria-live(#result-status)로 알려 키보드·스크린리더 위치를 유지한다.
          var h = document.getElementById("org-" + id);
          if (h) {
            h.focus({ preventScroll: true }); // 스크롤은 아래에서 직접 보정
            // 펼친 경우, 계단식 sticky 헤더에 가리지 않도록 깊이만큼 보정해 스크롤(점프 방지)
            if (expanded) {
              var dep = (Data.depthOf ? Math.min(Data.depthOf(id), 2) : 0);
              scrollToEl(h, "smooth", dep * ORG_HDR_H);
            }
          }
          if (resultStatus) resultStatus.textContent = expanded ? "펼침" : "접음";
        },
        onManage: openDeptMgr,
        allCollapsed: allCol,
        onToggleAll: function () {
          var ds = Data.getDepartments();
          var anyOpen = ds.some(function (d) { return !current.orgCollapsed[d.id]; });
          if (anyOpen) ds.forEach(function (d) { current.orgCollapsed[d.id] = true; });
          else current.orgCollapsed = {};
          Storage.setOrgCollapsed(current.orgCollapsed);
          render();
        },
        reorder: current.orgReorder,
        onToggleReorder: function () { current.orgReorder = !current.orgReorder; render(); },
        onMove: moveMember,
        onMoveDept: moveMemberToDept,
      });
    } else if (current.tab === "favorites") {
      showTools(false); showAlphaRail(false);
      UI.renderFavView(listEl, favSections(), {
        onOpen: openDetail, onFav: onFavChanged, onAssign: openFavGroupPicker,
        collapsed: current.favCollapsed,
        onToggle: function (gid) {
          current.favCollapsed[gid] = !current.favCollapsed[gid];
          Storage.setFavCollapsed(current.favCollapsed); // 콜드스타트에도 유지
          render();
        },
        onAddGroup: addFavGroupPrompt,
        onRenameGroup: renameFavGroupPrompt,
        onRemoveGroup: removeFavGroupConfirm,
        onSetColor: setFavGroupColorPrompt,
        onMoveGroup: function (g, dir) { Storage.moveFavGroup(g.id, dir); render(); },
        emptyMsg: "즐겨찾기한 연락처가 없습니다.\n별 아이콘을 눌러 추가하세요.",
        actionLabel: "전체에서 찾기", onAction: function () { switchTab(tabs[0]); },
      });
    } else if (current.tab === "recent") {
      UI.renderRecentView(listEl, recentBuckets(Storage.getRecentEntries()), {
        onOpen: openDetail, onFav: onFavChanged,
        onRemove: function (c) {
          Storage.removeRecent(c.id);
          render();
          showSnack("최근에서 제거됨");
        },
        onClearAll: function () {
          appDialog({ title: "최근 기록 비우기", message: "최근 본 연락처 기록을 모두 비울까요?", okLabel: "비우기", danger: true }).then(function (ok) {
            if (!ok) return;
            Storage.clearRecent();
            render();
            showSnack("최근 기록을 비웠습니다");
          });
        },
        emptyMsg: "최근 본 연락처가 없습니다.",
        actionLabel: "전체에서 찾기", onAction: function () { switchTab(tabs[0]); },
      });
    }
  }

  // 정렬 세그먼트
  sortBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      if (current.sort === b.dataset.sort) return; // 이미 선택된 정렬이면 무시
      current.sort = b.dataset.sort;
      sortBtns.forEach(function (x) {
        var on = x === b;
        x.classList.toggle("is-active", on);
        x.setAttribute("aria-pressed", on ? "true" : "false");
      });
      render();
      scrollRegion.scrollTo({ top: 0 }); // 정렬 바뀌면 맨 위로
    });
  });

  // ---------- 테마 ----------
  function applyTheme(t) {
    var root = document.documentElement;
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme"); // system
  }
  function setThemeUI(t) {
    themeBtns.forEach(function (b) {
      var on = b.dataset.theme === t;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  themeBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      Storage.setTheme(b.dataset.theme);
      applyTheme(b.dataset.theme);
      setThemeUI(b.dataset.theme);
    });
  });
  applyTheme(Storage.getTheme());
  setThemeUI(Storage.getTheme());

  // ---------- 글자 크기(접근성) ----------
  var fontScaleBtns = Array.prototype.slice.call(document.querySelectorAll("#font-scale-seg .seg-btn[data-scale]"));
  function applyFontScale(s) { document.documentElement.style.setProperty("--ui-scale", String(s)); }
  function setFontScaleUI(s) {
    fontScaleBtns.forEach(function (b) {
      var on = b.dataset.scale === String(s);
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  fontScaleBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      Storage.setFontScale(b.dataset.scale);
      applyFontScale(b.dataset.scale);
      setFontScaleUI(b.dataset.scale);
    });
  });
  applyFontScale(Storage.getFontScale());
  setFontScaleUI(Storage.getFontScale());

  // ---------- 프로필 기본 아이콘(실루엣) 전역 표시 ----------
  var defaultIconBtns = Array.prototype.slice.call(document.querySelectorAll("#default-icon-seg .seg-btn"));
  function setDefaultIconUI(on) {
    defaultIconBtns.forEach(function (b) {
      var sel = (b.dataset.defaulticon === "on") === !!on;
      b.classList.toggle("is-active", sel);
      b.setAttribute("aria-pressed", sel ? "true" : "false");
    });
  }
  defaultIconBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      var on = b.dataset.defaulticon === "on";
      Storage.setShowDefaultIcon(on);
      UI.setShowDefaultIcon(on);
      setDefaultIconUI(on);
      render(); // 목록 즉시 갱신
      if (!detailEl.hidden && current.detailId != null) {
        var c = Data.getById(current.detailId);
        if (c) UI.renderDetail(detailBody, c, { onOrg: goToOrg, onPhoto: openPhotoViewer });
      }
    });
  });
  UI.setShowDefaultIcon(Storage.getShowDefaultIcon());
  setDefaultIconUI(Storage.getShowDefaultIcon());

  // 스낵바 (가벼운 피드백)
  var snackTimer;
  function showSnack(msg) {
    snackbar.textContent = msg;
    snackbar.hidden = false;
    snackbar.classList.add("is-on");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(function () {
      snackbar.classList.remove("is-on");
      setTimeout(function () { snackbar.hidden = true; }, 200);
    }, 1600);
  }
  window.showSnack = showSnack;

  // ---------- 상세 ----------
  // 조직도 탭으로 이동 + 해당 부서 경로를 펼치고 스크롤 + 도착 강조. (상세/리스트 공용)
  function showDeptInOrg(deptId) {
    switchTab(tabs[3]); // 조직도
    Data.deptPath(deptId).forEach(function (p) { current.orgCollapsed[p.id] = false; });
    current.orgCollapsed[deptId] = false; // 대상 부서 자체도 펼침
    Storage.setOrgCollapsed(current.orgCollapsed);
    render();
    setTimeout(function () {
      var elH = document.getElementById("org-" + deptId);
      if (!elH) return;
      // 상위(국▸과) 계단식 sticky 헤더에 가리지 않도록 깊이만큼(최대 2단) 아래로 보정
      var depth = (Data.depthOf ? Math.min(Data.depthOf(deptId), 2) : 0);
      scrollToEl(elH, "smooth", depth * ORG_HDR_H);
      // 도착한 부서를 잠깐 강조해 "여기로 왔다"를 시각적으로 알림
      elH.classList.remove("is-flash"); // 연속 점프 시 애니메이션 재시작
      void elH.offsetWidth;             // reflow 강제 → 애니메이션 재트리거
      elH.classList.add("is-flash");
      setTimeout(function () { elH.classList.remove("is-flash"); }, 1300);
    }, 60);
  }
  function goToOrg(deptId) { closeDetail(false); showDeptInOrg(deptId); }

  // ---------- 사진 뷰어 / 압축 ----------
  function openPhotoViewer(dataURL, name) {
    var img = document.getElementById("photo-viewer-img");
    img.src = dataURL; img.alt = (name || "") + " 사진";
    pushFocus(); photoViewerEl.hidden = false; syncInert(); updateFab();
    document.getElementById("photo-viewer-close").focus();
    history.pushState({ photo: true }, "", "#photo");
  }
  function closePhotoViewer(fromPop) {
    photoViewerEl.hidden = true; syncInert(); updateFab(); popFocus();
    document.getElementById("photo-viewer-img").src = "";
    if (!fromPop && location.hash === "#photo") backFromOverlay();
  }
  document.getElementById("photo-viewer-close").addEventListener("click", function () { closePhotoViewer(false); });

  // ---------- 부서 선택 (검색 가능 오버레이) ----------
  function deptPathLabel(id) {
    if (!id || id === "0") return "";
    var p = Data.deptPath(id);
    return p.length ? p.map(function (x) { return x.name; }).join(" › ") : String(id);
  }
  function setPickerBtn(btnId, label) {
    var b = document.getElementById(btnId);
    if (!b) return;
    var v = b.querySelector(".ef-picker-val");
    if (v) v.textContent = label;
  }
  function deptDescendants(id) {
    var set = {};
    if (id == null) return set;
    var byParent = {};
    Data.getDepartments().forEach(function (d) { (byParent[d.parentId || 0] = byParent[d.parentId || 0] || []).push(d.id); });
    (function rec(pid) { (byParent[pid] || []).forEach(function (cid) { if (!set[cid]) { set[cid] = true; rec(cid); } }); })(id);
    return set;
  }
  function renderDeptPickerList(q) {
    UI.renderDeptPicker(document.getElementById("dept-picker-list"), {
      departments: Data.getDepartments(),
      query: q,
      currentId: deptPickerOpts.currentId,
      exclude: deptPickerOpts.exclude,
      allowNone: deptPickerOpts.allowNone,
      noneLabel: deptPickerOpts.noneLabel,
      onPick: function (id, path) { deptPickerOpts.onPick(id, path); closeDeptPicker(false); },
    });
  }
  function openDeptPicker(opts) {
    deptPickerOpts = opts;
    document.getElementById("dept-picker-title").textContent = opts.title || "부서 선택";
    var s = document.getElementById("dept-picker-search");
    s.value = "";
    renderDeptPickerList("");
    pushFocus();
    deptPickerEl.hidden = false;
    syncInert(); updateFab();
    document.getElementById("dept-picker-list").scrollTop = 0;
    s.focus();
    history.pushState({ deptpick: true }, "", "#dept-pick");
  }
  function closeDeptPicker(fromPop) {
    deptPickerEl.hidden = true;
    syncInert(); updateFab(); popFocus();
    if (!fromPop && location.hash === "#dept-pick") backFromOverlay();
  }
  document.getElementById("dept-picker-back").addEventListener("click", function () { closeDeptPicker(false); });
  var deptPickSearchTimer;
  document.getElementById("dept-picker-search").addEventListener("input", function () {
    var v = this.value;
    clearTimeout(deptPickSearchTimer);
    deptPickSearchTimer = setTimeout(function () { renderDeptPickerList(v); }, 120);
  });

  // ---------- 즐겨찾기 그룹 ----------
  // 즐겨찾기를 그룹별 섹션 + 미분류로 구성
  function favSections() {
    var favIds = Storage.getFavorites();
    var resolved = Data.resolveIds(favIds);
    var byId = {};
    resolved.forEach(function (c) { byId[c.id] = c; });
    var groups = Storage.getFavGroups();
    var gidSet = {};
    groups.forEach(function (g) { gidSet[g.id] = true; });
    var map = Storage.getFavGroupMap();
    function groupsOf(id) {
      return (map[id] || []).filter(function (gid) { return gidSet[gid]; });
    }
    var sections = groups.map(function (g) {
      var members = favIds
        .filter(function (id) { return byId[id] && groupsOf(id).indexOf(g.id) !== -1; })
        .map(function (id) { return byId[id]; });
      return { group: g, members: members };
    });
    var ungrouped = favIds
      .filter(function (id) { return byId[id] && groupsOf(id).length === 0; })
      .map(function (id) { return byId[id]; });
    return { sections: sections, ungrouped: ungrouped, total: resolved.length };
  }
  // 최근 항목을 날짜 구간으로 묶는다(오늘/어제/이번 주/이전). ts=0(레거시)은 '이전'.
  function recentBuckets(entries) {
    var byId = {};
    Data.resolveIds(entries.map(function (e) { return e.id; }))
      .forEach(function (c) { byId[c.id] = c; });
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var startYesterday = startToday - 86400000;
    var startWeek = startToday - 6 * 86400000; // 오늘 포함 최근 7일
    var buckets = [
      { key: "today", label: "오늘", members: [] },
      { key: "yesterday", label: "어제", members: [] },
      { key: "week", label: "이번 주", members: [] },
      { key: "older", label: "이전", members: [] },
    ];
    entries.forEach(function (e) {
      var c = byId[e.id];
      if (!c) return;
      var ts = e.ts || 0, b;
      if (ts >= startToday) b = buckets[0];
      else if (ts >= startYesterday) b = buckets[1];
      else if (ts >= startWeek) b = buckets[2];
      else b = buckets[3];
      b.members.push(c);
    });
    return buckets.filter(function (b) { return b.members.length; });
  }

  // 인앱 모달 다이얼로그(네이티브 prompt/confirm/alert 대체).
  // opts.value 가 있으면 입력형(확인 시 trim 문자열 반환), 없으면 확인형(true 반환). 취소·Esc·배경클릭 → null.
  function appDialog(opts) {
    opts = opts || {};
    var prevFocus = document.activeElement;
    function mk(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    return new Promise(function (resolve) {
      var backdrop = mk("div", "app-dialog-backdrop");
      var card = mk("div", "app-dialog");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      if (opts.title) {
        var h = mk("h2", "app-dialog-title", opts.title);
        h.id = "app-dialog-title";
        card.setAttribute("aria-labelledby", h.id);
        card.appendChild(h);
      }
      if (opts.message) card.appendChild(mk("p", "app-dialog-msg", opts.message));
      // 색상 스와치 모드: 스와치 클릭 = 즉시 선택(키 반환). 입력/확인 버튼 없이 동작.
      var swatchWrap = null;
      if (opts.swatches) {
        swatchWrap = mk("div", "app-dialog-swatches");
        opts.swatches.forEach(function (s) {
          var sel = s.key === opts.swatchValue;
          var b = mk("button", "swatch swatch--" + s.key + (sel ? " is-sel" : ""));
          b.type = "button";
          b.setAttribute("aria-label", s.label);
          b.setAttribute("aria-pressed", sel ? "true" : "false");
          b.addEventListener("click", function () { done(s.key); });
          swatchWrap.appendChild(b);
        });
        card.appendChild(swatchWrap);
      }
      var hasInput = opts.value !== undefined;
      var input = null;
      if (hasInput) {
        input = mk("input", "app-dialog-input");
        input.type = opts.inputType || "text";
        if (opts.inputMode) input.inputMode = opts.inputMode;
        if (opts.autocomplete) input.autocomplete = opts.autocomplete;
        input.value = opts.value || "";
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.maxLength = opts.maxLength || 30;
        card.appendChild(input);
      }
      var btns = mk("div", "app-dialog-btns");
      var cancelBtn = mk("button", "app-dialog-btn", opts.cancelLabel || "취소");
      cancelBtn.type = "button";
      var okBtn = mk("button", "app-dialog-btn app-dialog-ok" + (opts.danger ? " is-danger" : ""), opts.okLabel || "확인");
      okBtn.type = "button";
      btns.appendChild(cancelBtn);
      if (!opts.swatches) btns.appendChild(okBtn); // 스와치 모드는 확인 버튼 불필요(클릭=선택)
      card.appendChild(btns);
      backdrop.appendChild(card);
      // 소프트 키보드가 올라오면 visualViewport 높이가 줄어듦 → 보이는 영역에 카드를 다시 맞춰 가림 방지
      var vv = window.visualViewport;
      function fitViewport() {
        if (!vv) return;
        backdrop.style.top = vv.offsetTop + "px";
        backdrop.style.bottom = "auto";
        backdrop.style.height = vv.height + "px";
      }
      function done(result) {
        document.removeEventListener("keydown", onKey, true);
        if (vv) { vv.removeEventListener("resize", fitViewport); vv.removeEventListener("scroll", fitViewport); }
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
        resolve(result);
      }
      function confirm() {
        if (hasInput) {
          var v = input.value.trim();
          if (!v) { input.focus(); return; }
          done(v);
        } else done(true);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === "Enter" && !opts.swatches) { e.preventDefault(); e.stopPropagation(); confirm(); }
      }
      cancelBtn.addEventListener("click", function () { done(null); });
      okBtn.addEventListener("click", confirm);
      backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) done(null); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(backdrop);
      if (vv) { vv.addEventListener("resize", fitViewport); vv.addEventListener("scroll", fitViewport); fitViewport(); }
      (hasInput ? input : (swatchWrap ? swatchWrap.firstChild : okBtn)).focus();
      if (hasInput) input.select();
    });
  }

  // ---------- 접근 잠금(지문/PIN) ----------
  var lockScreen = document.getElementById("lock-screen");
  var lockSub = document.getElementById("lock-sub");
  var lockBioBtn = document.getElementById("lock-bio-btn");
  var lockPinForm = document.getElementById("lock-pin-form");
  var lockPinInput = document.getElementById("lock-pin-input");
  var lockUsePinBtn = document.getElementById("lock-usepin-btn");
  var isLocked = false;
  var lockHiddenAt = 0;
  var LOCK_GRACE_MS = 60 * 1000; // 백그라운드 60초 초과 시 재잠금

  function lockConfigured() {
    return Storage.isLockEnabled() && !!Storage.getLockPin();
  }
  function canUseBio() {
    return !!(Storage.getLockCred() && window.Lock && Lock.isSupported());
  }
  function verifyPin(pin) {
    var rec = Storage.getLockPin();
    if (!rec) return Promise.resolve(false);
    return Lock.hashPin(pin, rec.salt).then(function (r) { return r.hash === rec.hash; });
  }
  // ---------- PIN 무차별 대입 방지(시도 제한 + 지수 지연) ----------
  function lockoutRemainingMs() {
    var rec = Storage.getLockFails();
    return rec && rec.lockedUntil ? Math.max(0, rec.lockedUntil - Date.now()) : 0;
  }
  function registerPinFail() {
    var rec = Storage.getLockFails() || { count: 0, lockedUntil: 0 };
    rec.count = (rec.count || 0) + 1;
    if (rec.count >= 5) { // 5회부터 지수 지연: 30초→1분→2분… 최대 30분
      var delay = Math.min(30 * 60 * 1000, 30 * 1000 * Math.pow(2, rec.count - 5));
      rec.lockedUntil = Date.now() + delay;
    }
    Storage.setLockFails(rec);
    return rec;
  }
  function registerPinSuccess() { Storage.setLockFails({ count: 0, lockedUntil: 0 }); }
  function fmtRemain(ms) { var s = Math.ceil(ms / 1000); return s < 60 ? s + "초" : Math.ceil(s / 60) + "분"; }

  function showLockScreen() {
    if (isLocked) return;
    isLocked = true;
    lockScreen.hidden = false;
    document.body.classList.add("is-locked");
    lockPinForm.hidden = true;
    lockBioBtn.hidden = !canUseBio();
    lockUsePinBtn.hidden = false;
    if (canUseBio()) startBio(); else showPinEntry();
  }
  function startBio() {
    lockSub.textContent = "지문을 인식해 주세요…";
    Lock.verify(Storage.getLockCred()).then(function () { doUnlock(); })
      .catch(function () { lockSub.textContent = "지문 인증 실패 — 다시 시도하거나 PIN을 입력하세요."; });
  }
  function showPinEntry() {
    lockPinForm.hidden = false;
    lockUsePinBtn.hidden = true;
    lockSub.textContent = "PIN을 입력해 잠금을 해제하세요";
    lockPinInput.value = "";
    setTimeout(function () { lockPinInput.focus(); }, 60);
  }
  function doUnlock() {
    isLocked = false;
    lockScreen.hidden = true;
    document.body.classList.remove("is-locked");
    lockPinInput.value = "";
  }
  lockBioBtn.addEventListener("click", startBio);
  lockUsePinBtn.addEventListener("click", showPinEntry);
  lockPinForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var rem = lockoutRemainingMs();
    if (rem > 0) { lockSub.textContent = "시도가 많아 잠겼습니다. " + fmtRemain(rem) + " 후 다시 시도하세요."; lockPinInput.value = ""; return; }
    var pin = lockPinInput.value.trim();
    if (!pin) return;
    verifyPin(pin).then(function (ok) {
      if (ok) { registerPinSuccess(); doUnlock(); return; }
      var r = registerPinFail();
      var rem2 = lockoutRemainingMs();
      lockSub.textContent = rem2 > 0
        ? "PIN을 " + r.count + "회 틀렸습니다. " + fmtRemain(rem2) + " 후 다시 시도하세요."
        : "PIN이 올바르지 않습니다 (" + r.count + "회 실패)";
      lockPinInput.value = ""; lockPinInput.focus();
    });
  });

  // 새 PIN 설정(입력 → 확인). 성공 시 저장하고 true 로 resolve.
  function promptNewPin() {
    return appDialog({ title: "PIN 설정", value: "", placeholder: "숫자 4~8자리", okLabel: "다음", inputType: "password", inputMode: "numeric", autocomplete: "off", maxLength: 8 }).then(function (pin) {
      if (!pin) return false;
      if (!/^\d{4,8}$/.test(pin)) { showSnack("PIN은 숫자 4~8자리"); return promptNewPin(); }
      return appDialog({ title: "PIN 확인", value: "", placeholder: "다시 입력", okLabel: "저장", inputType: "password", inputMode: "numeric", autocomplete: "off", maxLength: 8 }).then(function (pin2) {
        if (!pin2) return false;
        if (pin2 !== pin) { showSnack("PIN이 일치하지 않습니다"); return promptNewPin(); }
        return Lock.hashPin(pin).then(function (rec) { Storage.setLockPin(rec); registerPinSuccess(); return true; });
      });
    });
  }
  // 현재 사용자 확인(PIN). 잠금 해제·PIN 변경 전 본인 확인용.
  function requireAuth(title) {
    var rem = lockoutRemainingMs();
    if (rem > 0) { showSnack("시도가 많아 잠겼습니다. " + fmtRemain(rem) + " 후 다시 시도하세요."); return Promise.resolve(false); }
    return appDialog({ title: title, message: "PIN을 입력하세요", value: "", placeholder: "PIN", okLabel: "확인", inputType: "password", inputMode: "numeric", autocomplete: "off", maxLength: 8 }).then(function (pin) {
      if (!pin) return false;
      return verifyPin(pin).then(function (ok) {
        if (ok) { registerPinSuccess(); return true; }
        registerPinFail();
        showSnack("PIN이 올바르지 않습니다");
        return requireAuth(title);
      });
    });
  }

  function enableLock() {
    if (!window.Lock) { showSnack("이 브라우저에서 잠금을 쓸 수 없습니다"); updateLockUI(); return; }
    var finish = function (useBio, credId) {
      promptNewPin().then(function (ok) {
        if (!ok) { updateLockUI(); return; } // PIN 미설정 → 활성화 취소
        Storage.setLockCred(credId || null);
        Storage.setLockEnabled(true);
        updateLockUI();
        showSnack(useBio ? "지문 잠금이 켜졌습니다" : "PIN 잠금이 켜졌습니다");
      });
    };
    Lock.platformAvailable().then(function (avail) {
      if (avail && Lock.isSupported()) {
        Lock.register().then(function (credId) { finish(true, credId); })
          .catch(function () {
            appDialog({ title: "지문 등록 실패", message: "지문을 등록하지 못했습니다.\nPIN만으로 잠금을 설정할까요?", okLabel: "PIN으로 설정" })
              .then(function (ok) { if (ok) finish(false, null); else updateLockUI(); });
          });
      } else {
        appDialog({ title: "지문 미지원", message: "이 기기·브라우저는 생체인증을 지원하지 않습니다.\nPIN만으로 잠금을 설정할까요?", okLabel: "PIN으로 설정" })
          .then(function (ok) { if (ok) finish(false, null); else updateLockUI(); });
      }
    });
  }
  function disableLock() {
    requireAuth("잠금 해제 확인").then(function (ok) {
      if (!ok) { updateLockUI(); return; }
      Storage.clearLock();
      updateLockUI();
      showSnack("잠금이 해제되었습니다");
    });
  }
  function updateLockUI() {
    var on = lockConfigured();
    var sw = document.getElementById("lock-switch");
    if (sw) sw.setAttribute("aria-checked", on ? "true" : "false");
    var status = document.getElementById("lock-status");
    if (status) status.textContent = on ? (Storage.getLockCred() ? "사용 중 (지문 + PIN)" : "사용 중 (PIN)") : "사용 안 함";
    var chg = document.getElementById("lock-changepin-btn");
    if (chg) chg.hidden = !on;
  }
  (function wireLockSettings() {
    var sw = document.getElementById("lock-switch");
    if (sw) {
      sw.addEventListener("click", function () {
        // 실제 상태 기준으로 토글(켜기는 지문 등록·PIN 설정이 필요하므로 완료/취소 후 updateLockUI가 상태 반영)
        if (lockConfigured()) disableLock(); else enableLock();
      });
    }
    var chg = document.getElementById("lock-changepin-btn");
    if (chg) chg.addEventListener("click", function () {
      requireAuth("PIN 변경 — 현재 PIN 확인").then(function (ok) {
        if (!ok) return;
        promptNewPin().then(function (done) { if (done) showSnack("PIN이 변경되었습니다"); });
      });
    });
    updateLockUI();
  })();

  // 백그라운드 복귀 시 유예시간 초과면 재잠금
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      if (!isLocked) lockHiddenAt = Date.now();
    } else if (document.visibilityState === "visible") {
      if (!isLocked && lockConfigured() && lockHiddenAt && (Date.now() - lockHiddenAt) > LOCK_GRACE_MS) {
        showLockScreen();
      }
    }
  });
  // 실행 시 잠금
  if (lockConfigured()) showLockScreen();

  // 새 그룹에 자동으로 구분되는 색을 배정(무채색 제외, 기존 그룹 수만큼 회전)
  function nextFavColor() {
    var palette = UI.FAV_COLORS.filter(function (c) { return c.key !== "none"; });
    var n = Storage.getFavGroups().length;
    return palette[n % palette.length].key;
  }
  function addFavGroupPrompt() {
    appDialog({ title: "새 그룹", value: "", placeholder: "그룹 이름", okLabel: "추가" }).then(function (name) {
      if (!name) return;
      Storage.addFavGroup(name, nextFavColor());
      render();
      showSnack("그룹 ‘" + name + "’ 추가됨");
    });
  }
  function renameFavGroupPrompt(g) {
    appDialog({ title: "그룹 이름 변경", value: g.name, placeholder: "그룹 이름", okLabel: "저장" }).then(function (name) {
      if (!name) return;
      Storage.renameFavGroup(g.id, name);
      if (!favGroupPickerEl.hidden) renderFavGroupPickerList();
      render();
    });
  }
  function setFavGroupColorPrompt(g) {
    appDialog({
      title: "그룹 색상",
      message: "‘" + g.name + "’ 그룹의 색을 선택하세요.",
      swatches: UI.FAV_COLORS,
      swatchValue: UI.favColorKey(g.color),
    }).then(function (key) {
      if (key == null) return; // 취소
      Storage.setFavGroupColor(g.id, key === "none" ? null : key);
      if (!favGroupPickerEl.hidden) renderFavGroupPickerList();
      render();
    });
  }
  function removeFavGroupConfirm(g) {
    appDialog({
      title: "그룹 삭제",
      message: "‘" + g.name + "’ 그룹을 삭제할까요?\n그룹만 사라지고 연락처의 즐겨찾기는 유지됩니다.",
      okLabel: "삭제", danger: true,
    }).then(function (ok) {
      if (!ok) return;
      Storage.removeFavGroup(g.id);
      render();
      showSnack("그룹 삭제됨");
    });
  }
  function renderFavGroupPickerList() {
    if (!favGroupPickerContact) return;
    var sel = {};
    Storage.getContactFavGroups(favGroupPickerContact.id).forEach(function (gid) { sel[gid] = true; });
    // 그룹별 소속 인원 수 집계(현재 선택 반영 — 토글 시 즉시 갱신)
    var map = Storage.getFavGroupMap();
    var counts = {};
    Object.keys(map).forEach(function (cid) {
      (map[cid] || []).forEach(function (gid) { counts[gid] = (counts[gid] || 0) + 1; });
    });
    UI.renderFavGroupPicker(document.getElementById("fav-group-picker-list"), {
      groups: Storage.getFavGroups(),
      selected: sel,
      counts: counts,
      onToggle: function (gid) {
        Storage.toggleContactFavGroup(favGroupPickerContact.id, gid);
        renderFavGroupPickerList();
        render(); // 뒤 목록 갱신
      },
      onAddGroup: function (name) {
        name = (name || "").trim();
        if (!name) return;
        var id = Storage.addFavGroup(name, nextFavColor());
        if (id) Storage.toggleContactFavGroup(favGroupPickerContact.id, id);
        renderFavGroupPickerList();
        render();
        // 연속 추가 편의: 새 입력칸에 포커스
        var inp = document.querySelector("#fav-group-picker-list .fav-pick-input");
        if (inp) inp.focus();
      },
    });
  }
  function openFavGroupPicker(contact) {
    favGroupPickerContact = contact;
    document.getElementById("fav-group-picker-sub").textContent =
      (contact.name || "") + " 의 즐겨찾기 그룹";
    renderFavGroupPickerList();
    pushFocus();
    favGroupPickerEl.hidden = false;
    syncInert(); updateFab();
    document.getElementById("fav-group-picker-list").scrollTop = 0;
    history.pushState({ favgrouppick: true }, "", "#fav-group-pick");
  }
  function closeFavGroupPicker(fromPop) {
    favGroupPickerEl.hidden = true;
    favGroupPickerContact = null;
    syncInert(); updateFab(); popFocus();
    if (!fromPop && location.hash === "#fav-group-pick") backFromOverlay();
  }
  document.getElementById("fav-group-picker-back").addEventListener("click", function () { closeFavGroupPicker(false); });

  // ---------- 사원 순서(부서 내) ----------
  // 같은 부서 안에서 사원을 위/아래로 이동. 해당 부서 멤버 전체를 1..n 으로 재번호 부여해 저장.
  function moveMember(contact, dir) {
    var members = Data.membersOfDept(contact.deptId);
    var i = members.map(function (m) { return m.id; }).indexOf(contact.id);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= members.length) return;
    var arr = members.slice();
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    arr.forEach(function (m, idx) {
      if ((m.memberSortOrder || 0) !== idx + 1) Storage.setMemberOrder(m.id, idx + 1);
    });
    Data.rebuild();
    render();
  }
  // 다른 부서로 이동: 부서 선택 → 대상 부서 끝으로 배치(재번호)
  function moveMemberToDept(contact) {
    openDeptPicker({
      title: "옮길 부서 선택",
      currentId: contact.deptId != null ? String(contact.deptId) : "0",
      onPick: function (id) {
        var newId = realDeptId(id);
        if (!newId || newId === contact.deptId) return;
        var dept = Data.getDeptById(newId);
        if (!dept) return;
        var n = Data.membersOfDept(newId).length;
        Storage.saveContact(contact.id, { deptId: newId, dept: dept.name });
        Storage.setMemberOrder(contact.id, n + 1);
        Data.rebuild();
        render();
        showSnack(dept.name + "(으)로 옮겼습니다");
      },
    });
  }

  // 파일 → { thumb, full } dataURL.
  //  thumb: 256² 중앙크롭(리스트·아바타용)  /  full: 긴 변 ≤1280 비크롭(전체화면 뷰어용)
  //  - createImageBitmap 으로 EXIF 회전 자동 보정 + <img>가 못 읽는 포맷 일부 디코드(실패 시 <img> 폴백)
  //  - 투명 PNG 는 흰 배경으로 합성, 인코딩은 WebP 우선(미지원 시 JPEG)
  var _webpOK = null;
  function webpSupported() {
    if (_webpOK == null) {
      try { _webpOK = document.createElement("canvas").toDataURL("image/webp").indexOf("data:image/webp") === 0; }
      catch (e) { _webpOK = false; }
    }
    return _webpOK;
  }
  function encodeCanvas(cv, q) {
    return cv.toDataURL(webpSupported() ? "image/webp" : "image/jpeg", q);
  }
  function decodeImage(file) {
    // createImageBitmap: 회전(EXIF) 보정 옵션 + 넓은 디코드. 동기/비동기 실패 모두 <img> 폴백.
    if (window.createImageBitmap) {
      try {
        return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return imgDecode(file); });
      } catch (e) { return imgDecode(file); }
    }
    return imgDecode(file);
  }
  function imgDecode(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("이미지를 읽지 못했습니다 (HEIC 등 미지원 형식일 수 있어요)")); };
      img.src = url;
    });
  }
  function drawSquare(src, S, q) {
    var cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, S, S); // 투명 영역 흰 배경
    var w = src.width, h = src.height, m = Math.min(w, h), sx = (w - m) / 2, sy = (h - m) / 2;
    ctx.drawImage(src, sx, sy, m, m, 0, 0, S, S);
    return encodeCanvas(cv, q);
  }
  function drawScaled(src, MAX, q) {
    var w = src.width, h = src.height, scale = Math.min(1, MAX / Math.max(w, h));
    var dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
    var cv = document.createElement("canvas"); cv.width = dw; cv.height = dh;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(src, 0, 0, dw, dh);
    return encodeCanvas(cv, q);
  }
  function processPhoto(file) {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) {
      return Promise.reject(new Error("이미지 파일이 아닙니다"));
    }
    return decodeImage(file).then(function (src) {
      if (!src.width || !src.height) throw new Error("이미지를 읽지 못했습니다");
      var out = { thumb: drawSquare(src, 256, 0.82), full: drawScaled(src, 1280, 0.85) };
      if (src.close) src.close(); // ImageBitmap 메모리 해제
      return out;
    });
  }

  // 편집 폼의 사진 미리보기/선택/제거 연결
  function setupPhotoControls(contact) {
    var prev = document.getElementById("ef-photo-prev");
    var fileInp = document.getElementById("ef-photo-file");
    function paint() {
      prev.textContent = ""; prev.className = "ef-photo-prev"; prev.style.background = "";
      var cur = pendingPhoto !== undefined ? pendingPhoto : ((window.Photos && contact.id != null) ? Photos.get(contact.id) : null);
      var thumb = cur ? (typeof cur === "string" ? cur : cur.thumb) : null; // {thumb,full}·legacy string 모두 수용
      var useDefault = pendingDefaultIcon !== undefined ? pendingDefaultIcon : !!contact.defaultIcon;
      if (thumb) { var im = document.createElement("img"); im.src = thumb; im.alt = "미리보기"; prev.appendChild(im); }
      else if (useDefault) {
        prev.classList.add("ef-photo-default");
        prev.appendChild(UI.defaultIcon());
      }
      else {
        prev.classList.add("ef-photo-initial");
        prev.style.background = UI.avatarColor(contact.name || "");
        prev.textContent = (contact.name || "?").trim().charAt(0) || "?";
      }
    }
    paint();
    document.getElementById("ef-photo-pick").addEventListener("click", function () { fileInp.value = ""; fileInp.click(); });
    document.getElementById("ef-photo-default").addEventListener("click", function () { pendingPhoto = null; pendingDefaultIcon = true; paint(); });
    document.getElementById("ef-photo-remove").addEventListener("click", function () { pendingPhoto = null; pendingDefaultIcon = false; paint(); });
    fileInp.addEventListener("change", function () {
      var f = fileInp.files && fileInp.files[0];
      if (!f) return;
      processPhoto(f).then(function (p) { pendingPhoto = p; pendingDefaultIcon = false; paint(); })
        .catch(function (e) { showSnack("사진 처리 실패: " + e.message); });
    });
  }

  function openDetail(contact) {
    current.detailId = contact.id;
    Storage.pushRecent(contact.id);
    UI.renderDetail(detailBody, contact, { onOrg: goToOrg, onPhoto: openPhotoViewer });
    detailEl.setAttribute("aria-label", (contact.name || "연락처") + " 상세");
    updateFavButton();
    pushFocus();
    detailEl.hidden = false;
    syncInert();
    updateFab();
    detailBody.scrollTop = 0;
    detailBack.focus();
    if (location.hash !== "#contact/" + contact.id) {
      history.pushState({ detail: contact.id }, "", "#contact/" + contact.id);
    }
  }

  function closeDetail(fromPop) {
    detailEl.hidden = true;
    current.detailId = null;
    syncInert();
    updateFab();
    popFocus();
    if (!fromPop && location.hash) backFromOverlay();
    if (current.tab === "recent" || current.tab === "favorites") render();
  }

  document.getElementById("detail-edit").addEventListener("click", function () {
    var c = Data.getById(current.detailId);
    if (c) openEditor(c);
  });

  function updateFavButton() {
    var isFav = Storage.isFavorite(current.detailId);
    detailFav.classList.toggle("is-on", isFav);
    detailFav.setAttribute("aria-pressed", isFav ? "true" : "false");
    detailFav.setAttribute("aria-label", isFav ? "즐겨찾기 해제" : "즐겨찾기 추가");
  }

  detailFav.addEventListener("click", function () {
    if (current.detailId == null) return;
    var nowFav = Storage.toggleFavorite(current.detailId);
    updateFavButton();
    if (navigator.vibrate) navigator.vibrate(10);
    showSnack(nowFav ? "즐겨찾기에 추가됨" : "즐겨찾기에서 제거됨");
  });
  detailBack.addEventListener("click", function () { closeDetail(false); });

  // ---------- 탭 ----------
  function switchTab(tab) {
    tabs.forEach(function (t) {
      var sel = t === tab;
      t.classList.toggle("is-active", sel);
      t.setAttribute("aria-selected", sel ? "true" : "false");
      t.tabIndex = sel ? 0 : -1;
    });
    current.tab = tab.dataset.tab;
    current.orgReorder = false; // 탭 전환 시 순서 편집 모드 해제
    // 검색 중 탭 전환 시 검색을 종료하고 해당 탭 내용을 표시(검색 결과가 탭을 덮어쓰는 혼란 방지)
    if (current.query || searchPushed) {
      searchInput.value = "";
      current.query = "";
      searchClear.hidden = true;
      unwindSearchHistory();
    }
    listEl.setAttribute("aria-labelledby", tab.id);
    render();
    scrollRegion.scrollTo({ top: 0 });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () { switchTab(tab); });
  });
  tabsNav.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    var i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    var n = e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
    tabs[n].focus();
    switchTab(tabs[n]);
  });

  // ---------- 검색 (디바운스) ----------
  // 검색이 시작되면 히스토리 항목을 하나 push 한다 → 뒤로가기 시 앱을 나가지 않고 검색어부터 비운다.
  function beginSearchHistory() {
    if (!searchPushed && !anyOverlayOpen()) {
      history.pushState({ search: true }, "");
      searchPushed = true;
    }
  }
  // push 했던 검색 항목을 되감아 히스토리를 깔끔히 유지(사용자가 직접 검색을 비울 때).
  function unwindSearchHistory() {
    if (searchPushed) { searchPushed = false; history.back(); }
  }
  // 입력/쿼리/목록만 초기화(히스토리는 건드리지 않음).
  function resetSearchUI() {
    searchInput.value = "";
    current.query = "";
    searchClear.hidden = true;
    render();
  }
  var searchTimer;
  searchInput.addEventListener("input", function () {
    current.query = searchInput.value;
    searchClear.hidden = !searchInput.value;
    if (searchInput.value) beginSearchHistory();
    else unwindSearchHistory(); // 사용자가 직접 글자를 모두 지움
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 120);
  });
  searchClear.addEventListener("click", function () {
    resetSearchUI();
    unwindSearchHistory();
    searchInput.focus();
  });

  // ---------- 검색 자동완성(datalist): 부서명·직책 + 연산자 힌트 ----------
  // 라이브 목록이 이름 매칭을 이미 보여주므로, 숨은 연산자와 부서/직책 완성에 집중.
  function rebuildSearchSuggest() {
    var dl = document.getElementById("search-suggest");
    if (!dl) return;
    var seen = {}, opts = [];
    function add(v) { v = (v || "").toString().trim(); if (v && !seen[v]) { seen[v] = 1; opts.push(v); } }
    ["상태:재직", "상태:휴직", "상태:파견", "상태:교육", "부서:", "직책:", "직급:"].forEach(add);
    if (window.Data && Data.getDepartments) Data.getDepartments().forEach(function (d) { add(d.name); });
    if (window.Data && Data.getAllContacts) Data.getAllContacts().forEach(function (c) { add(c.position); });
    dl.textContent = "";
    opts.forEach(function (v) { var o = document.createElement("option"); o.value = v; dl.appendChild(o); });
  }
  searchInput.addEventListener("focus", rebuildSearchSuggest); // 포커스 시 최신화(데이터 변경 자동 반영)

  // ---------- 다중선택 → 일괄 공유/저장 ----------
  var selectBar = document.getElementById("select-bar");
  var selectCountEl = document.getElementById("select-count");
  var selectShareBtn = document.getElementById("select-share");
  var selectSaveBtn = document.getElementById("select-save");
  var selectModeBtn = document.getElementById("select-mode-btn");
  function selectedContacts() {
    return Object.keys(current.selected).map(function (id) { return Data.getById(id); }).filter(Boolean);
  }
  function updateSelectBar() {
    var n = Object.keys(current.selected).length;
    if (selectCountEl) selectCountEl.textContent = n + "명 선택";
    if (selectShareBtn) selectShareBtn.disabled = !n;
    if (selectSaveBtn) selectSaveBtn.disabled = !n;
  }
  function applySelectionToRows() {
    listEl.classList.toggle("is-selecting", !!current.selectMode);
    var rows = listEl.querySelectorAll(".row[data-id]");
    Array.prototype.forEach.call(rows, function (r) {
      r.classList.toggle("is-selected", !!current.selected[r.dataset.id]);
    });
  }
  function enterSelectMode() {
    if (current.selectMode) return;
    current.selectMode = true;
    if (selectBar) selectBar.hidden = false;
    if (selectModeBtn) selectModeBtn.classList.add("is-active");
    applySelectionToRows(); updateSelectBar(); updateFab();
  }
  function exitSelectMode() {
    if (!current.selectMode) return;
    current.selectMode = false; current.selected = {};
    if (selectBar) selectBar.hidden = true;
    if (selectModeBtn) selectModeBtn.classList.remove("is-active");
    listEl.classList.remove("is-selecting");
    applySelectionToRows(); updateFab();
  }
  if (selectModeBtn) selectModeBtn.addEventListener("click", function () {
    if (current.selectMode) exitSelectMode(); else enterSelectMode();
  });
  // 선택 모드: listEl 캡처 단계에서 행 클릭을 가로채 토글(상세 열림·전화 동작 방지)
  listEl.addEventListener("click", function (e) {
    if (!current.selectMode) return;
    var row = e.target.closest && e.target.closest(".row[data-id]");
    if (!row) return;
    e.preventDefault(); e.stopPropagation();
    var id = row.dataset.id;
    if (current.selected[id]) delete current.selected[id]; else current.selected[id] = true;
    row.classList.toggle("is-selected", !!current.selected[id]);
    updateSelectBar();
  }, true);
  var selCancel = document.getElementById("select-cancel");
  if (selCancel) selCancel.addEventListener("click", exitSelectMode);
  var selAll = document.getElementById("select-all");
  if (selAll) selAll.addEventListener("click", function () {
    var rows = listEl.querySelectorAll(".row[data-id]");
    var allOn = rows.length && Array.prototype.every.call(rows, function (r) { return current.selected[r.dataset.id]; });
    Array.prototype.forEach.call(rows, function (r) {
      if (allOn) delete current.selected[r.dataset.id]; else current.selected[r.dataset.id] = true;
    });
    applySelectionToRows(); updateSelectBar();
  });
  if (selectSaveBtn) selectSaveBtn.addEventListener("click", function () {
    var list = selectedContacts();
    if (!list.length) return;
    UI.downloadVCards(list, "행정전화부-연락처-" + dateStamp() + ".vcf");
    showSnack(list.length + "명을 vCard로 저장했습니다");
    exitSelectMode();
  });
  if (selectShareBtn) selectShareBtn.addEventListener("click", function () {
    var list = selectedContacts();
    if (!list.length) return;
    var fname = "행정전화부-연락처-" + dateStamp() + ".vcf";
    try {
      var file = new File([UI.buildVCards(list)], fname, { type: "text/vcard" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: "연락처 " + list.length + "명" }).then(exitSelectMode).catch(function () {});
        return;
      }
    } catch (e) {}
    if (navigator.share) {
      navigator.share({ title: "연락처 " + list.length + "명",
        text: list.map(function (c) { return c.name + " " + (c.phone || c.tel || ""); }).join("\n") }).then(exitSelectMode).catch(function () {});
    } else {
      UI.downloadVCards(list, fname); // 공유 미지원 → 저장 폴백
      showSnack("공유를 지원하지 않아 파일로 저장했습니다");
      exitSelectMode();
    }
  });

  // ---------- 어디서나 타이핑 → 검색 (type-anywhere-to-search) ----------
  // 리스트 화면에서 입력 필드가 아닌 곳에 포커스가 있을 때 인쇄 가능한 키를 누르면
  // 검색창으로 포커스를 옮기고 그 글자를 검색어에 넣는다.
  //   · '/'        → 검색창 포커스(글자 삽입 안 함)
  //   · Backspace  → 검색어가 있을 때 끝 글자 삭제
  //   · Space      → 무시(버튼/행의 스페이스 동작 보존, 선두 공백 검색 무의미)
  //   · 화살표/Enter 등 → 통과(리스트·탭 키보드 내비게이션 보존)
  function isTypeToSearchContext() {
    if (!searchInput || searchInput.offsetParent === null) return false; // 검색창이 보일 때만
    if (!detailEl.hidden || !settingsEl.hidden || !editorEl.hidden ||
        !deptMgrEl.hidden || !deptEditorEl.hidden) return false;          // 전체화면 뷰 제외
    if (isLocked) return false;                                           // 잠금화면 제외
    if (photoViewerEl && !photoViewerEl.hidden) return false;
    if (deptPickerEl && !deptPickerEl.hidden) return false;
    if (favGroupPickerEl && !favGroupPickerEl.hidden) return false;
    if (document.querySelector(".app-dialog-backdrop")) return false;     // 다이얼로그 제외
    return true;
  }
  function isEditableTarget(el) {
    if (!el) return false;
    var t = el.tagName;
    return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
  }
  // 물리 키보드가 있을 법한 기기(데스크톱 등)에서만 검색창 선포커스 — 터치폰 소프트키보드 팝업 방지.
  var kbDevice = !window.matchMedia || matchMedia("(hover: hover) and (pointer: fine)").matches;
  // 리스트 화면이 idle 상태면 검색창에 미리 포커스(부팅 시 호출). 한글도 첫 글자부터 입력됨.
  function focusSearchIfIdle() {
    if (kbDevice && isTypeToSearchContext()) {
      try { searchInput.focus({ preventScroll: true }); } catch (e) { searchInput.focus(); }
    }
  }
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // 단축키는 통과
    // 검색창 포커스 상태에서 ↓ → 리스트 첫 항목으로 핸드오프(한글 조합 중엔 IME 후보 이동이므로 제외)
    if (e.target === searchInput) {
      if (e.key === "ArrowDown" && !e.isComposing) {
        var firstRow = listEl.querySelector(".row, .section-toggle, [role='treeitem']");
        if (firstRow) { e.preventDefault(); firstRow.focus(); }
      }
      return; // 그 외 키는 검색창이 네이티브로 처리(한글 포함)
    }
    if (isEditableTarget(e.target)) return;           // 다른 입력 필드면 통과
    if (e.key === " ") return;                         // 스페이스는 가로채지 않음
    if (!isTypeToSearchContext()) return;

    if (e.key === "/") { e.preventDefault(); searchInput.focus(); return; }

    if (e.key === "Backspace") {
      if (!searchInput.value) return;
      e.preventDefault();
      searchInput.focus();
      searchInput.value = searchInput.value.slice(0, -1);
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // IME(한글 등) 조합 입력: 포커스만 옮겨 이어지는 조합이 검색창에 들어가게 한다.
    if (e.isComposing || e.keyCode === 229 || e.key === "Process") { searchInput.focus(); return; }
    // 인쇄 가능한 단일 문자(영문/숫자/기호): 검색창에 직접 삽입
    if (e.key && e.key.length === 1) {
      e.preventDefault();
      searchInput.focus();
      searchInput.value += e.key;
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, false);

  // ---------- 설정 / 백업·복구 (전부 로컬 처리, 네트워크 없음) ----------
  var settingsCounts = document.getElementById("settings-counts");
  var importFile = document.getElementById("import-file");

  function refreshCounts() {
    var c = Storage.counts();
    var parts = [];
    if (window.Data && Data.hasBaseData && Data.hasBaseData()) {
      // 번들 명부가 있을 때: 내가 바꾼/추가한 것만 구분 표시
      if (c.favorites) parts.push("즐겨찾기 " + c.favorites);
      if (c.recent) parts.push("최근 " + c.recent);
      if (c.edits) parts.push("편집 " + c.edits);
      if (c.custom) parts.push("추가 " + c.custom);
      if (c.deptEdits || c.deptCustom) parts.push("부서변경 " + (c.deptEdits + c.deptCustom));
    } else {
      // 번들 명부가 없으면 전부 내 데이터 → 총량으로 표시(custom=전체 연락처/부서)
      if (c.custom) parts.push("연락처 " + c.custom + "명");
      if (c.deptCustom) parts.push("부서 " + c.deptCustom + "개");
      if (c.favorites) parts.push("즐겨찾기 " + c.favorites);
      if (c.recent) parts.push("최근 " + c.recent);
    }
    settingsCounts.textContent = parts.length ? parts.join(" · ") : "저장된 개인 데이터 없음";
  }
  function openSettings() {
    exitSelectMode(); // 선택 모드 중 설정 진입 시 정리
    refreshCounts();
    document.getElementById("settings-version").textContent = "v" + APP_VERSION;
    var settingsBody = settingsEl.querySelector(".detail-body");
    pushFocus();
    settingsEl.hidden = false;
    // display:none 상태에서의 scrollTop 쓰기는 일부 브라우저(iOS Safari 등)에서
    // 무시·복원될 수 있으므로, 표시(layout 생성) 후에 맨 위로 리셋한다.
    if (settingsBody) settingsBody.scrollTop = 0; // 진입 시 항상 맨 위부터
    syncInert();
    updateFab();
    document.getElementById("settings-back").focus();
    history.pushState({ settings: true }, "", "#settings");
  }
  function closeSettings(fromPop) {
    settingsEl.hidden = true;
    syncInert();
    updateFab();
    popFocus();
    if (!fromPop && location.hash === "#settings") backFromOverlay();
  }

  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("update-check-btn").addEventListener("click", function () {
    if (!("serviceWorker" in navigator)) { showSnack("이 브라우저는 업데이트 확인을 지원하지 않습니다"); return; }
    showSnack("업데이트 확인 중…");
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { showSnack("설치된 서비스워커가 없습니다"); return; }
      return reg.update().then(function () {
        // 새 버전이 있으면 자동으로 설치→활성→새로고침된다(controllerchange 처리).
        if (reg.installing || reg.waiting) showSnack("새 버전을 적용하는 중…");
        else showSnack("최신 버전입니다 (v" + APP_VERSION + ")");
      });
    }).catch(function () { showSnack("업데이트 확인 실패"); });
  });
  document.getElementById("settings-back").addEventListener("click", function () {
    closeSettings(false);
  });

  function buildBackupData() {
    var data = Storage.exportData();
    if (window.Photos) data.photos = Photos.all();
    return data;
  }
  function downloadJson(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  // ---------- 백업 암호화 (WebCrypto: PBKDF2-SHA256 → AES-256-GCM) ----------
  var BACKUP_KDF_ITER = 150000;
  function _b64enc(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function _b64dec(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function _deriveKey(pass, salt, iter) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (km) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" },
        km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function encryptBackup(obj, pass) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var pt = new TextEncoder().encode(JSON.stringify(obj));
    return _deriveKey(pass, salt, BACKUP_KDF_ITER).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, pt);
    }).then(function (ct) {
      return { app: "dongguDial", type: "backup-enc", v: 1, kdf: "PBKDF2-SHA256",
        iter: BACKUP_KDF_ITER, salt: _b64enc(salt), iv: _b64enc(iv), ct: _b64enc(ct) };
    });
  }
  function decryptBackup(env, pass) {
    return _deriveKey(pass, _b64dec(env.salt), env.iter || BACKUP_KDF_ITER).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: _b64dec(env.iv) }, key, _b64dec(env.ct));
    }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
  }
  document.getElementById("export-btn").addEventListener("click", function () {
    downloadJson(buildBackupData(), "행정전화부-백업-" + dateStamp() + ".json");
  });
  function exportBackupEncrypted() {
    if (!(window.crypto && crypto.subtle)) { showSnack("이 브라우저는 백업 암호화를 지원하지 않습니다"); return; }
    appDialog({ title: "백업 암호 설정", message: "이 암호로 백업 파일을 잠급니다.\n암호를 분실하면 복구할 수 없습니다.", value: "", placeholder: "암호 (4자 이상)", okLabel: "다음", inputType: "password", autocomplete: "off", maxLength: 64 }).then(function (p1) {
      if (!p1) return;
      if (p1.length < 4) { showSnack("암호는 4자 이상이어야 합니다"); return; }
      appDialog({ title: "백업 암호 확인", value: "", placeholder: "암호 다시 입력", okLabel: "내보내기", inputType: "password", autocomplete: "off", maxLength: 64 }).then(function (p2) {
        if (!p2) return;
        if (p2 !== p1) { showSnack("암호가 일치하지 않습니다"); return; }
        encryptBackup(buildBackupData(), p1)
          .then(function (env) { downloadJson(env, "행정전화부-백업(암호화)-" + dateStamp() + ".json"); showSnack("암호화 백업을 내보냈습니다"); })
          .catch(function (e) { showSnack("암호화 실패: " + e.message); });
      });
    });
  }
  var exportEncBtn = document.getElementById("export-enc-btn");
  if (exportEncBtn) exportEncBtn.addEventListener("click", exportBackupEncrypted);
  var backupImportMode = "merge"; // "merge" | "replace"
  document.getElementById("import-btn").addEventListener("click", function () {
    backupImportMode = "merge";
    importFile.value = "";
    importFile.click();
  });
  document.getElementById("import-replace-backup-btn").addEventListener("click", function () {
    backupImportMode = "replace";
    importFile.value = "";
    importFile.click();
  });
  importFile.addEventListener("change", function () {
    var file = importFile.files && importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (e) { showSnack("가져오기 실패: " + e.message); return; }
      function continueImport(data) {
        function proceed() {
          try {
            var result = Storage.importData(data, backupImportMode);
            Data.rebuild();
            applyTheme(Storage.getTheme());
            setThemeUI(Storage.getTheme());
            refreshCounts();
            render();
            if (window.Photos) {
              if (backupImportMode === "replace") Photos.importMap(data.photos || {}, true).then(render);
              else if (data.photos) Photos.importMap(data.photos, false).then(render);
            }
            showSnack((backupImportMode === "replace" ? "대체 복구 완료: " : "복구 완료: ") +
              "즐겨찾기 " + result.favorites + ", 최근 " + result.recent +
              ", 편집 " + result.edits + ", 추가 " + result.custom);
          } catch (e) {
            showSnack("가져오기 실패: " + e.message);
          }
        }
        if (backupImportMode === "replace") {
          appDialog({ title: "초기화 후 복구", message: "기존 즐겨찾기·편집·추가·부서·사진을 모두 비우고 이 백업으로 대체합니다. 계속할까요?", okLabel: "대체", danger: true })
            .then(function (ok) { if (ok) proceed(); });
        } else proceed();
      }
      if (parsed && parsed.type === "backup-enc") {
        // 암호화 백업 → 암호 입력받아 복호화 후 진행
        if (!(window.crypto && crypto.subtle)) { showSnack("이 브라우저는 암호화 백업을 열 수 없습니다"); return; }
        appDialog({ title: "백업 암호 입력", message: "암호화된 백업입니다. 암호를 입력하세요.", value: "", placeholder: "암호", okLabel: "복호화", inputType: "password", autocomplete: "off", maxLength: 64 }).then(function (pass) {
          if (!pass) return;
          decryptBackup(parsed, pass).then(function (dec) { continueImport(dec); })
            .catch(function () { showSnack("암호가 올바르지 않거나 손상된 파일입니다."); });
        });
      } else {
        continueImport(parsed);
      }
    };
    reader.onerror = function () { showSnack("파일을 읽지 못했습니다."); };
    reader.readAsText(file);
  });

  // ---------- 연락처 편집 / 추가 (로컬 오버레이) ----------
  function openEditor(contact) {
    editId = contact ? contact.id : null;
    document.getElementById("editor-bar-title").textContent = contact ? "연락처 편집" : "연락처 추가";
    var depts = Data.getDepartments();
    UI.renderEditForm(editorBody, contact || { deptId: depts[0] && depts[0].id }, depts);
    pendingPhoto = undefined;
    pendingDefaultIcon = undefined;
    setupPhotoControls(contact || {});
    document.getElementById("ef-dept-btn").addEventListener("click", function () {
      openDeptPicker({
        title: "부서 선택", allowNone: true, noneLabel: "(미지정)",
        currentId: val("ef-dept") || "0",
        onPick: function (id) {
          document.getElementById("ef-dept").value = id ? String(id) : "0";
          setPickerBtn("ef-dept-btn", id ? deptPathLabel(id) : "(미지정)");
        },
      });
    });
    document.getElementById("editor-delete").style.display = contact ? "" : "none";
    pushFocus();
    editorEl.hidden = false;
    syncInert();
    updateFab();
    editorBody.scrollTop = 0;
    document.getElementById("editor-cancel").focus();
    history.pushState({ editor: true }, "", "#edit");
  }
  function closeEditor(fromPop) {
    editorEl.hidden = true;
    syncInert();
    updateFab();
    popFocus();
    if (!fromPop && location.hash === "#edit") backFromOverlay();
  }
  function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
  // select의 문자열 value를 실제 부서 id(숫자 base / 문자열 custom)로 복원
  function realDeptId(raw) { if (!raw || raw === "0") return 0; var d = Data.getDeptById(raw); return d ? d.id : 0; }
  function saveEditor() {
    var name = val("ef-name");
    if (!name) { showSnack("이름을 입력하세요."); return; }
    var deptId = realDeptId(val("ef-dept"));
    var d0 = Data.getDeptById(deptId);
    var dept = d0 ? d0.name : "";
    var prevC = editId != null ? Data.getById(editId) : null;
    var useDefaultIcon = pendingDefaultIcon !== undefined ? pendingDefaultIcon : !!(prevC && prevC.defaultIcon);
    var fields = {
      name: name, deptId: deptId, dept: dept,
      position: val("ef-position"), grade: val("ef-grade"), work: val("ef-work"),
      phone: val("ef-phone"), tel: val("ef-tel"), birth: val("ef-birth"),
      status: val("ef-status") || "미설정",
      memo: val("ef-memo"),
      defaultIcon: useDefaultIcon,
    };
    var id;
    if (editId == null) id = Storage.addContact(fields);
    else { Storage.saveContact(editId, fields); id = editId; }
    if (pendingPhoto !== undefined && window.Photos) {
      if (pendingPhoto === null) Photos.remove(id); else Photos.set(id, pendingPhoto);
    }
    Data.rebuild();
    closeEditor(false);
    if (!detailEl.hidden && current.detailId === id) {
      var c = Data.getById(id);
      if (c) { UI.renderDetail(detailBody, c, { onOrg: goToOrg, onPhoto: openPhotoViewer }); updateFavButton(); }
    }
    render();
    showSnack("저장되었습니다");
  }
  function deleteEditor() {
    if (editId == null) return;
    var delId = editId;
    var dc = Data.getById(delId);
    var dname = (dc && dc.name) ? dc.name : "이 연락처";
    var gmap = Storage.getFavGroupMap();
    var alsoRemoved = Storage.isFavorite(delId) || (gmap[delId] && gmap[delId].length);
    var msg = "‘" + dname + "’ 연락처를 삭제할까요?" +
      (alsoRemoved ? "\n즐겨찾기·그룹 지정도 함께 사라집니다." : "");
    appDialog({ title: "연락처 삭제", message: msg, okLabel: "삭제", danger: true }).then(function (ok) {
      if (!ok) return;
      Storage.deleteContact(delId);
      if (window.Photos) Photos.remove(delId);
      Data.rebuild();
      closeEditor(false);
      if (!detailEl.hidden && current.detailId === delId) closeDetail(false);
      render();
      showSnack("삭제되었습니다");
    });
  }
  document.getElementById("editor-cancel").addEventListener("click", function () { closeEditor(false); });
  document.getElementById("editor-save").addEventListener("click", saveEditor);
  document.getElementById("editor-delete").addEventListener("click", deleteEditor);
  fab.addEventListener("click", function () { openEditor(null); });
  document.getElementById("reset-edits-btn").addEventListener("click", function () {
    appDialog({ title: "초기화", message: "수정·추가한 연락처와 부서를 모두 초기화할까요?", okLabel: "초기화", danger: true }).then(function (ok) {
      if (!ok) return;
      Storage.resetAllEdits();
      if (window.Photos) Photos.clearAll();
      Data.rebuild();
      refreshCounts();
      render();
      showSnack("초기화되었습니다");
    });
  });

  // ---------- 부서 관리 (로컬 오버레이) ----------
  function renderDeptMgrList() {
    UI.renderDeptManager(deptMgrBody, Data.getDepartments(),
      { direct: Data.directCountByDept(), child: Data.childCountByParent() },
      {
        onEdit: openDeptEditor,
        onMove: moveDept,
        onAddChild: function (d) { openDeptEditor(null, d.id); },
        onDelete: confirmDeleteDept,
        onToggle: function (id) {
          current.deptMgrCollapsed[id] = !current.deptMgrCollapsed[id];
          renderDeptMgrList();
        },
        collapsed: current.deptMgrCollapsed,
      });
  }
  function moveDept(dept, dir) {
    var sibs = Data.getDepartments().filter(function (d) { return (d.parentId || 0) === (dept.parentId || 0); });
    var i = sibs.findIndex(function (d) { return d.id === dept.id; });
    var j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    var a = sibs[i], b = sibs[j];
    var av = a.sortOrder || 0, bv = b.sortOrder || 0;
    if (av === bv) bv = av + dir;
    Storage.saveDept(a.id, { sortOrder: bv });
    Storage.saveDept(b.id, { sortOrder: av });
    Data.rebuild(); renderDeptMgrList(); render();
    showSnack("순서를 변경했습니다");
  }
  function openDeptMgr() {
    renderDeptMgrList();
    pushFocus(); deptMgrEl.hidden = false; syncInert(); updateFab();
    document.getElementById("deptmgr-back").focus();
    history.pushState({ deptmgr: true }, "", "#depts");
  }
  function closeDeptMgr(fromPop) {
    deptMgrEl.hidden = true; syncInert(); updateFab(); popFocus();
    if (!fromPop && location.hash === "#depts") backFromOverlay();
  }
  document.getElementById("deptmgr-btn").addEventListener("click", openDeptMgr);
  document.getElementById("deptmgr-back").addEventListener("click", function () { closeDeptMgr(false); });
  document.getElementById("deptmgr-add").addEventListener("click", function () { openDeptEditor(null); });

  function defaultDeptSort() {
    var max = 0;
    Data.getDepartments().forEach(function (d) { if ((d.sortOrder || 0) > max) max = d.sortOrder || 0; });
    return max + 10;
  }
  function openDeptEditor(dept, presetParentId) {
    deptEditId = dept ? dept.id : null;
    document.getElementById("dept-editor-bar-title").textContent = dept ? "부서 편집" : "부서 추가";
    var formDept = dept || (presetParentId != null ? { parentId: presetParentId } : {});
    UI.renderDeptForm(deptEditorBody, formDept, Data.getDepartments());
    document.getElementById("df-parent-btn").addEventListener("click", function () {
      var excl = deptEditId != null ? deptDescendants(deptEditId) : {};
      if (deptEditId != null) excl[deptEditId] = true;
      openDeptPicker({
        title: "상위 부서 선택", allowNone: true, noneLabel: "최상위 (국·실·관)",
        currentId: val("df-parent") || "0", exclude: excl,
        onPick: function (id) {
          document.getElementById("df-parent").value = id ? String(id) : "0";
          setPickerBtn("df-parent-btn", id ? deptPathLabel(id) : "최상위 (국·실·관)");
        },
      });
    });
    document.getElementById("dept-editor-delete").style.display = dept ? "" : "none";
    pushFocus(); deptEditorEl.hidden = false; syncInert(); updateFab();
    deptEditorBody.scrollTop = 0;
    document.getElementById("dept-editor-cancel").focus();
    history.pushState({ depteditor: true }, "", "#dept-edit");
  }
  function closeDeptEditor(fromPop) {
    deptEditorEl.hidden = true; syncInert(); updateFab(); popFocus();
    if (!fromPop && location.hash === "#dept-edit") backFromOverlay();
  }
  function saveDeptEditor() {
    var name = val("df-name");
    if (!name) { showSnack("부서명을 입력하세요."); return; }
    var parentId = realDeptId(val("df-parent"));
    var level = parentId ? Data.depthOf(parentId) + 1 : 0;
    var existing = deptEditId != null ? Data.getDeptById(deptEditId) : null;
    var sortOrder = (existing && existing.sortOrder != null) ? existing.sortOrder : defaultDeptSort();
    var fields = { name: name, parentId: parentId, level: level, sortOrder: sortOrder };
    if (deptEditId == null) Storage.addDept(fields);
    else Storage.saveDept(deptEditId, fields);
    Data.rebuild();
    closeDeptEditor(false);
    renderDeptMgrList();
    render();
    refreshCounts();
    showSnack("부서가 저장되었습니다");
  }
  // 부서 삭제(편집 화면·목록 행 공용). 인원/하위 있으면 상위로 올리고 삭제. 성공 시 true 로 resolve 되는 Promise.
  function performDeptDelete(id) {
    var dept = Data.getDeptById(id);
    if (!dept) return Promise.resolve(false);
    var dc = Data.directCountByDept()[id] || 0;
    var cc = Data.childCountByParent()[id] || 0;
    var up = dept.parentId || 0;
    var upDept = up ? Data.getDeptById(up) : null;
    var upName = upDept ? upDept.name : "최상위(미지정)";
    var msg = (dc || cc)
      ? "‘" + dept.name + "’에 인원 " + dc + "명, 하위 부서 " + cc + "개가 있습니다.\n이들을 상위(" + upName + ")로 옮기고 삭제할까요?"
      : "‘" + dept.name + "’ 부서를 삭제할까요?";
    return appDialog({ title: "부서 삭제", message: msg, okLabel: "삭제", danger: true }).then(function (ok) {
      if (!ok) return false;
      if (dc || cc) {
        Data.getDepartments().filter(function (d) { return d.parentId === id; })
          .forEach(function (ch) { Storage.saveDept(ch.id, { parentId: up, level: up ? Data.depthOf(up) + 1 : 0 }); });
        Data.membersOfDept(id).forEach(function (c) {
          Storage.saveContact(c.id, { deptId: up, dept: upDept ? upDept.name : "" });
        });
      }
      Storage.deleteDept(id);
      Data.rebuild();
      renderDeptMgrList();
      render();
      refreshCounts();
      showSnack("부서가 삭제되었습니다");
      return true;
    });
  }
  function confirmDeleteDept(dept) { performDeptDelete(dept.id); }
  function deleteDeptEditor() {
    if (deptEditId == null) return;
    performDeptDelete(deptEditId).then(function (ok) { if (ok) closeDeptEditor(false); });
  }
  document.getElementById("dept-editor-cancel").addEventListener("click", function () { closeDeptEditor(false); });
  document.getElementById("dept-editor-save").addEventListener("click", saveDeptEditor);
  document.getElementById("dept-editor-delete").addEventListener("click", deleteDeptEditor);

  // ---------- 연락처 CSV/Excel 가져오기 (로컬) ----------
  var importContactsFile = document.getElementById("import-contacts-file");
  var FIELD_ALIASES = {
    name: ["이름", "성명", "직원명", "name"],
    position: ["직책", "직위", "position"],
    grade: ["직급", "급수", "계급", "grade"],
    work: ["담당업무", "업무", "담당", "work"],
    phone: ["휴대전화", "휴대폰", "핸드폰", "휴대", "개인전화", "연락처", "hp", "mobile", "phone"],
    tel: ["행정번호", "사내번호", "내선", "내선번호", "사무실", "직통", "전화", "tel"],
    birth: ["생년월일", "생일", "출생", "birth"],
    status: ["재직상태", "상태", "재직", "status"],
  };
  // 조직 위계 열(상위 → 하위). 존재하는 열만 경로로 사용, 사람은 가장 말단(팀)에 배치
  var HIER_ALIASES = [
    ["상위부서", "상위조직", "상위", "국", "실", "본부"],   // 최상위(국/실/관)
    ["부서", "부서명", "소속", "과", "department"],          // 과
    ["팀", "팀명", "담당팀"],                                // 팀
  ];
  function norm(s) { return (s || "").toString().trim().toLowerCase().replace(/\s+/g, ""); }
  function buildFieldMap(headers) {
    var map = {};
    Object.keys(FIELD_ALIASES).forEach(function (field) {
      var aliases = FIELD_ALIASES[field].map(norm);
      var h = headers.find(function (hd) { return aliases.indexOf(norm(hd)) !== -1; });
      if (h) map[field] = h;
    });
    return map;
  }
  function normStatus(s) {
    s = (s || "").trim();
    var m = { "재직중": "재직", "휴직중": "휴직", "파견중": "파견", "교육중": "교육" };
    s = m[s] || s;
    return ["재직", "휴직", "파견", "교육"].indexOf(s) >= 0 ? s : "미설정";
  }
  function applyContactImport(rows) {
    var headers = Object.keys(rows[0] || {});
    var fmap = buildFieldMap(headers);
    if (!fmap.name) throw new Error("‘이름’ 열을 찾을 수 없습니다. 양식을 확인하세요.");
    // 위계 열(상위부서/부서/팀) 헤더 탐지
    var hierHeaders = HIER_ALIASES.map(function (aliases) {
      var a = aliases.map(norm);
      return headers.find(function (hd) { return a.indexOf(norm(hd)) !== -1; }) || null;
    });

    var pathCache = {}, sortCounter = 0, newDepts = 0;
    Data.getDepartments().forEach(function (d) {
      pathCache[(d.parentId || 0) + " " + d.name] = { id: d.id, level: d.level || 0 };
      if ((d.sortOrder || 0) > sortCounter) sortCounter = d.sortOrder || 0;
    });
    // 이름 경로(top→leaf)를 부서 체인으로 생성하고 말단 부서 반환
    function resolveDeptPath(names) {
      var parentId = 0, level = 0, leaf = { id: 0, name: "" };
      names.forEach(function (nm) {
        nm = (nm || "").trim();
        if (!nm) return;
        var key = parentId + " " + nm;
        var info = pathCache[key];
        if (!info) {
          sortCounter += 10;
          var id = Storage.addDept({ name: nm, parentId: parentId, level: level, sortOrder: sortCounter });
          info = { id: id, level: level };
          pathCache[key] = info;
          newDepts++;
        }
        parentId = info.id; level = info.level + 1;
        leaf = { id: info.id, name: nm };
      });
      return leaf;
    }
    function v(r, f) { return fmap[f] ? (r[fmap[f]] || "").trim() : ""; }
    function leafOf(r) { for (var i = hierHeaders.length - 1; i >= 0; i--) { var h = hierHeaders[i]; if (h && (r[h] || "").trim()) return r[h].trim(); } return ""; }
    function fieldsFromRow(r) {
      var leaf = resolveDeptPath(hierHeaders.map(function (h) { return h ? (r[h] || "").trim() : ""; }));
      return { name: v(r, "name"), deptId: leaf.id, dept: leaf.name, team: "",
        position: v(r, "position"), grade: v(r, "grade"), work: v(r, "work"),
        phone: v(r, "phone"), tel: v(r, "tel"), birth: v(r, "birth"), status: normStatus(v(r, "status")) };
    }
    var idx = buildContactMatchIndex();
    var added = 0, updated = 0, skipped = 0;
    rows.forEach(function (r) {
      var name = v(r, "name");
      if (!name) { skipped++; return; }
      var ph = digits(v(r, "phone")) || digits(v(r, "tel"));
      var m = matchExisting(idx, name, ph, leafOf(r));
      if (m) { Storage.saveContact(m.id, fieldsFromRow(r)); updated++; }  // 일치 → 갱신(중복 누적 방지)
      else { Storage.addContact(fieldsFromRow(r)); added++; }             // 신규 → 추가
    });
    return { added: added, updated: updated, skipped: skipped, newDepts: newDepts };
  }
  function digits(s) { return (s || "").replace(/\D/g, ""); }
  // 기존 연락처 색인: 이름+전화digits(우선) / 이름+부서leaf
  function buildContactMatchIndex() {
    var byNamePhone = {}, byNameDept = {};
    (window.Data && Data.getAllContacts ? Data.getAllContacts() : []).forEach(function (c) {
      var nm = (c.name || "").trim(); if (!nm) return;
      var ph = digits(c.phone) || digits(c.tel);
      if (ph.length >= 7) byNamePhone[nm + "|" + ph] = c;
      if (c.dept) byNameDept[nm + "|" + c.dept] = c;
    });
    return { byNamePhone: byNamePhone, byNameDept: byNameDept };
  }
  function matchExisting(idx, name, rowPhone, leaf) {
    if (rowPhone.length >= 7 && idx.byNamePhone[name + "|" + rowPhone]) return idx.byNamePhone[name + "|" + rowPhone];
    if (leaf && idx.byNameDept[name + "|" + leaf]) return idx.byNameDept[name + "|" + leaf];
    return null;
  }
  // 미리보기(dry-run, 변경 없음): 신규/갱신/건너뜀 건수
  function classifyImport(rows) {
    var headers = Object.keys(rows[0] || {});
    var fmap = buildFieldMap(headers);
    if (!fmap.name) throw new Error("'이름' 열을 찾을 수 없습니다. 양식을 확인하세요.");
    var hierHeaders = HIER_ALIASES.map(function (aliases) {
      var a = aliases.map(norm);
      return headers.find(function (hd) { return a.indexOf(norm(hd)) !== -1; }) || null;
    });
    function v(r, f) { return fmap[f] ? (r[fmap[f]] || "").trim() : ""; }
    function leafOf(r) { for (var i = hierHeaders.length - 1; i >= 0; i--) { var h = hierHeaders[i]; if (h && (r[h] || "").trim()) return r[h].trim(); } return ""; }
    var idx = buildContactMatchIndex();
    var news = 0, updates = 0, skipped = 0;
    rows.forEach(function (r) {
      var name = v(r, "name");
      if (!name) { skipped++; return; }
      var ph = digits(v(r, "phone")) || digits(v(r, "tel"));
      if (matchExisting(idx, name, ph, leafOf(r))) updates++; else news++;
    });
    return { news: news, updates: updates, skipped: skipped };
  }
  function runImport(rows) {
    var res;
    try { res = applyContactImport(rows); }
    catch (e) { showSnack("가져오기 실패: " + e.message); return; }
    Data.rebuild(); render(); refreshCounts(); rebuildSearchSuggest();
    showSnack((importMode === "replace" ? "대체 완료: " : "가져오기 완료: ") +
      "추가 " + res.added + "명" + (res.updated ? " · 갱신 " + res.updated + "명" : "") +
      (res.newDepts ? " · 신규 부서 " + res.newDepts + "개" : "") +
      (res.skipped ? " · 건너뜀 " + res.skipped + "건" : ""));
  }
  var importMode = "append"; // "append" | "replace"
  document.getElementById("import-contacts-btn").addEventListener("click", function () {
    importMode = "append";
    importContactsFile.value = "";
    importContactsFile.click();
  });
  document.getElementById("import-replace-btn").addEventListener("click", function () {
    importMode = "replace";
    importContactsFile.value = "";
    importContactsFile.click();
  });
  importContactsFile.addEventListener("change", function () {
    var file = importContactsFile.files && importContactsFile.files[0];
    if (!file) return;
    var isCSV = /\.csv$/i.test(file.name);
    var reader = new FileReader();
    reader.onload = function () {
      var parse;
      try {
        parse = isCSV
          ? Promise.resolve(Importer.parseCSV(Importer.decodeText(reader.result)))
          : Importer.parseXLSX(reader.result);
      } catch (e) { showSnack("가져오기 실패: " + e.message); return; }
      parse.then(function (rows) {
        if (!rows || !rows.length) { showSnack("가져올 행이 없습니다."); return; }
        if (importMode === "replace") {
          appDialog({ title: "연락처 가져오기", message: "초기화 후 가져오기: 기존 샘플·편집·추가·가져온 연락처와 부서를 모두 비우고 이 파일(" + rows.length + "건)만 남깁니다. 계속할까요?", okLabel: "대체", danger: true })
            .then(function (ok) {
              if (!ok) return;
              Storage.resetAllEdits(); if (window.Photos) Photos.clearAll(); Storage.setBaseHidden(true); Data.rebuild();
              runImport(rows);
            });
          return;
        }
        // 추가 모드: 미리보기(신규/갱신/건너뜀) → 일치 항목은 갱신해 중복 누적 방지
        var cls;
        try { cls = classifyImport(rows); }
        catch (e) { showSnack("가져오기 실패: " + e.message); return; }
        var msg = "총 " + rows.length + "건\n· 신규 추가 " + cls.news + "명\n· 기존과 일치(갱신) " + cls.updates + "명"
          + (cls.skipped ? "\n· 이름 없음(건너뜀) " + cls.skipped + "건" : "")
          + "\n\n일치하는 연락처(이름+전화 또는 이름+부서)는 새 내용으로 갱신되어 중복으로 쌓이지 않습니다.";
        appDialog({ title: "가져오기 미리보기", message: msg, okLabel: "가져오기" })
          .then(function (ok) { if (ok) runImport(rows); });
      }).catch(function (e) { showSnack("가져오기 실패: " + e.message); });
    };
    reader.onerror = function () { showSnack("파일을 읽지 못했습니다."); };
    reader.readAsArrayBuffer(file); // CSV/XLSX 모두 ArrayBuffer로 읽어 인코딩 자동 판별
  });
  document.getElementById("import-template-btn").addEventListener("click", function () {
    var csv = "이름,상위부서,부서,팀,직책,직급,담당업무,휴대전화,행정번호,생년월일,재직상태\n" +
      "홍길동,행정복지국,자치행정과,총무팀,팀장,사무관,총무,010-1234-5678,062-608-0000,1980-01-01,재직\n" +
      "김영희,행정복지국,자치행정과,,과장,서기관,자치행정,010-2222-3333,062-608-0001,1978-05-05,재직\n";
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "행정전화부-가져오기양식.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // ---------- 연락처 CSV 내보내기 (가져오기 양식과 동일 열 → 재가져오기 호환) ----------
  function csvCell(v) {
    v = (v == null ? "" : String(v));
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // 조직 경로(top→leaf) 이름들을 [상위부서, 부서, 팀] 3열로 매핑.
  // 3단 이하: 앞에서부터 채움(양식 관례). 3단 초과: 가장 가까운 3단(상위2+말단).
  function hier3(names) {
    var p = (names || []).filter(Boolean);
    if (p.length <= 3) return [p[0] || "", p[1] || "", p[2] || ""];
    return [p[p.length - 3], p[p.length - 2], p[p.length - 1]];
  }
  function dateStamp() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  }
  // 조직도(직제) 순서 그대로 평탄화 — 가나다 정렬로 내보내면 재가져오기 시 부서가
  // 그 순서로 생성돼 조직 구조가 흐트러지므로, 화면 조직도와 동일 순서로 출력한다.
  function orgOrderedContacts() {
    var ordered = [];
    if (window.Data && Data.groupedByOrg) {
      (function flat(nodes) {
        nodes.forEach(function (n) {
          (n.members || []).forEach(function (m) { ordered.push(m); }); // 부모 직속 인원 먼저
          if (n.children && n.children.length) flat(n.children);        // 그 다음 하위 부서
        });
      })(Data.groupedByOrg());
    } else if (window.Data && Data.getAllContacts) {
      ordered = Data.getAllContacts();
    }
    return ordered;
  }
  function exportContactsCSV() {
    var ordered = orgOrderedContacts();
    if (!ordered.length) { showSnack("내보낼 연락처가 없습니다."); return; }
    var headers = ["이름", "상위부서", "부서", "팀", "직책", "직급", "담당업무", "휴대전화", "행정번호", "생년월일", "재직상태"];
    var lines = [headers.join(",")];
    ordered.forEach(function (c) {
      var path = (Data.deptPath ? Data.deptPath(c.deptId) : []).map(function (p) { return p.name; });
      var h3 = hier3(path), status = (c.status && c.status !== "미설정") ? c.status : "";
      lines.push([
        c.name || "", h3[0], h3[1], h3[2],
        c.position || "", c.grade || "", c.work || "",
        c.phone || "", c.tel || "", c.birth || "", status,
      ].map(csvCell).join(","));
    });
    var csv = "﻿" + lines.join("\r\n") + "\r\n"; // BOM(엑셀 한글) + CRLF
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "행정전화부-연락처-" + dateStamp() + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showSnack(ordered.length + "건을 CSV로 내보냈습니다.");
  }
  document.getElementById("export-contacts-csv-btn").addEventListener("click", exportContactsCSV);

  // 연락처 vCard(.vcf) 일괄 내보내기 — 폰/Outlook 주소록에 바로 추가
  function exportContactsVCard() {
    var ordered = orgOrderedContacts();
    if (!ordered.length) { showSnack("내보낼 연락처가 없습니다."); return; }
    var n = UI.downloadVCards(ordered, "행정전화부-연락처-" + dateStamp() + ".vcf");
    showSnack(n + "건을 vCard로 내보냈습니다.");
  }
  var vcardBtn = document.getElementById("export-contacts-vcard-btn");
  if (vcardBtn) vcardBtn.addEventListener("click", exportContactsVCard);

  // 데이터 점검 리포트(읽기 전용): 중복 전화·부서 미배정·생일형식·빈 부서명
  function showDataCheck() {
    if (!(window.Data && Data.validateContacts)) return;
    var r = Data.validateContacts();
    var parts = [];
    if (r.dupPhones.length) {
      parts.push("● 중복 전화 " + r.dupPhones.length + "건");
      r.dupPhones.slice(0, 8).forEach(function (d) {
        parts.push("   " + UI.formatPhone(d.phone) + " — " + d.people.map(function (c) { return c.name; }).join(", "));
      });
      if (r.dupPhones.length > 8) parts.push("   …외 " + (r.dupPhones.length - 8) + "건");
    }
    if (r.orphans.length) {
      parts.push("● 부서 미배정 " + r.orphans.length + "명: " +
        r.orphans.slice(0, 10).map(function (c) { return c.name; }).join(", ") + (r.orphans.length > 10 ? " …" : ""));
    }
    if (r.badBirth.length) {
      parts.push("● 생년월일 형식 오류 " + r.badBirth.length + "건(YYYY-MM-DD 아님): " +
        r.badBirth.slice(0, 10).map(function (c) { return c.name + "(" + c.birth + ")"; }).join(", ") + (r.badBirth.length > 10 ? " …" : ""));
    }
    if (r.emptyDepts.length) parts.push("● 이름 없는 부서 " + r.emptyDepts.length + "개");
    var msg = parts.length ? parts.join("\n") : "발견된 문제가 없습니다. 데이터가 깨끗합니다 👍";
    appDialog({ title: "데이터 점검", message: msg, okLabel: "확인", cancelLabel: "" });
  }
  var checkBtn = document.getElementById("data-check-btn");
  if (checkBtn) checkBtn.addEventListener("click", showDataCheck);

  // ---------- 전역 키보드 (Esc 닫기 / 오버레이 포커스 트랩) ----------
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (anyOverlayOpen()) { closeTop(false); return; }
      if (searchInput.value) { searchClear.click(); }
      return;
    }
    if (e.key === "Tab") {
      var ov = topOverlay();
      if (!ov) return;
      var f = Array.prototype.filter.call(
        ov.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])'),
        function (x) { return !x.disabled && x.offsetParent !== null; }
      );
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ---------- 히스토리(뒤로가기로 오버레이 닫기) ----------
  window.addEventListener("popstate", function (e) {
    // 코드에서 오버레이를 직접 닫으며 부른 back 의 popstate 는 이미 처리됨 → 1회 무시
    // (중첩 오버레이에서 아래 오버레이까지 닫히는 버그 방지).
    if (selfPops > 0) { selfPops--; return; }
    if (anyOverlayOpen()) {
      closeTop(true);
    } else if (searchPushed) {
      // 검색 중 뒤로가기 → 앱을 나가지 않고 검색어부터 비운다
      searchPushed = false;
      resetSearchUI();
    } else if (e.state && e.state.detail) {
      var c = Data.getById(e.state.detail);
      if (c) openDetail(c);
    }
  });

  function openFromHash() {
    var m = location.hash.match(/^#contact\/(\d+)$/);
    if (m) {
      var c = Data.getById(parseInt(m[1], 10));
      if (c) openDetail(c);
    } else if (location.hash === "#settings") {
      openSettings();
    } else if (location.hash === "#favorites") {
      switchTab(tabs[1]);
    } else if (location.hash === "#recent") {
      switchTab(tabs[2]);
    } else if (location.hash === "#org") {
      switchTab(tabs[3]);
    }
  }

  // ---------- 부팅 ----------
  UI.renderSkeleton(listEl, 8);
  var photosReady = (window.Photos && Photos.loadAll) ? Photos.loadAll() : Promise.resolve();
  Data.load()
    .then(function () { return photosReady; })
    .then(function () {
      render();
      openFromHash();
      rebuildSearchSuggest();
      focusSearchIfIdle(); // 부팅 직후 리스트면 검색창 선포커스(한글 첫 글자 유실 방지)
    })
    .catch(function (err) {
      listEl.textContent = "";
      listEl.appendChild(UI.emptyState(
        "데이터를 불러오지 못했습니다.\n" + err.message,
        "다시 시도",
        function () {
          UI.renderSkeleton(listEl, 8);
          Data.load().then(function () { render(); })
            .catch(function (e2) {
              listEl.textContent = "";
              listEl.appendChild(UI.emptyState("여전히 실패했습니다.\n" + e2.message,
                "다시 시도", function () { location.reload(); }));
            });
        }
      ));
    });

  // ---------- PWA: 서비스워커 + 자동 업데이트 ----------
  // SW가 install 시 skipWaiting → activate 에서 clients.claim 하므로 새 버전이 곧바로
  // 제어권을 잡는다. controllerchange 가 오면 자동으로 한 번 새로고침해 최신 코드를 반영.
  // (작업 중이면 maybeReloadForUpdate 가 오버레이 닫힐 때까지 미룸)
  if ("serviceWorker" in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) return; // 최초 설치(처음 제어권 획득)에는 새로고침하지 않음
      swPendingReload = true;
      maybeReloadForUpdate();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") maybeReloadForUpdate();
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        // 새 배포 자동 감지: 설치형 PWA는 내비게이션이 드물어 브라우저 자동 확인이 약하다.
        // 로드 직후 + 주기적 + 앱이 다시 보일 때 + 온라인 복귀 시 직접 확인 → 자동 적용.
        function checkForUpdate() { if (reg.update) reg.update().catch(function () {}); }
        checkForUpdate();
        setInterval(checkForUpdate, 15 * 60 * 1000); // 15분마다
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") checkForUpdate();
        });
        window.addEventListener("online", checkForUpdate);
      }).catch(function () {});
    });
  }

  // ---------- PWA: 설치 프롬프트 ----------
  var deferredPrompt = null;
  var installToast = document.getElementById("install-toast");
  var INSTALL_DISMISS_KEY = "dongguDial.installDismissed.v1";

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem(INSTALL_DISMISS_KEY) && document.getElementById("update-toast").hidden) {
      installToast.hidden = false;
    }
  });
  document.getElementById("install-btn").addEventListener("click", function () {
    installToast.hidden = true;
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
    }
  });
  document.getElementById("install-dismiss").addEventListener("click", function () {
    installToast.hidden = true;
    try { localStorage.setItem(INSTALL_DISMISS_KEY, "1"); } catch (e) {}
  });
})();
