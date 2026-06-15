/**
 * 렌더링 헬퍼: 아이콘 / 목록(부서·가나다) / 상세 / 빈·로딩 상태.
 * DOM 생성은 textContent·노드 조립으로 처리해 XSS 를 피한다.
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

  function initial(name) { return name ? name.trim().charAt(0) : "?"; }

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

  function clean(p) { return p.replace(/[^0-9+]/g, ""); }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  /** text 안의 q 일치 부분을 <mark>로 강조하여 parent 에 추가 */
  function highlightInto(parent, text, q) {
    text = text || "";
    if (!q) { parent.appendChild(document.createTextNode(text)); return; }
    var lower = text.toLowerCase(), ql = q.toLowerCase(), idx = 0, pos;
    while ((pos = lower.indexOf(ql, idx)) !== -1) {
      if (pos > idx) parent.appendChild(document.createTextNode(text.slice(idx, pos)));
      var m = el("mark", null, text.slice(pos, pos + ql.length));
      parent.appendChild(m);
      idx = pos + ql.length;
    }
    if (idx < text.length) parent.appendChild(document.createTextNode(text.slice(idx)));
  }

  function statusBadge(status) {
    var map = { "휴직": "badge--leave", "파견": "badge--dispatched", "교육": "badge--training" };
    if (!map[status]) return null;
    return el("span", "badge " + map[status], status);
  }

  function makeAvatar(contact, sizeClass) {
    var a = el("div", "avatar" + (sizeClass ? " " + sizeClass : ""));
    a.style.background = avatarColor(contact.name || "");
    a.textContent = initial(contact.name);
    return a;
  }

  function snack(msg) {
    if (global.showSnack) global.showSnack(msg);
  }

  // ---------- 연락처 동작 (전부 로컬) ----------
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { snack("복사됨"); })
        .catch(function () { snack("복사 실패"); });
    } else {
      var ta = el("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); snack("복사됨"); } catch (e) { snack("복사 실패"); }
      document.body.removeChild(ta);
    }
  }

  function buildVCard(c) {
    function esc(s) { return String(s || "").replace(/([,;\\])/g, "\\$1"); }
    var lines = ["BEGIN:VCARD", "VERSION:3.0"];
    lines.push("N:" + esc(c.name) + ";;;;");
    lines.push("FN:" + esc(c.name));
    if (c.dept || c.team) lines.push("ORG:" + esc(c.dept) + ";" + esc(c.team));
    if (c.position) lines.push("TITLE:" + esc(c.position));
    if (c.phone) lines.push("TEL;TYPE=CELL:" + clean(c.phone));
    if (c.tel) lines.push("TEL;TYPE=WORK:" + clean(c.tel));
    if (c.birth) lines.push("BDAY:" + c.birth);
    lines.push("END:VCARD");
    return lines.join("\r\n");
  }

  function downloadVCard(c) {
    var blob = new Blob([buildVCard(c)], { type: "text/vcard;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = el("a");
    a.href = url;
    a.download = (c.name || "contact") + ".vcf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    snack("연락처 파일을 저장했어요");
  }

  function shareContact(c) {
    var parts = [c.name];
    if (c.position || c.dept) parts.push([c.dept, c.team, c.position].filter(Boolean).join(" "));
    if (c.phone) parts.push("휴대전화 " + formatPhone(c.phone));
    if (c.tel) parts.push("사내번호 " + formatPhone(c.tel));
    var text = parts.join("\n");
    if (navigator.share) {
      navigator.share({ title: c.name, text: text }).catch(function () {});
    } else {
      copyText(text);
    }
  }

  // ---------- 행 ----------
  function renderRow(contact, opts) {
    opts = opts || {};
    var row = el("div", "row");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    var subParts = [contact.dept, contact.team, contact.position].filter(Boolean);
    row.setAttribute("aria-label", (contact.name || "") + ", " + subParts.join(" ") + ", 상세 보기");

    row.appendChild(makeAvatar(contact));

    var main = el("div", "row-main");
    var name = el("div", "row-name");
    var nameText = el("span");
    highlightInto(nameText, contact.name || "", opts.query);
    name.appendChild(nameText);
    var badge = statusBadge(contact.status);
    if (badge) name.appendChild(badge);
    main.appendChild(name);
    var sub = el("div", "row-sub");
    highlightInto(sub, subParts.join(" · "), opts.query);
    main.appendChild(sub);
    row.appendChild(main);

    var actions = el("div", "row-actions");

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
      if (opts.onFav) opts.onFav();
    });
    actions.appendChild(star);

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

    row.addEventListener("click", function () { opts.onOpen(contact); });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onOpen(contact); }
    });
    return row;
  }

  function appendRows(frag, members, opts) {
    members.forEach(function (c) { frag.appendChild(renderRow(c, opts)); });
  }

  // 직책이 '장/담당관/위원/단장'으로 끝나면 리더로 간주(주무관 제외)
  function isLead(c) {
    var p = (c.position || "").trim();
    return /장$/.test(p) || /담당관$/.test(p) || /위원$/.test(p) || /단장$/.test(p);
  }
  function orgRow(c, opts) {
    var r = renderRow(c, opts);
    if (isLead(c)) r.classList.add("row--lead");
    return r;
  }

  var UI = {
    avatarColor: avatarColor,
    icon: icon,
    formatPhone: formatPhone,
    renderRow: renderRow,

    /** 부서 뷰 (접기/펼치기). opts: onOpen,onFav,collapsed,onToggle */
    renderDeptView: function (container, groups, opts) {
      container.textContent = "";
      if (!groups.length) {
        container.appendChild(UI.emptyState("표시할 연락처가 없습니다."));
        return;
      }
      var frag = document.createDocumentFragment();
      groups.forEach(function (g) {
        var collapsed = opts.collapsed && opts.collapsed[g.dept.id];
        var header = el("button", "section-header section-toggle");
        header.type = "button";
        header.id = "dept-" + g.dept.id;
        header.setAttribute("aria-expanded", collapsed ? "false" : "true");
        var chev = icon("chevron", "section-chevron");
        header.appendChild(chev);
        header.appendChild(document.createTextNode(" " + g.dept.name + " "));
        header.appendChild(el("span", "count", "(" + g.members.length + ")"));
        header.addEventListener("click", function () {
          if (opts.onToggle) opts.onToggle(g.dept.id);
        });
        frag.appendChild(header);
        if (!collapsed) appendRows(frag, g.members, opts);
      });
      container.appendChild(frag);
    },

    /** 가나다 뷰. opts: onOpen,onFav */
    renderNameView: function (container, groups, opts) {
      container.textContent = "";
      if (!groups.length) {
        container.appendChild(UI.emptyState("표시할 연락처가 없습니다."));
        return;
      }
      var frag = document.createDocumentFragment();
      groups.forEach(function (g) {
        var header = el("div", "section-header");
        header.id = "grp-" + g.key;
        header.appendChild(document.createTextNode(g.key + " "));
        header.appendChild(el("span", "count", "(" + g.members.length + ")"));
        frag.appendChild(header);
        appendRows(frag, g.members, opts);
      });
      container.appendChild(frag);
    },

    /** 평면 목록. opts: onOpen,onFav,query,emptyMsg,actionLabel,onAction */
    renderFlat: function (container, contacts, opts) {
      opts = opts || {};
      container.textContent = "";
      if (!contacts.length) {
        container.appendChild(UI.emptyState(opts.emptyMsg || "결과가 없습니다.", opts.actionLabel, opts.onAction));
        return;
      }
      var frag = document.createDocumentFragment();
      appendRows(frag, contacts, opts);
      container.appendChild(frag);
    },

    /** 조직도(트리): 부서(국/실/관) → 팀(과) → 인원. 2단 접기 + 리더 강조.
     *  opts: onOpen,onFav,collapsed,onToggle */
    renderOrgView: function (container, tree, opts) {
      container.textContent = "";
      if (!tree.length) {
        container.appendChild(UI.emptyState("조직 정보가 없습니다."));
        return;
      }
      var totalPeople = tree.reduce(function (a, n) { return a + n.count; }, 0);
      var summary = el("div", "org-summary");
      summary.appendChild(el("span", null, "총 " + tree.length + "개 부서 · " + totalPeople + "명"));
      container.appendChild(summary);

      var frag = document.createDocumentFragment();
      tree.forEach(function (node) {
        var collapsed = !!(opts.collapsed && opts.collapsed[node.dept.id]);
        var wrap = el("div", "org-node");

        var header = el("button", "section-header section-toggle org-dept");
        header.type = "button";
        header.id = "org-" + node.dept.id;
        header.setAttribute("aria-expanded", collapsed ? "false" : "true");
        header.appendChild(icon("chevron", "section-chevron"));
        header.appendChild(el("span", "org-dept-name", node.dept.name));
        var lead = node.directMembers.filter(isLead)[0];
        if (lead) header.appendChild(el("span", "org-lead", lead.name + " " + lead.position));
        header.appendChild(el("span", "org-badge", String(node.count)));
        header.addEventListener("click", function () { if (opts.onToggle) opts.onToggle(node.dept.id); });
        wrap.appendChild(header);

        if (!collapsed) {
          var body = el("div", "org-dept-body");
          node.directMembers.forEach(function (c) { body.appendChild(orgRow(c, opts)); });
          node.children.forEach(function (ch) {
            var tCollapsed = !!(opts.collapsed && opts.collapsed[ch.dept.id]);
            var block = el("div", "org-team-block");
            var th = el("button", "org-team-header");
            th.type = "button";
            th.id = "org-" + ch.dept.id;
            th.setAttribute("aria-expanded", tCollapsed ? "false" : "true");
            th.appendChild(icon("chevron", "section-chevron"));
            th.appendChild(el("span", "org-team-name", ch.dept.name));
            var tLead = ch.members.filter(isLead)[0];
            if (tLead) th.appendChild(el("span", "org-lead", tLead.name + " " + tLead.position));
            th.appendChild(el("span", "org-badge org-badge--sm", String(ch.members.length)));
            th.addEventListener("click", function () { if (opts.onToggle) opts.onToggle(ch.dept.id); });
            block.appendChild(th);
            if (!tCollapsed) {
              var tbody = el("div", "org-team-body");
              ch.members.forEach(function (c) { tbody.appendChild(orgRow(c, opts)); });
              block.appendChild(tbody);
            }
            body.appendChild(block);
          });
          wrap.appendChild(body);
        }
        frag.appendChild(wrap);
      });
      container.appendChild(frag);
    },

    /** 편집/추가 폼 렌더. 입력값은 #ef-* id로 app이 읽는다. */
    renderEditForm: function (container, contact, departments) {
      container.textContent = "";
      contact = contact || {};
      var form = el("div", "edit-form");

      form.appendChild(field("이름", textInput("ef-name", contact.name, "홍길동")));

      var deptSel = el("select", "ef-input");
      deptSel.id = "ef-dept";
      departments.forEach(function (d) {
        var o = el("option", null, d.name);
        o.value = String(d.id);
        if (contact.deptId === d.id) o.selected = true;
        deptSel.appendChild(o);
      });
      form.appendChild(field("부서", deptSel));

      form.appendChild(field("팀", textInput("ef-team", contact.team, "인사팀")));
      form.appendChild(field("직책", textInput("ef-position", contact.position, "팀장")));
      form.appendChild(field("담당업무", textInput("ef-work", contact.work, "채용")));
      form.appendChild(field("휴대전화", textInput("ef-phone", contact.phone, "010-0000-0000", "tel")));
      form.appendChild(field("사내번호", textInput("ef-tel", contact.tel, "02-000-0000", "tel")));
      form.appendChild(field("생년월일", textInput("ef-birth", contact.birth, "1990-01-01")));

      var statusSel = el("select", "ef-input");
      statusSel.id = "ef-status";
      ["재직", "휴직", "파견", "교육", "미설정"].forEach(function (s) {
        var o = el("option", null, s);
        o.value = s;
        if ((contact.status || "미설정") === s) o.selected = true;
        statusSel.appendChild(o);
      });
      form.appendChild(field("재직상태", statusSel));

      container.appendChild(form);
    },

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

    /** 상세 본문 */
    renderDetail: function (container, contact) {
      container.textContent = "";

      var hero = el("div", "detail-hero");
      hero.appendChild(makeAvatar(contact, ""));
      hero.appendChild(el("h2", "detail-name", contact.name || ""));
      var role = [contact.dept, contact.team, contact.position].filter(Boolean).join(" · ");
      hero.appendChild(el("p", "detail-role", role));
      if (contact._custom) hero.appendChild(el("span", "edit-chip", "추가한 연락처"));
      else if (contact._edited) hero.appendChild(el("span", "edit-chip", "수정됨"));
      container.appendChild(hero);

      var qa = el("div", "quick-actions");
      qa.appendChild(quickLink("phone", "전화", contact.phone ? "tel:" + clean(contact.phone) : null, "전화 걸기"));
      qa.appendChild(quickLink("message", "문자", contact.phone ? "sms:" + clean(contact.phone) : null, "문자 보내기"));
      qa.appendChild(quickLink("building", "사내", contact.tel ? "tel:" + clean(contact.tel) : null, "사내번호로 전화"));
      qa.appendChild(quickBtn("share", "공유", function () { shareContact(contact); }, "연락처 공유"));
      qa.appendChild(quickBtn("download", "저장", function () { downloadVCard(contact); }, "연락처 파일로 저장"));
      container.appendChild(qa);

      var card = el("div", "info-card");
      addPhoneRow(card, "mobile", "휴대전화", contact.phone);
      addPhoneRow(card, "building", "사내번호", contact.tel);
      addInfo(card, "building", "부서", contact.dept);
      addInfo(card, "users", "팀", contact.team);
      addInfo(card, "badge", "직책", contact.position);
      addInfo(card, "work", "담당업무", contact.work);
      addInfo(card, "cake", "생년월일", contact.birth);
      addInfo(card, "status", "재직상태", contact.status && contact.status !== "미설정" ? contact.status : null);
      container.appendChild(card);
    },
  };

  function quickLink(iconName, label, href, aria) {
    var node = href ? el("a", "quick") : el("div", "quick quick--disabled");
    if (href) { node.href = href; node.setAttribute("aria-label", aria); }
    else { node.setAttribute("aria-disabled", "true"); node.setAttribute("aria-label", label + " 없음"); }
    var ico = el("div", "quick-ico");
    ico.appendChild(icon(iconName));
    node.appendChild(ico);
    node.appendChild(el("span", null, label));
    return node;
  }

  function quickBtn(iconName, label, onClick, aria) {
    var node = el("button", "quick");
    node.type = "button";
    node.setAttribute("aria-label", aria);
    var ico = el("div", "quick-ico");
    ico.appendChild(icon(iconName));
    node.appendChild(ico);
    node.appendChild(el("span", null, label));
    node.addEventListener("click", onClick);
    return node;
  }

  /** 전화 정보 행: 값 + [전화][복사] */
  function addPhoneRow(card, iconName, label, raw) {
    if (!raw) return;
    var row = el("div", "info-row");
    var ico = el("span", "info-ico");
    ico.appendChild(icon(iconName));
    row.appendChild(ico);
    var text = el("div", "info-text");
    text.appendChild(el("div", "info-label", label));
    var val = el("div", "info-value info-value--link", formatPhone(raw));
    text.appendChild(val);
    row.appendChild(text);

    var acts = el("div", "info-actions");
    var call = el("a", "mini-btn");
    call.href = "tel:" + clean(raw);
    call.setAttribute("aria-label", label + " 전화 걸기");
    call.appendChild(icon("phone"));
    acts.appendChild(call);
    var copy = el("button", "mini-btn mini-btn--ghost");
    copy.type = "button";
    copy.setAttribute("aria-label", label + " 복사");
    copy.appendChild(icon("copy"));
    copy.addEventListener("click", function () { copyText(formatPhone(raw)); });
    acts.appendChild(copy);
    row.appendChild(acts);
    card.appendChild(row);
  }

  function field(label, input) {
    var wrap = el("label", "ef-field");
    wrap.appendChild(el("span", "ef-label", label));
    wrap.appendChild(input);
    return wrap;
  }
  function textInput(id, value, ph, type) {
    var inp = el("input", "ef-input");
    inp.id = id;
    inp.type = type || "text";
    if (value) inp.value = value;
    if (ph) inp.placeholder = ph;
    return inp;
  }

  function addInfo(card, iconName, label, value) {
    if (!value) return;
    var row = el("div", "info-row");
    var ico = el("span", "info-ico");
    ico.appendChild(icon(iconName));
    row.appendChild(ico);
    var text = el("div", "info-text");
    text.appendChild(el("div", "info-label", label));
    text.appendChild(el("div", "info-value", value));
    row.appendChild(text);
    card.appendChild(row);
  }

  global.UI = UI;
})(window);
