/**
 * 앱 컨트롤러: 탭/검색/상세 라우팅, 서비스워커 등록, 설치 프롬프트.
 */
(function () {
  "use strict";

  var listEl = document.getElementById("list");
  var searchInput = document.getElementById("search-input");
  var searchClear = document.getElementById("search-clear");
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var detailEl = document.getElementById("detail");
  var detailBody = document.getElementById("detail-body");
  var detailBack = document.getElementById("detail-back");
  var detailFav = document.getElementById("detail-fav");

  var current = { tab: "all", query: "", detailId: null };

  // ---------- 렌더 ----------
  function render() {
    var q = current.query.trim();
    if (q) {
      UI.renderFlat(listEl, Data.search(q), openDetail, "‘" + q + "’ 검색 결과가 없습니다.");
      return;
    }
    if (current.tab === "all") {
      UI.renderGroups(listEl, Data.groupedByDept(), openDetail);
    } else if (current.tab === "favorites") {
      UI.renderFlat(listEl, Data.resolveIds(Storage.getFavorites()), openDetail,
        "즐겨찾기한 연락처가 없습니다.\n별 아이콘을 눌러 추가하세요.");
    } else if (current.tab === "recent") {
      UI.renderFlat(listEl, Data.resolveIds(Storage.getRecent()), openDetail,
        "최근 본 연락처가 없습니다.");
    }
  }

  // ---------- 상세 ----------
  function openDetail(contact) {
    current.detailId = contact.id;
    Storage.pushRecent(contact.id);
    UI.renderDetail(detailBody, contact);
    updateFavButton();
    detailEl.hidden = false;
    detailBody.scrollTop = 0;
    if (location.hash !== "#contact/" + contact.id) {
      history.pushState({ detail: contact.id }, "", "#contact/" + contact.id);
    }
  }

  function closeDetail(fromPop) {
    detailEl.hidden = true;
    current.detailId = null;
    if (!fromPop && location.hash) {
      history.back();
    }
    // 최근 탭이면 목록 갱신
    if (current.tab === "recent" || current.tab === "favorites") render();
  }

  function updateFavButton() {
    var isFav = Storage.isFavorite(current.detailId);
    detailFav.textContent = isFav ? "★" : "☆";
    detailFav.style.color = isFav ? "#ffd24a" : "#fff";
  }

  detailFav.addEventListener("click", function () {
    if (current.detailId == null) return;
    Storage.toggleFavorite(current.detailId);
    updateFavButton();
  });
  detailBack.addEventListener("click", function () {
    closeDetail(false);
  });

  // ---------- 탭 ----------
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) {
        t.classList.toggle("is-active", t === tab);
      });
      current.tab = tab.dataset.tab;
      render();
      listEl.scrollIntoView({ block: "start" });
    });
  });

  // ---------- 검색 ----------
  searchInput.addEventListener("input", function () {
    current.query = searchInput.value;
    searchClear.hidden = !searchInput.value;
    render();
  });
  searchClear.addEventListener("click", function () {
    searchInput.value = "";
    current.query = "";
    searchClear.hidden = true;
    render();
    searchInput.focus();
  });

  // ---------- 히스토리(뒤로가기로 상세 닫기) ----------
  window.addEventListener("popstate", function (e) {
    if (!detailEl.hidden) {
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
    }
  }

  // ---------- 부팅 ----------
  Data.load()
    .then(function () {
      render();
      openFromHash();
    })
    .catch(function (err) {
      listEl.appendChild(UI.emptyState("데이터를 불러오지 못했습니다.\n" + err.message));
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
  }

  // ---------- PWA: 설치 프롬프트 ----------
  var deferredPrompt = null;
  var installToast = document.getElementById("install-toast");
  var INSTALL_DISMISS_KEY = "dongguDial.installDismissed.v1";

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem(INSTALL_DISMISS_KEY)) {
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
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    } catch (e) {}
  });
})();
