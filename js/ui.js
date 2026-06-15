/**
 * 렌더링 헬퍼: 아이콘 / 목록 / 상세 / 빈·로딩 상태.
 * DOM 생성은 textContent 위주로 처리해 XSS 를 피한다.
 */
(function (global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  var AVATAR_COLORS = [
    "#1f6feb", "#7c3aed", "#0e7490", "#be185d",
    "#15803d", "#c2410c", "#0f766e", "#7e22ce",
  ];

  function avatarColor(name) {
    var sum = 0;
    for (var i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
  }

  function initial(name) {
    return name ? name.trim().charAt(0) : "?";
  }

  /** 인라인 SVG 스프라이트 참조 노드 생성 (currentColor 상속) */
  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ic" + (cls ? " " + cls : ""));
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#ic-" + name);
    svg.appendChild(use);
    return svg;
  }

  function formatPhone(p) {
    if (!p) return "";
    var d = p.replace(/[^0-9]/g, "");
    if (!d) return p;
    if (d.indexOf("02") === 0) {
      if (d.length === 9) return d.replace(/(\d{2})(\d{3})(\d{4})/, "$1-$2-$3");
      if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "$1-$2-$3");
    }
    if (d.length === 11) return d.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
    if (d.length === 10) return d.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
    return p;
  }

  function clean(p) {
    return p.replace(/[^0-9+]/g, "");
  }

  function statusBadge(status) {
    var map = {
      "휴직": ["휴직", "badge--leave"],
      "파견": ["파견", "badge--dispatched"],
      "교육": ["교육", "badge--training"],
    };
    var info = map[status];
    if (!info) return null;
    var span = el("span", "badge " + info[1], info[0]);
    return span;
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function makeAvatar(contact, sizeClass) {
    var a = el("div", "avatar" + (sizeClass ? " " + sizeClass : ""));
    a.style.background = avatarColor(contact.name || "");
    a.textContent = initial(contact.name);
    return a;
  }

  var UI = {
    avatarColor: avatarColor,
    icon: icon,
    formatPhone: formatPhone,

    /**
     * 연락처 한 행 생성.
     * onOpen(contact): 행 열기, onFav(): 즐겨찾기 토글 후 콜백.
     */
    renderRow: function (contact, onOpen, onFav) {
      var row = el("div", "row");
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      var subParts = [contact.dept, contact.team, contact.position].filter(Boolean);
      row.setAttribute("aria-label", (contact.name || "") + ", " + subParts.join(" ") + ", 상세 보기");

      row.appendChild(makeAvatar(contact));

      var main = el("div", "row-main");
      var name = el("div", "row-name");
      name.appendChild(document.createTextNode(contact.name || ""));
      var badge = statusBadge(contact.status);
      if (badge) name.appendChild(badge);
      main.appendChild(name);
      main.appendChild(el("div", "row-sub", subParts.join(" · ")));
      row.appendChild(main);

      var actions = el("div", "row-actions");

      // 즐겨찾기 토글
      var isFav = Storage.isFavorite(contact.id);
      var star = el("button", "mini-btn mini-btn--star" + (isFav ? " is-on" : ""));
      star.type = "button";
      star.setAttribute("aria-label", isFav ? "즐겨찾기 해제" : "즐겨찾기 추가");
      star.setAttribute("aria-pressed", isFav ? "true" : "false");
      star.appendChild(icon("star"));
      star.addEventListener("click", function (e) {
        e.stopPropagation();
        var nowFav = Storage.toggleFavorite(contact.id);
        star.classList.toggle("is-on", nowFav);
        star.setAttribute("aria-pressed", nowFav ? "true" : "false");
        star.setAttribute("aria-label", nowFav ? "즐겨찾기 해제" : "즐겨찾기 추가");
        if (navigator.vibrate) navigator.vibrate(10);
        if (onFav) onFav();
      });
      actions.appendChild(star);

      // 전화
      if (contact.phone) {
        var call = el("a", "mini-btn");
        call.href = "tel:" + clean(contact.phone);
        call.setAttribute("aria-label", contact.name + " 전화 걸기");
        call.appendChild(icon("phone"));
        call.addEventListener("click", function (e) {
          e.stopPropagation();
          Storage.pushRecent(contact.id);
        });
        actions.appendChild(call);
      }
      row.appendChild(actions);

      row.addEventListener("click", function () { onOpen(contact); });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(contact);
        }
      });
      return row;
    },

    /** 그룹 목록 렌더 (부서별). groups: [{dept, members}] */
    renderGroups: function (container, groups, onOpen, onFav) {
      container.textContent = "";
      if (!groups.length) {
        container.appendChild(UI.emptyState("표시할 연락처가 없습니다."));
        return;
      }
      var frag = document.createDocumentFragment();
      groups.forEach(function (g) {
        var header = el("div", "section-header");
        header.appendChild(document.createTextNode(g.dept.name + " "));
        header.appendChild(el("span", "count", "(" + g.members.length + ")"));
        frag.appendChild(header);
        g.members.forEach(function (c) {
          frag.appendChild(UI.renderRow(c, onOpen, onFav));
        });
      });
      container.appendChild(frag);
    },

    /** 평면 목록 렌더 (검색/즐겨찾기/최근) */
    renderFlat: function (container, contacts, onOpen, emptyMsg, onFav, actionLabel, onAction) {
      container.textContent = "";
      if (!contacts.length) {
        container.appendChild(UI.emptyState(emptyMsg || "결과가 없습니다.", actionLabel, onAction));
        return;
      }
      var frag = document.createDocumentFragment();
      contacts.forEach(function (c) {
        frag.appendChild(UI.renderRow(c, onOpen, onFav));
      });
      container.appendChild(frag);
    },

    /** 로딩 스켈레톤 */
    renderSkeleton: function (container, n) {
      container.textContent = "";
      var frag = document.createDocumentFragment();
      for (var i = 0; i < (n || 8); i++) {
        var sr = el("div", "skeleton-row");
        sr.appendChild(el("div", "sk sk--avatar"));
        var lines = el("div", "row-main");
        lines.appendChild(el("div", "sk sk--line sk--w60"));
        lines.appendChild(el("div", "sk sk--line sk--w40"));
        sr.appendChild(lines);
        frag.appendChild(sr);
      }
      container.appendChild(frag);
    },

    emptyState: function (msg, actionLabel, onAction) {
      var wrap = el("div", "empty");
      var ico = el("span", "empty-ico");
      ico.appendChild(icon("contacts"));
      wrap.appendChild(ico);
      wrap.appendChild(el("div", "empty-msg", msg));
      if (actionLabel && onAction) {
        var btn = el("button", "empty-action", actionLabel);
        btn.type = "button";
        btn.addEventListener("click", onAction);
        wrap.appendChild(btn);
      }
      return wrap;
    },

    /** 상세 본문 렌더 */
    renderDetail: function (container, contact) {
      container.textContent = "";

      var hero = el("div", "detail-hero");
      hero.appendChild(makeAvatar(contact, ""));
      hero.appendChild(el("h2", "detail-name", contact.name || ""));
      var role = [contact.dept, contact.team, contact.position].filter(Boolean).join(" · ");
      hero.appendChild(el("p", "detail-role", role));
      container.appendChild(hero);

      var qa = el("div", "quick-actions");
      qa.appendChild(quickAction("phone", "전화", contact.phone ? "tel:" + clean(contact.phone) : null, "전화 걸기"));
      qa.appendChild(quickAction("message", "문자", contact.phone ? "sms:" + clean(contact.phone) : null, "문자 보내기"));
      qa.appendChild(quickAction("building", "사내", contact.tel ? "tel:" + clean(contact.tel) : null, "사내번호로 전화"));
      container.appendChild(qa);

      var card = el("div", "info-card");
      addInfo(card, "mobile", "휴대전화", formatPhone(contact.phone), "tel:", contact.phone);
      addInfo(card, "building", "사내번호", formatPhone(contact.tel), "tel:", contact.tel);
      addInfo(card, "building", "부서", contact.dept);
      addInfo(card, "users", "팀", contact.team);
      addInfo(card, "badge", "직책", contact.position);
      addInfo(card, "work", "담당업무", contact.work);
      addInfo(card, "cake", "생년월일", contact.birth);
      addInfo(card, "status", "재직상태", contact.status && contact.status !== "미설정" ? contact.status : null);
      container.appendChild(card);
    },
  };

  function quickAction(iconName, label, href, aria) {
    var node = href ? el("a", "quick") : el("div", "quick quick--disabled");
    if (href) {
      node.href = href;
      node.setAttribute("aria-label", aria);
    } else {
      node.setAttribute("aria-disabled", "true");
      node.setAttribute("aria-label", label + " 없음");
    }
    var ico = el("div", "quick-ico");
    ico.appendChild(icon(iconName));
    node.appendChild(ico);
    node.appendChild(el("span", null, label));
    return node;
  }

  function addInfo(card, iconName, label, value, linkScheme, rawValue) {
    if (!value) return;
    var isLink = !!linkScheme;
    var row = isLink ? el("a", "info-row") : el("div", "info-row");
    if (isLink) {
      row.href = linkScheme + clean(rawValue || value);
      row.setAttribute("aria-label", label + " " + value);
    }
    var ico = el("span", "info-ico");
    ico.appendChild(icon(iconName));
    row.appendChild(ico);
    var text = el("div", "info-text");
    text.appendChild(el("div", "info-label", label));
    text.appendChild(el("div", "info-value", value));
    row.appendChild(text);
    if (isLink) {
      var chev = el("span", "info-chevron");
      chev.appendChild(icon("chevron"));
      row.appendChild(chev);
    }
    card.appendChild(row);
  }

  global.UI = UI;
})(window);
