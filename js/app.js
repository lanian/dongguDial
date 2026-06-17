/**
 * 앱 컨트롤러: 탭/검색/상세/설정 라우팅, 접근성(포커스·키보드), 서비스워커, 설치.
 */
(function () {
  "use strict";

  var APP_VERSION = "84"; // SW 캐시(donggu-dial-vNN)와 함께 갱신
  var ORG_HDR_H = 44;     // 조직도 헤더 높이(CSS --org-hdr-h 와 동기화) — 계단식 sticky 점프 보정용
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
  var current = { tab: "all", query: "", detailId: null, sort: "dept", collapsed: {}, orgCollapsed: {}, favCollapsed: {}, orgReorder: false, deptMgrCollapsed: {} };
  var editId = null;
  var orgInit = false; // 조직도 첫 진입 시 모두 접기 1회 적용 플래그
  var pendingPhoto; // undefined=변경없음, null=제거, string=새 dataURL
  var pendingDefaultIcon; // undefined=변경없음, true=기본 아이콘(실루엣), false=아님
  var bgEls = [appBar, tabsNav, listEl];
  var focusStack = [];

  function pushFocus() { focusStack.push(document.activeElement); }
  function popFocus() {
    var el = focusStack.pop();
    if (el && document.contains(el) && el.focus) el.focus();
    else if (listEl && listEl.focus) listEl.focus(); // 재렌더로 원래 요소가 사라진 경우 폴백
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
    var show = !anyOverlayOpen() && !current.query && current.tab === "all";
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

  function render() { renderBody(); updateFab(); }

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
            "연산자: 공백=모두포함 · -제외 · 부서:·직책:·상태: · \"구\" · |=또는",
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
      if (!orgInit) { // 처음 조직도 진입 시 모두 접힌 상태로 시작
        depts.forEach(function (d) { current.orgCollapsed[d.id] = true; });
        orgInit = true;
      }
      var allCol = depts.length > 0 && depts.every(function (d) { return current.orgCollapsed[d.id]; });
      UI.renderOrgView(listEl, Data.groupedByOrg(), {
        onOpen: openDetail, onFav: onFavChanged,
        collapsed: current.orgCollapsed,
        onToggle: function (id) {
          current.orgCollapsed[id] = !current.orgCollapsed[id];
          render();
          // 토글 시 render()가 DOM을 재생성해 포커스가 소실되므로 같은 헤더로 복원하고,
          // 상태 변화를 aria-live(#result-status)로 알려 키보드·스크린리더 위치를 유지한다.
          var h = document.getElementById("org-" + id);
          if (h) h.focus();
          if (resultStatus) resultStatus.textContent = current.orgCollapsed[id] ? "접음" : "펼침";
        },
        onManage: openDeptMgr,
        allCollapsed: allCol,
        onToggleAll: function () {
          var ds = Data.getDepartments();
          var anyOpen = ds.some(function (d) { return !current.orgCollapsed[d.id]; });
          if (anyOpen) ds.forEach(function (d) { current.orgCollapsed[d.id] = true; });
          else current.orgCollapsed = {};
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
        onToggle: function (gid) { current.favCollapsed[gid] = !current.favCollapsed[gid]; render(); },
        onAddGroup: addFavGroupPrompt,
        onRenameGroup: renameFavGroupPrompt,
        onRemoveGroup: removeFavGroupConfirm,
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
    if (!fromPop && location.hash === "#photo") history.back();
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
    if (!fromPop && location.hash === "#dept-pick") history.back();
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
      var hasInput = opts.value !== undefined;
      var input = null;
      if (hasInput) {
        input = mk("input", "app-dialog-input");
        input.type = "text";
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
      btns.appendChild(okBtn);
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
        else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); confirm(); }
      }
      cancelBtn.addEventListener("click", function () { done(null); });
      okBtn.addEventListener("click", confirm);
      backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) done(null); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(backdrop);
      if (vv) { vv.addEventListener("resize", fitViewport); vv.addEventListener("scroll", fitViewport); fitViewport(); }
      (hasInput ? input : okBtn).focus();
      if (hasInput) input.select();
    });
  }

  function addFavGroupPrompt() {
    appDialog({ title: "새 그룹", value: "", placeholder: "그룹 이름", okLabel: "추가" }).then(function (name) {
      if (!name) return;
      Storage.addFavGroup(name);
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
        var id = Storage.addFavGroup(name);
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
    if (!fromPop && location.hash === "#fav-group-pick") history.back();
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

  // 파일 → 256px 정사각 JPEG dataURL(중앙 크롭, 압축)
  function fileToAvatar(file) {
    return new Promise(function (res, rej) {
      if (!file.type || file.type.indexOf("image/") !== 0) { rej(new Error("이미지 파일이 아닙니다")); return; }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var S = 256, cv = document.createElement("canvas");
          cv.width = S; cv.height = S;
          var ctx = cv.getContext("2d");
          var m = Math.min(img.width, img.height), sx = (img.width - m) / 2, sy = (img.height - m) / 2;
          ctx.drawImage(img, sx, sy, m, m, 0, 0, S, S);
          URL.revokeObjectURL(url);
          res(cv.toDataURL("image/jpeg", 0.8));
        } catch (e) { URL.revokeObjectURL(url); rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("이미지를 읽지 못했습니다")); };
      img.src = url;
    });
  }

  // 편집 폼의 사진 미리보기/선택/제거 연결
  function setupPhotoControls(contact) {
    var prev = document.getElementById("ef-photo-prev");
    var fileInp = document.getElementById("ef-photo-file");
    function paint() {
      prev.textContent = ""; prev.className = "ef-photo-prev"; prev.style.background = "";
      var cur = pendingPhoto !== undefined ? pendingPhoto : ((window.Photos && contact.id != null) ? Photos.get(contact.id) : null);
      var useDefault = pendingDefaultIcon !== undefined ? pendingDefaultIcon : !!contact.defaultIcon;
      if (cur) { var im = document.createElement("img"); im.src = cur; im.alt = "미리보기"; prev.appendChild(im); }
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
      fileToAvatar(f).then(function (d) { pendingPhoto = d; pendingDefaultIcon = false; paint(); })
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
    if (!fromPop && location.hash) history.back();
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
    if (current.query) {
      searchInput.value = "";
      current.query = "";
      searchClear.hidden = true;
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
  var searchTimer;
  searchInput.addEventListener("input", function () {
    current.query = searchInput.value;
    searchClear.hidden = !searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 120);
  });
  searchClear.addEventListener("click", function () {
    searchInput.value = "";
    current.query = "";
    searchClear.hidden = true;
    render();
    searchInput.focus();
  });

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
    refreshCounts();
    document.getElementById("settings-version").textContent = "v" + APP_VERSION;
    pushFocus();
    settingsEl.hidden = false;
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
    if (!fromPop && location.hash === "#settings") history.back();
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

  document.getElementById("export-btn").addEventListener("click", function () {
    var data = Storage.exportData();
    if (window.Photos) data.photos = Photos.all();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var d = new Date();
    var stamp = d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    var a = document.createElement("a");
    a.href = url;
    a.download = "행정전화부-백업-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
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
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { showSnack("가져오기 실패: " + e.message); return; }
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
    if (!fromPop && location.hash === "#edit") history.back();
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
      position: val("ef-position"), work: val("ef-work"),
      phone: val("ef-phone"), tel: val("ef-tel"), birth: val("ef-birth"),
      status: val("ef-status") || "미설정",
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
    appDialog({ title: "연락처 삭제", message: "이 연락처를 삭제할까요?", okLabel: "삭제", danger: true }).then(function (ok) {
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
    if (!fromPop && location.hash === "#depts") history.back();
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
    if (!fromPop && location.hash === "#dept-edit") history.back();
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
    position: ["직책", "직위", "직급", "position"],
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
    var added = 0, skipped = 0;
    rows.forEach(function (r) {
      var name = v(r, "name");
      if (!name) { skipped++; return; }
      var pathNames = hierHeaders.map(function (h) { return h ? (r[h] || "").trim() : ""; });
      var leaf = resolveDeptPath(pathNames);
      Storage.addContact({
        name: name, deptId: leaf.id, dept: leaf.name, team: "",
        position: v(r, "position"), work: v(r, "work"),
        phone: v(r, "phone"), tel: v(r, "tel"), birth: v(r, "birth"),
        status: normStatus(v(r, "status")),
      });
      added++;
    });
    return { added: added, skipped: skipped, newDepts: newDepts };
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
        var msg = importMode === "replace"
          ? "초기화 후 가져오기: 기존 샘플·편집·추가·가져온 연락처와 부서를 모두 비우고 이 파일(" + rows.length + "건)만 남깁니다. 계속할까요?"
          : rows.length + "건을 가져옵니다. 기존 데이터에 추가됩니다. 계속할까요?";
        appDialog({
          title: "연락처 가져오기", message: msg,
          okLabel: importMode === "replace" ? "대체" : "가져오기", danger: importMode === "replace",
        }).then(function (ok) {
          if (!ok) return;
          if (importMode === "replace") { Storage.resetAllEdits(); if (window.Photos) Photos.clearAll(); Storage.setBaseHidden(true); Data.rebuild(); }
          var res;
          try { res = applyContactImport(rows); }
          catch (e) { showSnack("가져오기 실패: " + e.message); return; }
          Data.rebuild(); render(); refreshCounts();
          showSnack((importMode === "replace" ? "대체 완료: " : "가져오기 완료: ") +
            res.added + "명" + (res.newDepts ? " · 신규 부서 " + res.newDepts + "개" : "") +
            (res.skipped ? " · 건너뜀 " + res.skipped + "건" : ""));
        });
      }).catch(function (e) { showSnack("가져오기 실패: " + e.message); });
    };
    reader.onerror = function () { showSnack("파일을 읽지 못했습니다."); };
    reader.readAsArrayBuffer(file); // CSV/XLSX 모두 ArrayBuffer로 읽어 인코딩 자동 판별
  });
  document.getElementById("import-template-btn").addEventListener("click", function () {
    var csv = "이름,상위부서,부서,팀,직책,담당업무,휴대전화,행정번호,생년월일,재직상태\n" +
      "홍길동,행정복지국,자치행정과,총무팀,팀장,총무,010-1234-5678,062-608-0000,1980-01-01,재직\n" +
      "김영희,행정복지국,자치행정과,,과장,자치행정,010-2222-3333,062-608-0001,1978-05-05,재직\n";
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "행정전화부-가져오기양식.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

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
    if (anyOverlayOpen()) {
      closeTop(true);
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
