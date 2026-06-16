/**
 * 렌더링 헬퍼: 아이콘 / 목록(부서·가나다) / 상세 / 빈·로딩 상태.
 * DOM 생성은 textContent·노드 조립으로 처리해 XSS 를 피한다.
 */
(function (global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  var AVATAR_COLORS = [
    "#1f6feb", "#7c3aed", "#0e7490", "#be185d",
    "#15803d", "#b45309", "#0f766e", "#7e22ce",
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
    var photo = (window.Photos && Photos.get) ? Photos.get(contact.id) : null;
    if (photo) {
      a.classList.add("avatar--photo");
      var im = el("img");
      im.src = photo;
      im.alt = (contact.name || "") + " 사진";
      a.appendChild(im);
    } else {
      a.style.background = avatarColor(contact.name || "");
      a.textContent = initial(contact.name);
    }
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
    var subParts = [contact.dept, contact.position, contact.work].filter(Boolean);
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

    if (opts.reorder && opts.onMove) {
      // 순서 편집 모드: 같은 부서 안에서 위/아래 이동(별·전화 대신)
      var sibs = (window.Data && Data.membersOfDept) ? Data.membersOfDept(contact.deptId) : [];
      var pos = sibs.map(function (s) { return s.id; }).indexOf(contact.id);
      actions.appendChild(moveBtn("up", pos <= 0, function (e) {
        if (e) e.stopPropagation(); opts.onMove(contact, -1);
      }));
      actions.appendChild(moveBtn("down", pos < 0 || pos >= sibs.length - 1, function (e) {
        if (e) e.stopPropagation(); opts.onMove(contact, 1);
      }));
    } else {
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

      if (opts.onAssign) {
        var grp = el("button", "mini-btn");
        grp.type = "button";
        grp.setAttribute("aria-label", contact.name + " 그룹 지정");
        grp.appendChild(icon("bookmark"));
        grp.addEventListener("click", function (e) {
          e.stopPropagation();
          opts.onAssign(contact);
        });
        actions.appendChild(grp);
      }

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

  /** 조직 트리 노드 1개를 재귀 렌더 (depth 0 = 부서, 1+ = 과/팀…) */
  function orgNode(node, depth, opts) {
    // 순서 편집 모드에서는 사원이 보이도록 항상 펼침
    var collapsed = !opts.reorder && !!(opts.collapsed && opts.collapsed[node.dept.id]);
    var top = depth === 0;
    var wrap = el("div", "org-node" + (top ? "" : " org-sub"));
    var header = el("button", top ? "section-header section-toggle org-dept" : "org-team-header");
    header.type = "button";
    header.id = "org-" + node.dept.id;
    header.setAttribute("aria-expanded", collapsed ? "false" : "true");
    header.appendChild(icon("chevron", "section-chevron"));
    header.appendChild(el("span", "org-dept-name", node.dept.name));
    var lead = node.members.filter(isLead)[0];
    if (lead) header.appendChild(el("span", "org-lead", lead.name + " " + lead.position));
    header.appendChild(el("span", "org-badge" + (top ? "" : " org-badge--sm"), String(node.count)));
    header.addEventListener("click", function () { if (opts.onToggle && !opts.reorder) opts.onToggle(node.dept.id); });
    wrap.appendChild(header);
    if (!collapsed) {
      var body = el("div", "org-body");
      node.members.forEach(function (c) { body.appendChild(orgRow(c, opts)); });
      node.children.forEach(function (ch) { body.appendChild(orgNode(ch, depth + 1, opts)); });
      wrap.appendChild(body);
    }
    return wrap;
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
      // 명부형: 접기/들여쓰기 없이 평면. 헤더에 부서 경로(국 › 과 › 팀) 표기
      var frag = document.createDocumentFragment();
      groups.forEach(function (g) {
        var header = el("div", "section-header section-dir");
        header.id = "dept-" + g.dept.id;
        var path = (window.Data && Data.deptPath) ? Data.deptPath(g.dept.id) : [{ name: g.dept.name }];
        if (path.length > 1) {
          header.appendChild(el("span", "section-path-inline",
            path.slice(0, -1).map(function (p) { return p.name; }).join(" › ") + " › "));
        }
        header.appendChild(el("span", "section-leaf", g.dept.name + " "));
        header.appendChild(el("span", "count", "(" + g.members.length + ")"));
        frag.appendChild(header);
        appendRows(frag, g.members, opts);
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

    /** 즐겨찾기(그룹별). fs={sections:[{group,members}], ungrouped:[...], total}.
     *  opts: onOpen,onFav,onAssign,collapsed,onToggle,onAddGroup,onRenameGroup,onRemoveGroup,onMoveGroup,
     *        emptyMsg,actionLabel,onAction */
    renderFavView: function (container, fs, opts) {
      opts = opts || {};
      container.textContent = "";
      if (!fs.total) {
        container.appendChild(UI.emptyState(opts.emptyMsg || "즐겨찾기한 연락처가 없습니다.",
          opts.actionLabel, opts.onAction));
        return;
      }
      // 상단 툴바: 그룹 추가
      var bar = el("div", "fav-toolbar");
      bar.appendChild(el("span", "fav-toolbar-info", "즐겨찾기 " + fs.total + "명 · 그룹 " + fs.sections.length + "개"));
      if (opts.onAddGroup) {
        var add = el("button", "fav-toolbar-btn");
        add.type = "button";
        add.appendChild(icon("plus"));
        add.appendChild(document.createTextNode(" 그룹 추가"));
        add.addEventListener("click", opts.onAddGroup);
        bar.appendChild(add);
      }
      container.appendChild(bar);

      var frag = document.createDocumentFragment();
      fs.sections.forEach(function (sec, i) {
        var gid = sec.group.id;
        var collapsed = !!(opts.collapsed && opts.collapsed[gid]);
        var header = el("div", "section-header fav-group-header");
        var toggle = el("button", "section-toggle fav-group-toggle");
        toggle.type = "button";
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        toggle.appendChild(icon("chevron", "section-chevron"));
        toggle.appendChild(el("span", "section-leaf", sec.group.name + " "));
        toggle.appendChild(el("span", "count", "(" + sec.members.length + ")"));
        if (opts.onToggle) toggle.addEventListener("click", function () { opts.onToggle(gid); });
        header.appendChild(toggle);

        var ctrls = el("div", "fav-group-ctrls");
        function ctrl(ico, label, disabled, fn) {
          var b = el("button", "fav-group-ctrl");
          b.type = "button"; b.setAttribute("aria-label", label);
          b.appendChild(icon(ico));
          if (disabled) b.disabled = true;
          else b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
          ctrls.appendChild(b);
        }
        if (opts.onMoveGroup) {
          ctrl("chevron", "위로", i === 0, function () { opts.onMoveGroup(sec.group, -1); });
          ctrls.lastChild.classList.add("fav-ctrl-up");
          ctrl("chevron", "아래로", i === fs.sections.length - 1, function () { opts.onMoveGroup(sec.group, 1); });
          ctrls.lastChild.classList.add("fav-ctrl-down");
        }
        if (opts.onRenameGroup) ctrl("edit", "이름 변경", false, function () { opts.onRenameGroup(sec.group); });
        if (opts.onRemoveGroup) ctrl("trash", "그룹 삭제", false, function () { opts.onRemoveGroup(sec.group); });
        header.appendChild(ctrls);
        frag.appendChild(header);

        if (!collapsed) {
          if (sec.members.length) appendRows(frag, sec.members, opts);
          else frag.appendChild(el("div", "fav-group-empty", "이 그룹에 연락처가 없습니다. 연락처 행의 🔖 버튼으로 지정하세요."));
        }
      });

      // 미분류
      if (fs.ungrouped.length) {
        var uh = el("div", "section-header fav-group-header");
        uh.appendChild(el("span", "section-leaf section-muted", "미분류 "));
        uh.appendChild(el("span", "count", "(" + fs.ungrouped.length + ")"));
        frag.appendChild(uh);
        appendRows(frag, fs.ungrouped, opts);
      }
      container.appendChild(frag);
    },

    /** 그룹 지정 오버레이 목록(다중 체크). opts: groups,selected(Set/obj),onToggle,onAddGroup */
    renderFavGroupPicker: function (container, opts) {
      container.textContent = "";
      var card = el("div", "picker-card");
      if (!opts.groups.length) {
        card.appendChild(el("div", "picker-empty", "아직 그룹이 없습니다. 아래에서 새 그룹을 만드세요."));
      }
      opts.groups.forEach(function (g) {
        var on = !!(opts.selected && opts.selected[g.id]);
        var row = el("button", "pick-row fav-pick-row" + (on ? " is-sel" : ""));
        row.type = "button";
        row.setAttribute("aria-pressed", on ? "true" : "false");
        var chk = el("span", "fav-pick-check");
        if (on) chk.appendChild(icon("star"));
        row.appendChild(chk);
        row.appendChild(el("span", "pick-name", g.name));
        row.addEventListener("click", function () { opts.onToggle(g.id); });
        card.appendChild(row);
      });
      var addRow = el("button", "pick-row fav-pick-add");
      addRow.type = "button";
      addRow.appendChild(icon("plus"));
      addRow.appendChild(el("span", "pick-name", "새 그룹 만들기"));
      addRow.addEventListener("click", opts.onAddGroup);
      card.appendChild(addRow);
      container.appendChild(card);
    },

    /** 조직도(재귀 트리): 부서 → 과 → 팀 … 임의 깊이. 각 레벨 접기 + 리더 강조.
     *  opts: onOpen,onFav,collapsed,onToggle,reorder,onToggleReorder,onMove */
    renderOrgView: function (container, tree, opts) {
      container.textContent = "";
      if (!tree.length) {
        container.appendChild(UI.emptyState("조직 정보가 없습니다."));
        return;
      }
      var totalPeople = tree.reduce(function (a, n) { return a + n.count; }, 0);
      var summary = el("div", "org-summary");
      summary.appendChild(el("span", null, "총 " + tree.length + "개 부서 · " + totalPeople + "명"));
      if (opts.onToggleReorder) {
        var rb = el("button", "org-summary-btn" + (opts.reorder ? " is-active" : ""),
          opts.reorder ? "순서 편집 완료" : "사원 순서 편집");
        rb.type = "button";
        rb.addEventListener("click", opts.onToggleReorder);
        summary.appendChild(rb);
      }
      if (opts.onToggleAll && !opts.reorder) {
        var ta = el("button", "org-summary-btn", opts.allCollapsed ? "모두 펼치기" : "모두 접기");
        ta.type = "button";
        ta.addEventListener("click", opts.onToggleAll);
        summary.appendChild(ta);
      }
      if (opts.onManage && !opts.reorder) {
        var mb = el("button", "org-summary-btn org-manage-btn", "부서 관리");
        mb.type = "button";
        mb.addEventListener("click", opts.onManage);
        summary.appendChild(mb);
      }
      container.appendChild(summary);
      if (opts.reorder) {
        container.appendChild(el("div", "org-reorder-hint",
          "▲▼ 로 같은 부서 안에서 사원 순서를 바꿉니다. 완료를 누르면 적용됩니다."));
      }

      var frag = document.createDocumentFragment();
      tree.forEach(function (n) { frag.appendChild(orgNode(n, 0, opts)); });
      container.appendChild(frag);
    },

    /** 편집/추가 폼 렌더. 입력값은 #ef-* id로 app이 읽는다. */
    renderEditForm: function (container, contact, departments) {
      container.textContent = "";
      contact = contact || {};
      var form = el("div", "edit-form");

      // 사진 블록 (app이 미리보기 채우고 버튼/파일 입력을 연결)
      var photoRow = el("div", "ef-photo");
      var prev = el("div", "ef-photo-prev");
      prev.id = "ef-photo-prev";
      photoRow.appendChild(prev);
      var pbtns = el("div", "ef-photo-btns");
      var pick = el("button", "ef-photo-btn"); pick.id = "ef-photo-pick"; pick.type = "button"; pick.textContent = "사진 선택";
      var rem = el("button", "ef-photo-btn ef-photo-rem"); rem.id = "ef-photo-remove"; rem.type = "button"; rem.textContent = "제거";
      pbtns.appendChild(pick); pbtns.appendChild(rem);
      photoRow.appendChild(pbtns);
      var fileInp = el("input"); fileInp.id = "ef-photo-file"; fileInp.type = "file"; fileInp.accept = "image/*"; fileInp.hidden = true;
      photoRow.appendChild(fileInp);
      form.appendChild(photoRow);

      form.appendChild(field("이름", textInput("ef-name", contact.name, "홍길동")));

      form.appendChild(pickerField("부서", "ef-dept-btn", "ef-dept",
        (contact.deptId != null ? String(contact.deptId) : "0"),
        deptLabel(contact.deptId, "(미지정)")));

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

    /** 부서 관리 목록: 직제순 + 레벨 들여쓰기, 각 행 탭 → onEdit(dept) */
    renderDeptManager: function (container, departments, counts, h) {
      container.textContent = "";
      if (!departments.length) {
        container.appendChild(UI.emptyState("부서가 없습니다. ‘부서 추가’로 만들어 보세요."));
        return;
      }
      var byParent = {};
      departments.forEach(function (d) {
        var p = d.parentId || 0;
        (byParent[p] = byParent[p] || []).push(d);
      });
      var card = el("div", "info-card");
      departments.forEach(function (d) {
        var sibs = byParent[d.parentId || 0];
        var i = sibs.indexOf(d);
        var row = el("div", "deptmgr-row");
        row.style.paddingLeft = (12 + Data.depthOf(d.id) * 16) + "px";

        var main = el("button", "deptmgr-main");
        main.type = "button";
        var nm = el("div", "info-value");
        nm.appendChild(document.createTextNode(d.name));
        if (d._custom) nm.appendChild(el("span", "edit-chip edit-chip--inline", "추가"));
        main.appendChild(nm);
        var dc = (counts.direct[d.id] || 0), cc = (counts.child[d.id] || 0);
        var subTxt = "직속 " + dc + "명" + (cc ? " · 하위 " + cc + "개" : "");
        if (dc === 0 && cc === 0) subTxt += " · 빈 부서(조직도 미표시)";
        main.appendChild(el("div", "info-label", subTxt));
        main.addEventListener("click", function () { h.onEdit(d); });
        row.appendChild(main);

        var acts = el("div", "deptmgr-acts");
        acts.appendChild(moveBtn("up", i === 0, function () { h.onMove(d, -1); }));
        acts.appendChild(moveBtn("down", i === sibs.length - 1, function () { h.onMove(d, 1); }));
        var addc = el("button", "mini-btn mini-btn--ghost");
        addc.type = "button";
        addc.setAttribute("aria-label", d.name + " 하위 부서 추가");
        addc.appendChild(icon("plus"));
        addc.addEventListener("click", function () { h.onAddChild(d); });
        acts.appendChild(addc);
        row.appendChild(acts);
        card.appendChild(row);
      });
      container.appendChild(card);
    },

    /** 부서 편집/추가 폼. 입력값은 #df-* id로 app이 읽는다. */
    renderDeptForm: function (container, dept, departments) {
      container.textContent = "";
      dept = dept || {};
      var form = el("div", "edit-form");
      form.appendChild(field("부서명", textInput("df-name", dept.name, "예: 행정복지국 / 자치행정과 / 총무팀")));

      form.appendChild(pickerField("상위 부서", "df-parent-btn", "df-parent",
        String(dept.parentId || 0),
        dept.parentId ? deptLabel(dept.parentId) : "최상위 (국·실·관)"));
      container.appendChild(form);
      var note = el("p", "settings-note", "순서(직제)는 부서 관리 목록에서 ▲▼ 버튼으로 조정합니다.");
      container.appendChild(note);
    },

    /** 부서 선택 목록(검색·트리). opts: departments,query,currentId,exclude,allowNone,noneLabel,onPick */
    renderDeptPicker: function (container, opts) {
      container.textContent = "";
      var q = (opts.query || "").trim().toLowerCase();
      var card = el("div", "info-card");
      if (opts.allowNone && !q) {
        card.appendChild(pickRow(opts.noneLabel || "(미지정)", null, opts, 0));
      }
      (opts.departments || []).forEach(function (d) {
        if (opts.exclude && opts.exclude[d.id]) return;
        var path = (window.Data && Data.deptPath) ? Data.deptPath(d.id) : [{ name: d.name }];
        var hay = path.map(function (x) { return x.name; }).join(" ").toLowerCase();
        if (q && hay.indexOf(q) === -1) return;
        card.appendChild(pickRow(d.name, path, opts, d.id));
      });
      if (!card.childNodes.length) container.appendChild(UI.emptyState("일치하는 부서가 없습니다."));
      else container.appendChild(card);
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
    renderDetail: function (container, contact, opts) {
      opts = opts || {};
      container.textContent = "";

      var hero = el("div", "detail-hero");
      var av = makeAvatar(contact, "");
      var photo = (window.Photos && Photos.get) ? Photos.get(contact.id) : null;
      if (photo && opts.onPhoto) {
        av.setAttribute("role", "button");
        av.tabIndex = 0;
        av.setAttribute("aria-label", "사진 크게 보기");
        av.style.cursor = "zoom-in";
        av.addEventListener("click", function () { opts.onPhoto(photo, contact.name); });
        av.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onPhoto(photo, contact.name); } });
      }
      hero.appendChild(av);
      hero.appendChild(el("h2", "detail-name", contact.name || ""));
      var roleParts = [contact.position, contact.dept].filter(Boolean);
      if (roleParts.length) hero.appendChild(el("p", "detail-role", roleParts.join(" · ")));
      var chips = el("div", "detail-chips");
      var sb = statusBadge(contact.status);
      if (sb) chips.appendChild(sb);
      if (contact._custom) chips.appendChild(el("span", "edit-chip", "추가한 연락처"));
      else if (contact._edited) chips.appendChild(el("span", "edit-chip", "수정됨"));
      if (chips.childNodes.length) hero.appendChild(chips);
      container.appendChild(hero);

      var qa = el("div", "quick-actions");
      qa.appendChild(quickComm("phone", "전화", contact.phone ? "tel:" + clean(contact.phone) : null, "전화 걸기"));
      qa.appendChild(quickComm("message", "문자", contact.phone ? "sms:" + clean(contact.phone) : null, "문자 보내기"));
      qa.appendChild(quickComm("building", "사내전화", contact.tel ? "tel:" + clean(contact.tel) : null, "사내번호로 전화"));
      qa.appendChild(quickBtn("share", "공유", function () { shareContact(contact); }, "연락처 공유", true));
      qa.appendChild(quickBtn("download", "저장", function () { downloadVCard(contact); }, "연락처 파일로 저장", true));
      container.appendChild(qa);

      // 연락처 섹션
      var c1 = el("div", "info-card");
      addPhoneRow(c1, "mobile", "휴대전화", contact.phone);
      addPhoneRow(c1, "building", "사내번호", contact.tel);
      var rep = deptRep(contact);
      if (rep) addPhoneRow(c1, "users", "부서 대표(" + rep.name + ")", rep.tel);
      addInfo(c1, "cake", "생년월일", contact.birth);
      if (c1.childNodes.length) {
        container.appendChild(sectionTitle("연락처"));
        container.appendChild(c1);
      }

      // 소속 섹션
      var c2 = el("div", "info-card");
      addOrgRow(c2, contact, opts.onOrg);
      addInfo(c2, "work", "담당업무", contact.work);
      addInfo(c2, "status", "재직상태", contact.status && contact.status !== "미설정" ? contact.status : null);
      if (c2.childNodes.length) {
        container.appendChild(sectionTitle("소속"));
        container.appendChild(c2);
      }
    },
  };

  function sectionTitle(text) { return el("div", "info-section-title", text); }

  // 통신 quick(전화/문자/사내): 값 없으면 disabled 버튼(접근 가능·시각적 비활성)
  function quickComm(iconName, label, href, aria) {
    var node;
    if (href) { node = el("a", "quick"); node.href = href; node.setAttribute("aria-label", aria); }
    else { node = el("button", "quick quick--off"); node.type = "button"; node.disabled = true; node.setAttribute("aria-label", label + " 없음"); }
    var ico = el("div", "quick-ico");
    ico.appendChild(icon(iconName));
    node.appendChild(ico);
    node.appendChild(el("span", null, label));
    return node;
  }

  function quickBtn(iconName, label, onClick, aria, util) {
    var node = el("button", "quick" + (util ? " quick--util" : ""));
    node.type = "button";
    node.setAttribute("aria-label", aria);
    var ico = el("div", "quick-ico");
    ico.appendChild(icon(iconName));
    node.appendChild(ico);
    node.appendChild(el("span", null, label));
    node.addEventListener("click", onClick);
    return node;
  }

  /** 같은 부서 리더(장)의 사내번호 — 본인과 다르면 '부서 대표'로 노출 */
  function deptRep(contact) {
    if (!(window.Data && Data.membersOfDept)) return null;
    var mem = Data.membersOfDept(contact.deptId);
    for (var i = 0; i < mem.length; i++) {
      var m = mem[i];
      if (m.id !== contact.id && isLead(m) && m.tel) return { name: m.name, tel: m.tel };
    }
    return null;
  }

  /** 조직 경로(국 › 과 › 팀) 행 — onOrg 있으면 탭 시 조직도 이동 */
  function addOrgRow(card, contact, onOrg) {
    var path = (window.Data && Data.deptPath) ? Data.deptPath(contact.deptId) : [];
    if (!path.length) { addInfo(card, "building", "부서", contact.dept); return; }
    var row = onOrg ? el("button", "info-row info-row--btn") : el("div", "info-row");
    if (onOrg) {
      row.type = "button";
      row.setAttribute("aria-label", "조직도에서 " + path[path.length - 1].name + " 보기");
      row.addEventListener("click", function () { onOrg(contact.deptId); });
    }
    var ico = el("span", "info-ico");
    ico.appendChild(icon("building"));
    row.appendChild(ico);
    var text = el("div", "info-text");
    text.appendChild(el("div", "info-label", "조직"));
    var v = el("div", "info-value");
    path.forEach(function (p, i) {
      if (i) v.appendChild(el("span", "org-sep", " › "));
      v.appendChild(document.createTextNode(p.name));
    });
    text.appendChild(v);
    row.appendChild(text);
    if (onOrg) { var ch = el("span", "info-chevron"); ch.appendChild(icon("chevron")); row.appendChild(ch); }
    card.appendChild(row);
  }

  /** 전화 정보 행: 값(전화 링크) + [복사] */
  function addPhoneRow(card, iconName, label, raw) {
    if (!raw) return;
    var row = el("div", "info-row");
    var ico = el("span", "info-ico");
    ico.appendChild(icon(iconName));
    row.appendChild(ico);
    var text = el("div", "info-text");
    text.appendChild(el("div", "info-label", label));
    var val = el("a", "info-value info-value--link");
    val.href = "tel:" + clean(raw);
    val.textContent = formatPhone(raw);
    val.setAttribute("aria-label", label + " " + formatPhone(raw) + " 전화 걸기");
    text.appendChild(val);
    row.appendChild(text);
    var acts = el("div", "info-actions");
    var copy = el("button", "mini-btn mini-btn--ghost");
    copy.type = "button";
    copy.setAttribute("aria-label", label + " 복사");
    copy.appendChild(icon("copy"));
    copy.addEventListener("click", function () { copyText(formatPhone(raw)); });
    acts.appendChild(copy);
    row.appendChild(acts);
    card.appendChild(row);
  }

  function pickRow(name, path, opts, id) {
    var row = el("button", "picker-row");
    row.type = "button";
    var depth = (path && path.length > 1 && window.Data && Data.depthOf) ? Data.depthOf(id) : 0;
    row.style.paddingLeft = (16 + depth * 16) + "px";
    var main = el("div", "info-text");
    if (path && path.length > 1) {
      main.appendChild(el("div", "info-label",
        path.slice(0, -1).map(function (x) { return x.name; }).join(" › ")));
    }
    main.appendChild(el("div", "info-value", name));
    row.appendChild(main);
    if (String(opts.currentId == null ? 0 : opts.currentId) === String(id)) {
      row.appendChild(el("span", "picker-check", "✓"));
    }
    row.addEventListener("click", function () { opts.onPick(id, path); });
    return row;
  }

  function moveBtn(dir, disabled, fn) {
    var b = el("button", "mini-btn mini-btn--ghost deptmgr-move");
    b.type = "button";
    b.setAttribute("aria-label", dir === "up" ? "위로 이동" : "아래로 이동");
    if (disabled) b.disabled = true;
    b.appendChild(icon("chevron", "chev-" + dir));
    b.addEventListener("click", fn);
    return b;
  }

  /** dept.id의 모든 하위(자손) id 집합 — 순환 부모 선택 방지용 */
  function descendantsOf(id, depts) {
    var set = {};
    if (!id) return set;
    var byParent = {};
    depts.forEach(function (d) { (byParent[d.parentId] = byParent[d.parentId] || []).push(d.id); });
    (function rec(pid) {
      (byParent[pid] || []).forEach(function (cid) {
        if (!set[cid]) { set[cid] = true; rec(cid); }
      });
    })(id);
    return set;
  }

  function field(label, input) {
    var wrap = el("label", "ef-field");
    wrap.appendChild(el("span", "ef-label", label));
    wrap.appendChild(input);
    return wrap;
  }
  /** 부서 경로 라벨 (국 › 과 › 팀) */
  function deptLabel(id, fallback) {
    if (id == null || id === 0 || id === "0" || id === "") return fallback || "(미지정)";
    if (window.Data && Data.deptPath) {
      var p = Data.deptPath(id);
      if (p.length) return p.map(function (x) { return x.name; }).join(" › ");
    }
    return String(id);
  }
  /** select 대체: 값 표시 버튼 + hidden input (app이 picker로 채움) */
  function pickerField(labelText, btnId, hiddenId, hiddenVal, btnText) {
    var wrap = el("div", "ef-field");
    wrap.appendChild(el("span", "ef-label", labelText));
    var btn = el("button", "ef-picker-btn");
    btn.id = btnId; btn.type = "button";
    btn.appendChild(el("span", "ef-picker-val", btnText));
    btn.appendChild(icon("chevron", "ef-picker-chev"));
    wrap.appendChild(btn);
    var h = el("input"); h.type = "hidden"; h.id = hiddenId; h.value = hiddenVal;
    wrap.appendChild(h);
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
