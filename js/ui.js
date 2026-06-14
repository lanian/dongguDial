/**
 * 렌더링 헬퍼: 목록 / 상세 / 빈 상태.
 * DOM 생성은 textContent 위주로 처리해 XSS 를 피한다.
 */
(function (global) {
  "use strict";

  var AVATAR_COLORS = [
    "#1f6feb", "#7c3aed", "#0891b2", "#db2777",
    "#16a34a", "#ea580c", "#0d9488", "#9333ea",
  ];

  function avatarColor(name) {
    var sum = 0;
    for (var i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
  }

  function initial(name) {
    return name ? name.trim().charAt(0) : "?";
  }

  function statusBadge(status) {
    var map = {
      "휴직": ["휴직", "badge--leave"],
      "파견": ["파견", "badge--dispatched"],
      "교육": ["교육", "badge--training"],
    };
    var info = map[status];
    if (!info) return null;
    var span = document.createElement("span");
    span.className = "badge " + info[1];
    span.textContent = info[0];
    return span;
  }

  function formatPhone(p) {
    return p || "";
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

    /** 연락처 한 행(li 대용 div) 생성. onOpen(contact) 콜백. */
    renderRow: function (contact, onOpen) {
      var row = el("div", "row");
      row.appendChild(makeAvatar(contact));

      var main = el("div", "row-main");
      var name = el("div", "row-name");
      name.appendChild(document.createTextNode(contact.name || ""));
      var badge = statusBadge(contact.status);
      if (badge) name.appendChild(badge);
      main.appendChild(name);

      var subParts = [contact.dept, contact.team, contact.position].filter(Boolean);
      main.appendChild(el("div", "row-sub", subParts.join(" · ")));
      row.appendChild(main);

      var actions = el("div", "row-actions");
      if (contact.phone) {
        var call = el("a", "mini-btn", "📞");
        call.href = "tel:" + contact.phone.replace(/\s/g, "");
        call.setAttribute("aria-label", "전화");
        call.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        actions.appendChild(call);
      }
      row.appendChild(actions);

      row.addEventListener("click", function () {
        onOpen(contact);
      });
      return row;
    },

    /** 그룹 목록 렌더 (부서별). groups: [{dept, members}] */
    renderGroups: function (container, groups, onOpen) {
      container.textContent = "";
      if (!groups.length) {
        container.appendChild(UI.emptyState("표시할 연락처가 없습니다."));
        return;
      }
      groups.forEach(function (g) {
        var header = el("div", "section-header");
        header.appendChild(document.createTextNode(g.dept.name + " "));
        header.appendChild(el("span", "count", "(" + g.members.length + ")"));
        container.appendChild(header);
        g.members.forEach(function (c) {
          container.appendChild(UI.renderRow(c, onOpen));
        });
      });
    },

    /** 평면 목록 렌더 (검색/즐겨찾기/최근) */
    renderFlat: function (container, contacts, onOpen, emptyMsg) {
      container.textContent = "";
      if (!contacts.length) {
        container.appendChild(UI.emptyState(emptyMsg || "결과가 없습니다."));
        return;
      }
      contacts.forEach(function (c) {
        container.appendChild(UI.renderRow(c, onOpen));
      });
    },

    emptyState: function (msg) {
      var wrap = el("div", "empty");
      wrap.appendChild(el("span", "emoji", "📇"));
      wrap.appendChild(document.createTextNode(msg));
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

      // 빠른 동작
      var qa = el("div", "quick-actions");
      qa.appendChild(quickAction("📞", "전화", contact.phone ? "tel:" + clean(contact.phone) : null));
      qa.appendChild(quickAction("💬", "문자", contact.phone ? "sms:" + clean(contact.phone) : null));
      qa.appendChild(quickAction("☎️", "사내", contact.tel ? "tel:" + clean(contact.tel) : null));
      container.appendChild(qa);

      // 정보 카드
      var card = el("div", "info-card");
      addInfo(card, "📱", "휴대전화", contact.phone, "tel:");
      addInfo(card, "☎️", "사내번호", contact.tel, "tel:");
      addInfo(card, "🏢", "부서", contact.dept);
      addInfo(card, "👥", "팀", contact.team);
      addInfo(card, "🪪", "직책", contact.position);
      addInfo(card, "🛠️", "담당업무", contact.work);
      addInfo(card, "🎂", "생년월일", contact.birth);
      addInfo(card, "📌", "재직상태", contact.status && contact.status !== "미설정" ? contact.status : null);
      container.appendChild(card);
    },
  };

  function clean(p) {
    return p.replace(/\s/g, "");
  }

  function quickAction(icon, label, href) {
    var node = href ? el("a", "quick") : el("div", "quick quick--disabled");
    if (href) node.href = href;
    var ico = el("div", "quick-ico", icon);
    node.appendChild(ico);
    node.appendChild(el("span", null, label));
    return node;
  }

  function addInfo(card, icon, label, value, linkScheme) {
    if (!value) return;
    var isLink = !!linkScheme;
    var row = isLink ? el("a", "info-row") : el("div", "info-row");
    if (isLink) row.href = linkScheme + clean(value);
    row.appendChild(el("span", "info-ico", icon));
    var text = el("div", "info-text");
    text.appendChild(el("div", "info-label", label));
    text.appendChild(el("div", "info-value", value));
    row.appendChild(text);
    card.appendChild(row);
  }

  global.UI = UI;
})(window);
