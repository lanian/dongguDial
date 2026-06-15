/**
 * 앱 컨트롤러: 탭/검색/상세/설정 라우팅, 접근성(포커스·키보드), 서비스워커, 설치.
 */
(function () {
  "use strict";

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

  var current = { tab: "all", query: "", detailId: null };
  var lastFocused = null;
  var bgEls = [appBar, tabsNav, listEl];

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

  function render() {
    var q = current.query.trim();
    if (q) {
      var results = Data.search(q);
      UI.renderFlat(listEl, results, openDetail,
        "‘" + q + "’ 검색 결과가 없습니다.", onFavChanged);
      resultStatus.textContent = results.length + "건 검색됨";
      return;
    }
    resultStatus.textContent = "";
    if (current.tab === "all") {
      UI.renderGroups(listEl, Data.groupedByDept(), openDetail, onFavChanged);
    } else if (current.tab === "favorites") {
      UI.renderFlat(listEl, Data.resolveIds(Storage.getFavorites()), openDetail,
        "즐겨찾기한 연락처가 없습니다.\n별 아이콘을 눌러 추가하세요.", onFavChanged,
        "전체에서 찾기", function () { switchTab(tabs[0]); });
    } else if (current.tab === "recent") {
      UI.renderFlat(listEl, Data.resolveIds(Storage.getRecent()), openDetail,
        "최근 본 연락처가 없습니다.", onFavChanged,
        "전체에서 찾기", function () { switchTab(tabs[0]); });
    }
  }

  // ---------- 상세 ----------
  function openDetail(contact) {
    current.detailId = contact.id;
    Storage.pushRecent(contact.id);
    UI.renderDetail(detailBody, contact);
    updateFavButton();
    lastFocused = document.activeElement;
    setBgInert(true);
    detailEl.hidden = false;
    detailBody.scrollTop = 0;
    detailBack.focus();
    if (location.hash !== "#contact/" + contact.id) {
      history.pushState({ detail: contact.id }, "", "#contact/" + contact.id);
    }
  }

  function closeDetail(fromPop) {
    detailEl.hidden = true;
    current.detailId = null;
    setBgInert(false);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    if (!fromPop && location.hash) history.back();
    if (current.tab === "recent" || current.tab === "favorites") render();
  }

  function updateFavButton() {
    var isFav = Storage.isFavorite(current.detailId);
    detailFav.classList.toggle("is-on", isFav);
    detailFav.setAttribute("aria-pressed", isFav ? "true" : "false");
    detailFav.setAttribute("aria-label", isFav ? "즐겨찾기 해제" : "즐겨찾기 추가");
  }

  detailFav.addEventListener("click", function () {
    if (current.detailId == null) return;
    Storage.toggleFavorite(current.detailId);
    updateFavButton();
    if (navigator.vibrate) navigator.vibrate(10);
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
    settingsCounts.textContent = "즐겨찾기 " + c.favorites + " · 최근 " + c.recent;
  }
  function openSettings() {
    refreshCounts();
    lastFocused = document.activeElement;
    setBgInert(true);
    settingsEl.hidden = false;
    document.getElementById("settings-back").focus();
    history.pushState({ settings: true }, "", "#settings");
  }
  function closeSettings(fromPop) {
    settingsEl.hidden = true;
    setBgInert(false);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    if (!fromPop && location.hash === "#settings") history.back();
  }

  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("settings-back").addEventListener("click", function () {
    closeSettings(false);
  });

  document.getElementById("export-btn").addEventListener("click", function () {
    var data = Storage.exportData();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var d = new Date();
    var stamp = d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    var a = document.createElement("a");
    a.href = url;
    a.download = "비상연락망-백업-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  document.getElementById("import-btn").addEventListener("click", function () {
    importFile.value = "";
    importFile.click();
  });
  importFile.addEventListener("change", function () {
    var file = importFile.files && importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var result = Storage.importData(data, "merge");
        refreshCounts();
        render();
        window.alert("복구 완료: 즐겨찾기 " + result.favorites + ", 최근 " + result.recent);
      } catch (e) {
        window.alert("가져오기 실패: " + e.message);
      }
    };
    reader.onerror = function () { window.alert("파일을 읽지 못했습니다."); };
    reader.readAsText(file);
  });

  // ---------- 전역 키보드 (Esc 닫기 / 오버레이 포커스 트랩) ----------
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!settingsEl.hidden) { closeSettings(false); return; }
      if (!detailEl.hidden) { closeDetail(false); return; }
      if (searchInput.value) { searchClear.click(); }
      return;
    }
    if (e.key === "Tab") {
      var ov = !settingsEl.hidden ? settingsEl : (!detailEl.hidden ? detailEl : null);
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
    if (!settingsEl.hidden) {
      closeSettings(true);
    } else if (!detailEl.hidden) {
      closeDetail(true);
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
    }
  }

  // ---------- sticky 오프셋 실측 ----------
  function syncStickyOffsets() {
    var hb = appBar.offsetHeight;
    var ht = tabsNav.offsetHeight;
    document.documentElement.style.setProperty("--header-h", hb + "px");
    document.documentElement.style.setProperty("--tabs-h", ht + "px");
  }
  window.addEventListener("resize", syncStickyOffsets);

  // ---------- 부팅 ----------
  UI.renderSkeleton(listEl, 8);
  Data.load()
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
  if ("serviceWorker" in navigator) {
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

  function showUpdateToast(reg) {
    var toast = document.getElementById("update-toast");
    toast.hidden = false;
    document.getElementById("update-btn").onclick = function () {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      window.location.reload();
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
