/**
 * 앱 컨트롤러: 탭/검색/상세/설정 라우팅, 접근성(포커스·키보드), 서비스워커, 설치.
 */
(function () {
  "use strict";

  var APP_VERSION = "40"; // SW 캐시(donggu-dial-vNN)와 함께 갱신
  var listEl = document.getElementById("list");
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
  var listTools = document.getElementById("list-tools");
  var deptNav = document.getElementById("dept-nav");
  // PC: 세로 마우스 휠을 부서 칩 바의 가로 스크롤로 변환(트랙패드 가로 스와이프는 그대로).
  deptNav.addEventListener("wheel", function (e) {
    if (e.deltaY === 0) return; // 이미 가로 스크롤(트랙패드 등)이면 개입 안 함
    var max = deptNav.scrollWidth - deptNav.clientWidth;
    if (max <= 0) return; // 넘칠 게 없으면 페이지 스크롤 유지
    var atStart = deptNav.scrollLeft <= 0;
    var atEnd = deptNav.scrollLeft >= max - 1;
    // 끝에 닿았는데 더 진행하려는 휠은 페이지로 흘려보냄(스크롤 트랩 방지)
    if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
    deptNav.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  var alphaRail = document.getElementById("alpha-rail");
  var snackbar = document.getElementById("snackbar");
  var sortBtns = Array.prototype.slice.call(document.querySelectorAll(".sort-seg .seg-btn"));
  var themeBtns = Array.prototype.slice.call(document.querySelectorAll(".theme-seg .seg-btn"));

  var photoViewerEl = document.getElementById("photo-viewer");
  var deptPickerEl = document.getElementById("dept-picker");
  var deptPickerOpts = null;
  var favGroupPickerEl = document.getElementById("fav-group-picker");
  var favGroupPickerContact = null;
  var current = { tab: "all", query: "", detailId: null, sort: "dept", collapsed: {}, orgCollapsed: {}, favCollapsed: {}, orgReorder: false };
  var editId = null;
  var orgInit = false; // 조직도 첫 진입 시 모두 접기 1회 적용 플래그
  var pendingPhoto; // undefined=변경없음, null=제거, string=새 dataURL
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
  function syncInert() { setBgInert(anyOverlayOpen()); restack(); }
  function updateFab() {
    var show = !anyOverlayOpen() && !current.query && !current.orgReorder &&
      (current.tab === "all" || current.tab === "org");
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

  function showTools(on) {
    listTools.hidden = !on;
  }
  function showDeptNav(on) {
    deptNav.hidden = !on;
    deptNav.style.display = on ? "" : "none";
  }
  function showAlphaRail(on) {
    alphaRail.hidden = !on;
  }

  function buildDeptNav(groups) {
    deptNav.textContent = "";
    var frag = document.createDocumentFragment();
    // 최상위(국/실/관)만 칩으로 — 클릭 시 해당 부서 섹션으로 이동
    groups.filter(function (g) {
      return (window.Data && Data.depthOf) ? Data.depthOf(g.dept.id) === 0 : true;
    }).forEach(function (g) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "dept-chip";
      chip.textContent = g.dept.name;
      chip.addEventListener("click", function () {
        current.collapsed[g.dept.id] = false;
        render();
        scrollToEl(document.getElementById("dept-" + g.dept.id));
      });
      frag.appendChild(chip);
    });
    deptNav.appendChild(frag);
  }

  function buildAlphaRail(groups) {
    alphaRail.textContent = "";
    var frag = document.createDocumentFragment();
    groups.forEach(function (g) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "alpha-key";
      b.textContent = g.key;
      b.setAttribute("aria-label", g.key + "로 이동");
      b.addEventListener("click", function () {
        scrollToEl(document.getElementById("grp-" + g.key));
      });
      frag.appendChild(b);
    });
    alphaRail.appendChild(frag);
  }

  function scrollToEl(el) {
    if (!el) return;
    var off = appBar.offsetHeight + tabsNav.offsetHeight + 4;
    var y = el.getBoundingClientRect().top + window.scrollY - off;
    window.scrollTo({ top: y, behavior: "smooth" });
  }

  function render() { renderBody(); updateFab(); }

  function renderBody() {
    var q = current.query.trim();
    if (q) {
      showTools(false); showDeptNav(false); showAlphaRail(false);
      var results = Data.search(q);
      if (results.length && current.sort === "dept") {
        // 부서순일 때는 검색 결과도 부서 섹션으로 묶어서 표시
        UI.renderDeptView(listEl, Data.groupContactsByDept(results), {
          onOpen: openDetail, onFav: onFavChanged, query: q,
        });
      } else {
        UI.renderFlat(listEl, results, {
          onOpen: openDetail, onFav: onFavChanged, query: q,
          emptyMsg: "‘" + q + "’ 검색 결과가 없습니다.",
        });
      }
      resultStatus.textContent = results.length + "건 검색됨";
      return;
    }
    resultStatus.textContent = "";

    if (current.tab === "all") {
      showTools(true);
      if (current.sort === "name") {
        showDeptNav(false);
        var ng = Data.groupedByName();
        UI.renderNameView(listEl, ng, { onOpen: openDetail, onFav: onFavChanged });
        buildAlphaRail(ng);
        showAlphaRail(true);
      } else {
        showAlphaRail(false);
        showDeptNav(false); // 부서순: 상단 부서 칩 바 제거
        var dg = Data.groupedByDept();
        UI.renderDeptView(listEl, dg, {
          onOpen: openDetail, onFav: onFavChanged,
          collapsed: current.collapsed,
          onToggle: function (id) { current.collapsed[id] = !current.collapsed[id]; render(); },
        });
      }
      return;
    }

    showTools(false); showDeptNav(false); showAlphaRail(false);
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
        onToggle: function (id) { current.orgCollapsed[id] = !current.orgCollapsed[id]; render(); },
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
      });
    } else if (current.tab === "favorites") {
      showTools(false); showDeptNav(false); showAlphaRail(false);
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
      UI.renderFlat(listEl, Data.resolveIds(Storage.getRecent()), {
        onOpen: openDetail, onFav: onFavChanged,
        emptyMsg: "최근 본 연락처가 없습니다.",
        actionLabel: "전체에서 찾기", onAction: function () { switchTab(tabs[0]); },
      });
    }
  }

  // 정렬 세그먼트
  sortBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      current.sort = b.dataset.sort;
      sortBtns.forEach(function (x) {
        var on = x === b;
        x.classList.toggle("is-active", on);
        x.setAttribute("aria-pressed", on ? "true" : "false");
      });
      render();
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
  function goToOrg(deptId) {
    closeDetail(false);
    switchTab(tabs[3]); // 조직도
    Data.deptPath(deptId).forEach(function (p) { current.orgCollapsed[p.id] = false; });
    render();
    setTimeout(function () { scrollToEl(document.getElementById("org-" + deptId)); }, 60);
  }

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
  function addFavGroupPrompt() {
    var name = window.prompt("새 그룹 이름");
    if (name == null) return;
    name = name.trim();
    if (!name) return;
    Storage.addFavGroup(name);
    render();
    showSnack("그룹 ‘" + name + "’ 추가됨");
  }
  function renameFavGroupPrompt(g) {
    var name = window.prompt("그룹 이름 변경", g.name);
    if (name == null) return;
    name = name.trim();
    if (!name) return;
    Storage.renameFavGroup(g.id, name);
    if (!favGroupPickerEl.hidden) renderFavGroupPickerList();
    render();
  }
  function removeFavGroupConfirm(g) {
    if (!window.confirm("‘" + g.name + "’ 그룹을 삭제할까요?\n그룹만 사라지고 연락처의 즐겨찾기는 유지됩니다.")) return;
    Storage.removeFavGroup(g.id);
    render();
    showSnack("그룹 삭제됨");
  }
  function renderFavGroupPickerList() {
    if (!favGroupPickerContact) return;
    var sel = {};
    Storage.getContactFavGroups(favGroupPickerContact.id).forEach(function (gid) { sel[gid] = true; });
    UI.renderFavGroupPicker(document.getElementById("fav-group-picker-list"), {
      groups: Storage.getFavGroups(),
      selected: sel,
      onToggle: function (gid) {
        Storage.toggleContactFavGroup(favGroupPickerContact.id, gid);
        renderFavGroupPickerList();
        render(); // 뒤 목록 갱신
      },
      onAddGroup: function () {
        var name = window.prompt("새 그룹 이름");
        if (name == null) return;
        name = name.trim();
        if (!name) return;
        var id = Storage.addFavGroup(name);
        if (id) Storage.toggleContactFavGroup(favGroupPickerContact.id, id);
        renderFavGroupPickerList();
        render();
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
      if (cur) { var im = document.createElement("img"); im.src = cur; im.alt = "미리보기"; prev.appendChild(im); }
      else {
        prev.classList.add("ef-photo-initial");
        prev.style.background = UI.avatarColor(contact.name || "");
        prev.textContent = (contact.name || "?").trim().charAt(0) || "?";
      }
    }
    paint();
    document.getElementById("ef-photo-pick").addEventListener("click", function () { fileInp.value = ""; fileInp.click(); });
    document.getElementById("ef-photo-remove").addEventListener("click", function () { pendingPhoto = null; paint(); });
    fileInp.addEventListener("change", function () {
      var f = fileInp.files && fileInp.files[0];
      if (!f) return;
      fileToAvatar(f).then(function (d) { pendingPhoto = d; paint(); })
        .catch(function (e) { window.alert("사진 처리 실패: " + e.message); });
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
    window.scrollTo({ top: 0 });
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
    var t = "즐겨찾기 " + c.favorites + " · 최근 " + c.recent;
    if (c.edits || c.custom) t += " · 편집 " + c.edits + " · 추가 " + c.custom;
    if (c.deptEdits || c.deptCustom) t += " · 부서변경 " + (c.deptEdits + c.deptCustom);
    settingsCounts.textContent = t;
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
        if (reg.waiting) { showUpdateToast(reg); showSnack("새 버전이 있습니다 — 새로고침하세요"); return; }
        var sw = reg.installing;
        if (sw) {
          showSnack("새 버전을 받는 중…");
          sw.addEventListener("statechange", function () {
            if (sw.state === "installed") { showUpdateToast(reg); showSnack("새 버전 준비됨 — 새로고침하세요"); }
          });
          return;
        }
        showSnack("최신 버전입니다 (v" + APP_VERSION + ")");
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
      catch (e) { window.alert("가져오기 실패: " + e.message); return; }
      if (backupImportMode === "replace" &&
          !window.confirm("초기화 후 복구: 기존 즐겨찾기·편집·추가·부서·사진을 모두 비우고 이 백업으로 대체합니다. 계속할까요?")) {
        return;
      }
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
        window.alert((backupImportMode === "replace" ? "대체 복구 완료: " : "복구 완료: ") +
          "즐겨찾기 " + result.favorites + ", 최근 " + result.recent +
          ", 편집 " + result.edits + ", 추가 " + result.custom);
      } catch (e) {
        window.alert("가져오기 실패: " + e.message);
      }
    };
    reader.onerror = function () { window.alert("파일을 읽지 못했습니다."); };
    reader.readAsText(file);
  });

  // ---------- 연락처 편집 / 추가 (로컬 오버레이) ----------
  function openEditor(contact) {
    editId = contact ? contact.id : null;
    document.getElementById("editor-bar-title").textContent = contact ? "연락처 편집" : "연락처 추가";
    var depts = Data.getDepartments();
    UI.renderEditForm(editorBody, contact || { deptId: depts[0] && depts[0].id }, depts);
    pendingPhoto = undefined;
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
    if (!name) { window.alert("이름을 입력하세요."); return; }
    var deptId = realDeptId(val("ef-dept"));
    var d0 = Data.getDeptById(deptId);
    var dept = d0 ? d0.name : "";
    var fields = {
      name: name, deptId: deptId, dept: dept,
      position: val("ef-position"), work: val("ef-work"),
      phone: val("ef-phone"), tel: val("ef-tel"), birth: val("ef-birth"),
      status: val("ef-status") || "미설정",
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
    if (!window.confirm("이 연락처를 삭제할까요?")) return;
    var delId = editId;
    Storage.deleteContact(delId);
    if (window.Photos) Photos.remove(delId);
    Data.rebuild();
    closeEditor(false);
    if (!detailEl.hidden && current.detailId === delId) closeDetail(false);
    render();
    showSnack("삭제되었습니다");
  }
  document.getElementById("editor-cancel").addEventListener("click", function () { closeEditor(false); });
  document.getElementById("editor-save").addEventListener("click", saveEditor);
  document.getElementById("editor-delete").addEventListener("click", deleteEditor);
  fab.addEventListener("click", function () { openEditor(null); });
  document.getElementById("reset-edits-btn").addEventListener("click", function () {
    if (!window.confirm("수정·추가한 연락처와 부서를 모두 초기화할까요?")) return;
    Storage.resetAllEdits();
    if (window.Photos) Photos.clearAll();
    Data.rebuild();
    refreshCounts();
    render();
    showSnack("초기화되었습니다");
  });

  // ---------- 부서 관리 (로컬 오버레이) ----------
  function renderDeptMgrList() {
    UI.renderDeptManager(deptMgrBody, Data.getDepartments(),
      { direct: Data.directCountByDept(), child: Data.childCountByParent() },
      { onEdit: openDeptEditor, onMove: moveDept, onAddChild: function (d) { openDeptEditor(null, d.id); } });
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
    if (!name) { window.alert("부서명을 입력하세요."); return; }
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
  function deleteDeptEditor() {
    if (deptEditId == null) return;
    var dept = Data.getDeptById(deptEditId);
    var dc = Data.directCountByDept()[deptEditId] || 0;
    var cc = Data.childCountByParent()[deptEditId] || 0;
    if (dc || cc) {
      var up = (dept && dept.parentId) || 0;
      var upDept = up ? Data.getDeptById(up) : null;
      var upName = upDept ? upDept.name : "최상위(미지정)";
      if (!window.confirm("이 부서에 인원 " + dc + "명, 하위 부서 " + cc + "개가 있습니다.\n이들을 상위(" + upName + ")로 옮기고 삭제할까요?")) return;
      Data.getDepartments().filter(function (d) { return d.parentId === deptEditId; })
        .forEach(function (ch) { Storage.saveDept(ch.id, { parentId: up, level: up ? Data.depthOf(up) + 1 : 0 }); });
      Data.membersOfDept(deptEditId).forEach(function (c) {
        Storage.saveContact(c.id, { deptId: up, dept: upDept ? upDept.name : "" });
      });
    } else {
      if (!window.confirm("이 부서를 삭제할까요?")) return;
    }
    Storage.deleteDept(deptEditId);
    Data.rebuild();
    closeDeptEditor(false);
    renderDeptMgrList();
    render();
    refreshCounts();
    showSnack("부서가 삭제되었습니다");
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
    tel: ["사내번호", "내선", "내선번호", "사무실", "직통", "전화", "tel"],
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
      } catch (e) { window.alert("가져오기 실패: " + e.message); return; }
      parse.then(function (rows) {
        if (!rows || !rows.length) { window.alert("가져올 행이 없습니다."); return; }
        var msg = importMode === "replace"
          ? "초기화 후 가져오기: 기존 샘플·편집·추가·가져온 연락처와 부서를 모두 비우고 이 파일(" + rows.length + "건)만 남깁니다. 계속할까요?"
          : rows.length + "건을 가져옵니다. 기존 데이터에 추가됩니다. 계속할까요?";
        if (!window.confirm(msg)) return;
        if (importMode === "replace") { Storage.resetAllEdits(); if (window.Photos) Photos.clearAll(); Storage.setBaseHidden(true); Data.rebuild(); }
        var res;
        try { res = applyContactImport(rows); }
        catch (e) { window.alert("가져오기 실패: " + e.message); return; }
        Data.rebuild(); render(); refreshCounts();
        showSnack((importMode === "replace" ? "대체 완료: " : "가져오기 완료: ") +
          res.added + "명" + (res.newDepts ? " · 신규 부서 " + res.newDepts + "개" : ""));
        if (res.skipped) window.alert("이름이 없어 건너뛴 행: " + res.skipped + "건");
      }).catch(function (e) { window.alert("가져오기 실패: " + e.message); });
    };
    reader.onerror = function () { window.alert("파일을 읽지 못했습니다."); };
    reader.readAsArrayBuffer(file); // CSV/XLSX 모두 ArrayBuffer로 읽어 인코딩 자동 판별
  });
  document.getElementById("import-template-btn").addEventListener("click", function () {
    var csv = "이름,상위부서,부서,팀,직책,담당업무,휴대전화,사내번호,생년월일,재직상태\n" +
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

  // ---------- sticky 오프셋 실측 ----------
  // 앱바/탭의 실제 높이를 CSS 변수로 반영해 탭·섹션헤더 sticky 위치를 정확히 맞춘다.
  // (고정 픽셀이면 폰트·safe-area·데스크톱 줌에 따라 어긋나 스크롤 시 헤더가 본문을 파고듦)
  function syncStickyOffsets() {
    var hb = appBar.offsetHeight;
    var ht = tabsNav.offsetHeight;
    document.documentElement.style.setProperty("--header-h", hb + "px");
    document.documentElement.style.setProperty("--tabs-h", ht + "px");
  }
  syncStickyOffsets(); // 첫 페인트부터 정확하도록 즉시 1회 실측
  window.addEventListener("resize", syncStickyOffsets);
  window.addEventListener("orientationchange", syncStickyOffsets);
  window.addEventListener("load", syncStickyOffsets);
  // 창 리사이즈가 없어도 헤더 높이가 바뀌면(폰트 적용·동적 변화·줌) 즉시 재동기화
  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(function () { syncStickyOffsets(); });
    ro.observe(appBar);
    ro.observe(tabsNav);
  }

  // ---------- 부팅 ----------
  UI.renderSkeleton(listEl, 8);
  var photosReady = (window.Photos && Photos.loadAll) ? Photos.loadAll() : Promise.resolve();
  Data.load()
    .then(function () { return photosReady; })
    .then(function () {
      render();
      syncStickyOffsets();
      openFromHash();
    })
    .catch(function (err) {
      listEl.textContent = "";
      listEl.appendChild(UI.emptyState(
        "데이터를 불러오지 못했습니다.\n" + err.message,
        "다시 시도",
        function () {
          UI.renderSkeleton(listEl, 8);
          Data.load().then(function () { render(); syncStickyOffsets(); })
            .catch(function (e2) {
              listEl.textContent = "";
              listEl.appendChild(UI.emptyState("여전히 실패했습니다.\n" + e2.message,
                "다시 시도", function () { location.reload(); }));
            });
        }
      ));
    });

  // ---------- PWA: 서비스워커 + 업데이트 ----------
  // 사용자가 "새로고침"을 눌렀을 때만 true. 새 워커가 제어권을 잡는
  // controllerchange 시점에 reload 해야 즉시(한 번에) 반영된다.
  var awaitingActivation = false;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!awaitingActivation) return; // 최초 설치(컨트롤러 최초 획득) 때는 무시
      awaitingActivation = false;
      window.location.reload();
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        reg.addEventListener("updatefound", function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", function () {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateToast(reg);
            }
          });
        });
      }).catch(function () {});
    });
  }

  function activateUpdate(reg) {
    // 대기 중인 새 워커에게 즉시 활성화를 요청. 실제 reload 는
    // controllerchange 리스너가 새 워커가 제어권을 잡은 뒤에 수행한다.
    awaitingActivation = true;
    if (reg && reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      // 대기 워커가 없으면(이미 활성/예외) 안전하게 즉시 reload
      awaitingActivation = false;
      window.location.reload();
      return;
    }
    // controllerchange 가 끝내 오지 않을 때를 대비한 안전 폴백
    setTimeout(function () {
      if (awaitingActivation) {
        awaitingActivation = false;
        window.location.reload();
      }
    }, 3000);
  }

  function showUpdateToast(reg) {
    var toast = document.getElementById("update-toast");
    toast.hidden = false;
    document.getElementById("update-btn").onclick = function () {
      activateUpdate(reg);
    };
    document.getElementById("update-dismiss").onclick = function () {
      toast.hidden = true;
    };
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
