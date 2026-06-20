/**
 * 렌더링 헬퍼: 아이콘 / 목록(부서·가나다) / 상세 / 빈·로딩 상태.
 * DOM 생성은 textContent·노드 조립으로 처리해 XSS 를 피한다.
 */
(function (global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  // 이름 글자 아바타 배경색 — 이전엔 이름별 랜덤 팔레트라 산만했음. 브랜드 색으로 통일.
  function avatarColor(name) {
    return "#1f6feb"; // var(--brand)
  }

  function initial(name) { return name ? name.trim().charAt(0) : "?"; }

  // 즐겨찾기 그룹 색상 팔레트. "none"=무채색(기본). 키는 CSS .swatch--{key}/.fav-dot--{key} 와 1:1.
  var FAV_COLORS = [
    { key: "none", label: "기본" },
    { key: "red", label: "빨강" },
    { key: "orange", label: "주황" },
    { key: "amber", label: "노랑" },
    { key: "green", label: "초록" },
    { key: "teal", label: "청록" },
    { key: "blue", label: "파랑" },
    { key: "purple", label: "보라" },
    { key: "pink", label: "분홍" },
  ];
  function favColorKey(c) {
    // 저장값 정규화: 팔레트에 없거나 비었으면 "none"
    for (var i = 0; i < FAV_COLORS.length; i++) if (FAV_COLORS[i].key === c) return c;
    return "none";
  }
  // 그룹 색 점(dot). asButton=true 면 클릭 가능한 색상 변경 버튼(탭 영역 확장 위해 내부 점을 감싼다).
  function favDot(colorKey, asButton, onClick) {
    var k = favColorKey(colorKey);
    if (asButton) {
      var btn = el("button", "fav-dot-btn");
      btn.type = "button";
      btn.setAttribute("aria-label", "그룹 색상 변경");
      btn.appendChild(el("span", "fav-dot fav-dot--" + k));
      if (onClick) btn.addEventListener("click", function (e) { e.stopPropagation(); onClick(); });
      return btn;
    }
    return el("span", "fav-dot fav-dot--" + k);
  }

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

  // 초성만으로 이루어진 검색어(ㄱ~ㅎ) 판별 — 초성 강조 적용 대상
  var CHO_ONLY = /^[ㄱ-ㅎ]+$/;

  /** text 안의 검색어 일치 부분을 <mark>로 강조하여 parent 에 추가.
   *  terms 는 문자열 또는 문자열 배열(연산자 검색의 다중 긍정어). 겹치는 구간은 병합.
   *  cho=true 면 초성 검색어를 표시 텍스트의 초성열에서도 찾아 해당 음절을 강조한다
   *  (검색이 초성 매칭을 '이름'에만 하므로 이름 필드에서만 켠다). */
  function highlightInto(parent, text, terms, cho) {
    text = text || "";
    if (typeof terms === "string") terms = terms ? [terms] : [];
    terms = (terms || []).filter(Boolean);
    if (!terms.length) { parent.appendChild(document.createTextNode(text)); return; }
    var lower = text.toLowerCase(), ranges = [];
    // 초성열은 초성 검색어가 하나라도 있을 때만 1회 계산(불필요한 변환 방지)
    var choText = (cho && window.Data && window.Data.chosung &&
      terms.some(function (t) { return CHO_ONLY.test(t); })) ? window.Data.chosung(text) : null;
    terms.forEach(function (t) {
      var ql = ("" + t).toLowerCase(), idx = 0, pos;
      if (!ql) return;
      while ((pos = lower.indexOf(ql, idx)) !== -1) { ranges.push([pos, pos + ql.length]); idx = pos + ql.length; }
      // 초성 검색어: 초성열 인덱스가 원문과 1:1 정렬 → 찾은 구간을 그대로 음절 강조에 사용
      if (choText && CHO_ONLY.test(t)) {
        var term = "" + t, j = 0, p;
        while ((p = choText.indexOf(term, j)) !== -1) { ranges.push([p, p + term.length]); j = p + term.length; }
      }
    });
    if (!ranges.length) { parent.appendChild(document.createTextNode(text)); return; }
    ranges.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var merged = [ranges[0].slice()];
    for (var i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
      else merged.push(ranges[i].slice());
    }
    var cur = 0;
    merged.forEach(function (r) {
      if (r[0] > cur) parent.appendChild(document.createTextNode(text.slice(cur, r[0])));
      parent.appendChild(el("mark", null, text.slice(r[0], r[1])));
      cur = r[1];
    });
    if (cur < text.length) parent.appendChild(document.createTextNode(text.slice(cur)));
  }

  function statusBadge(status) {
    var map = { "휴직": "badge--leave", "파견": "badge--dispatched", "교육": "badge--training" };
    if (!map[status]) return null;
    return el("span", "badge " + map[status], status);
  }

  // 전역 설정: 사진 없는 모든 연락처를 기본 아이콘(실루엣)으로 표시할지 (app이 부팅/토글 시 주입)
  var showDefaultIcon = false;

  // 기본 아이콘 = 앱 아이콘(로고). 색상 원+이니셜 대신 쓰는 중립 placeholder
  function defaultIconNode() {
    var im = el("img");
    im.loading = "lazy"; im.decoding = "async";
    im.src = "icons/icon-192.png";
    im.alt = "기본 아이콘";
    return im;
  }

  function makeAvatar(contact, sizeClass) {
    var a = el("div", "avatar" + (sizeClass ? " " + sizeClass : ""));
    var photo = (window.Photos && Photos.get) ? Photos.get(contact.id) : null;
    if (photo) {
      a.classList.add("avatar--photo");
      var im = el("img");
      im.loading = "lazy"; im.decoding = "async"; // 화면 밖 사진 디코드 지연 → 긴 목록 가속
      im.src = photo;
      im.alt = (contact.name || "") + " 사진";
      a.appendChild(im);
    } else if (contact.defaultIcon || showDefaultIcon) {
      a.classList.add("avatar--default");
      a.appendChild(defaultIconNode());
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
    if (c.grade) lines.push("ROLE:" + esc(c.grade));
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
    if (c.position || c.grade || c.dept) parts.push([c.dept, c.team, c.position, c.grade].filter(Boolean).join(" "));
    if (c.phone) parts.push("휴대전화 " + formatPhone(c.phone));
    if (c.tel) parts.push("행정번호 " + formatPhone(c.tel));
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
    if (contact.id != null) row.dataset.id = contact.id; // 다중선택 식별용
    var subParts = [contact.dept, contact.position, contact.grade, contact.work].filter(Boolean);
    row.setAttribute("aria-label", (contact.name || "") + ", " + subParts.join(" ") + ", 상세 보기");

    row.appendChild(makeAvatar(contact));

    var main = el("div", "row-main");
    var name = el("div", "row-name");
    var nameText = el("span");
    highlightInto(nameText, contact.name || "", opts.query, true); // 이름: 초성 강조 켬
    name.appendChild(nameText);
    var badge = statusBadge(contact.status);
    if (badge) name.appendChild(badge);
    main.appendChild(name);
    var sub = el("div", "row-sub");
    var subText = el("span", "row-sub-text"); // 마퀴(흐름) 대상 — 평소엔 inline 으로 말줄임 유지
    highlightInto(subText, subParts.join(" · "), opts.query);
    sub.appendChild(subText);
    main.appendChild(sub);
    row.appendChild(main);

    var actions = el("div", "row-actions");

    if (opts.reorder && opts.onMove) {
      // 순서 편집 모드: 같은 부서 안에서 ▲▼ 이동 + '다른 부서로' 이동(별·전화 대신)
      var sibs = (window.Data && Data.membersOfDept) ? Data.membersOfDept(contact.deptId) : [];
      var pos = sibs.map(function (s) { return s.id; }).indexOf(contact.id);
      var nm = contact.name || "";
      var upB = moveBtn("up", pos <= 0, function (e) {
        if (e) e.stopPropagation(); opts.onMove(contact, -1);
      });
      upB.setAttribute("aria-label", nm + " 위로 이동");
      actions.appendChild(upB);
      var dnB = moveBtn("down", pos < 0 || pos >= sibs.length - 1, function (e) {
        if (e) e.stopPropagation(); opts.onMove(contact, 1);
      });
      dnB.setAttribute("aria-label", nm + " 아래로 이동");
      actions.appendChild(dnB);
      if (opts.onMoveDept) {
        var md = el("button", "mini-btn mini-btn--ghost");
        md.type = "button";
        md.setAttribute("aria-label", (contact.name || "") + " 다른 부서로 이동");
        md.appendChild(icon("building"));
        md.addEventListener("click", function (e) { e.stopPropagation(); opts.onMoveDept(contact); });
        actions.appendChild(md);
      }
    } else {
      var isFav = Storage.isFavorite(contact.id);
      var star = el("button", "mini-btn mini-btn--star" + (isFav ? " is-on" : ""));
      star.type = "button";
      star.setAttribute("aria-label", isFav ? "즐겨찾기 해제" : "즐겨찾기 추가");
      star.setAttribute("aria-pressed", isFav ? "true" : "false");
      star.appendChild(icon("star"));
      star.dataset.act = "fav"; // 클릭은 listEl 이벤트 위임에서 처리(행마다 리스너 안 닮)
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
        call.dataset.act = "call"; // 위임에서 pushRecent (기본 tel: 동작은 유지)
        actions.appendChild(call);
      }

      if (opts.onRemove) {
        // 최근 목록에서 이 항목만 제거(연락처 자체는 삭제하지 않음)
        var rm = el("button", "mini-btn mini-btn--ghost");
        rm.type = "button";
        rm.setAttribute("aria-label", (contact.name || "") + " 최근에서 제거");
        rm.appendChild(icon("close"));
        rm.addEventListener("click", function (e) { e.stopPropagation(); opts.onRemove(contact); });
        actions.appendChild(rm);
      }
    }
    row.appendChild(actions);
    // 행 열기(클릭/Enter/Space)와 즐겨찾기·전화 클릭은 listEl 이벤트 위임에서 처리한다.
    // (행마다 리스너를 달지 않아 긴 목록 재렌더 비용·GC 부담 감소)
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
    var header = el("button",
      (top ? "section-header section-toggle org-dept" : "org-team-header") +
      " org-lvl-" + Math.min(depth, 2));
    header.type = "button";
    header.id = "org-" + node.dept.id;
    // 트리 시맨틱: 헤더 button 을 treeitem 으로 승격하고 깊이를 aria-level 로 노출.
    // (role=treeitem 이 button role 을 대체하지만 aria-expanded·키보드 활성은 그대로 동작)
    header.setAttribute("role", "treeitem");
    header.setAttribute("aria-level", String(depth + 1));
    header.tabIndex = -1; // roving tabindex — renderOrgView/포커스 핸들러가 활성 1개만 0으로
    // 과/팀 헤더의 계단식 sticky top/z-index 계산용 깊이(최대 2단까지 쌓음)
    if (!top) {
      header.style.setProperty("--depth", Math.min(depth, 2));
      // 2단을 넘는 깊이는 같은 top/z-index 에 쌓여 겹치므로 sticky 를 끄고 본문과 함께 스크롤
      if (depth > 2) header.classList.add("org-header-flat");
    }
    header.setAttribute("aria-expanded", collapsed ? "false" : "true");
    header.appendChild(icon("chevron", "section-chevron"));
    header.appendChild(el("span", "org-dept-name", node.dept.name));
    var lead = node.members.filter(isLead)[0];
    if (lead) header.appendChild(el("span", "org-lead", lead.name + " " + lead.position));
    // 배지: 직속 인원(주) + 하위 포함 누적(보조). 자손이 있을 때만 누적을 덧붙여
    // "이 부서 자체에 몇 명, 산하 전체로 몇 명"이 한눈에 구분되게 한다.
    var direct = node.members.length, total = node.count;
    var badge = el("span", "org-badge" + (top ? "" : " org-badge--sm"));
    if (direct === 0 && total > 0) {
      // 직속 인원 없이 산하에만 있으면 '0/' 군더더기 없이 누적 총원만 표시
      badge.textContent = String(total);
    } else {
      badge.textContent = String(direct);
      if (total > direct) badge.appendChild(el("span", "org-badge-total", "/" + total));
    }
    header.appendChild(badge);
    // 접힘/펼침은 aria-expanded 가 전달하므로 라벨에서 제외(중복 읽힘 방지).
    // 시각적으로 강조되는 리더(이름+직위)도 라벨에 포함해 스크린리더 정보 누락을 막는다.
    header.setAttribute("aria-label",
      node.dept.name +
      (lead ? ", " + lead.name + " " + lead.position : "") +
      ", 직속 " + direct + "명" +
      (total > direct ? ", 전체 " + total + "명" : ""));
    header.addEventListener("click", function () { if (opts.onToggle && !opts.reorder) opts.onToggle(node.dept.id); });
    wrap.appendChild(header);
    if (!collapsed) {
      var body = el("div", "org-body");
      body.setAttribute("role", "group"); // treeitem 의 자식 묶음
      node.members.forEach(function (c) { body.appendChild(orgRow(c, opts)); });
      node.children.forEach(function (ch) { body.appendChild(orgNode(ch, depth + 1, opts)); });
      wrap.appendChild(body);
    }
    return wrap;
  }

  var UI = {
    avatarColor: avatarColor,
    FAV_COLORS: FAV_COLORS,
    favColorKey: favColorKey,
    defaultIcon: defaultIconNode,
    setShowDefaultIcon: function (v) { showDefaultIcon = !!v; },
    icon: icon,
    formatPhone: formatPhone,
    renderRow: renderRow,

    /** 여러 연락처를 하나의 vCard 텍스트로 직렬화 */
    buildVCards: function (contacts) {
      return (contacts || []).filter(Boolean).map(buildVCard).join("\r\n") + "\r\n";
    },
    /** 여러 연락처를 하나의 .vcf 파일로 일괄 내보내기. 반환: 내보낸 건수 */
    downloadVCards: function (contacts, filename) {
      contacts = (contacts || []).filter(Boolean);
      if (!contacts.length) return 0;
      var text = contacts.map(buildVCard).join("\r\n") + "\r\n";
      var blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = el("a");
      a.href = url; a.download = filename || "contacts.vcf";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return contacts.length;
    },

    /** 부서 뷰 (접기/펼치기). opts: onOpen,onFav,collapsed,onToggle */
    renderDeptView: function (container, groups, opts) {
      container.textContent = "";
      if (!groups.length) {
        container.appendChild(UI.emptyState("표시할 연락처가 없습니다."));
        return;
      }
      // 명부형: 접기/들여쓰기 없이 평면.
      // 헤더 위계: 상위 경로(키커, 윗줄) → 부서명(굵게, 아랫줄) → 인원 배지 → 이동 셰브론
      var frag = document.createDocumentFragment();
      groups.forEach(function (g) {
        var jump = !!opts.onDeptJump;
        var header = el(jump ? "button" : "div",
          "section-header section-dir" + (jump ? " section-jump" : ""));
        header.id = "dept-" + g.dept.id;
        var txt = el("span", "section-dir-text");
        var path = (window.Data && Data.deptPath) ? Data.deptPath(g.dept.id) : [{ name: g.dept.name }];
        if (path.length > 1) {
          txt.appendChild(el("span", "section-kicker",
            path.slice(0, -1).map(function (p) { return p.name; }).join(" › ")));
        }
        txt.appendChild(el("span", "section-leaf", g.dept.name));
        header.appendChild(txt);
        header.appendChild(el("span", "section-count-badge", String(g.members.length)));
        if (jump) {
          header.type = "button";
          header.setAttribute("aria-label", g.dept.name + " 부서를 조직도에서 보기");
          header.appendChild(icon("chevron", "section-jump-chev"));
          header.addEventListener("click", function () { opts.onDeptJump(g.dept.id); });
        }
        // 섹션 래퍼: sticky 헤더의 범위를 자기 섹션으로 한정해 헤더가 누적(겹침)되지 않게 함
        var section = el("div", "list-section");
        section.appendChild(header);
        appendRows(section, g.members, opts);
        frag.appendChild(section);
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
        // 섹션 래퍼: sticky 헤더 누적(겹침) 방지 — 헤더 범위를 자기 섹션으로 한정
        var section = el("div", "list-section");
        section.appendChild(header);
        appendRows(section, g.members, opts);
        frag.appendChild(section);
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

    /** 최근(날짜 그룹). groups=[{label, members:[contact]}].
     *  opts: onOpen,onFav,onRemove,onClearAll,emptyMsg,actionLabel,onAction */
    renderRecentView: function (container, groups, opts) {
      opts = opts || {};
      container.textContent = "";
      var total = groups.reduce(function (n, g) { return n + g.members.length; }, 0);
      if (!total) {
        container.appendChild(UI.emptyState(opts.emptyMsg || "최근 본 연락처가 없습니다.",
          opts.actionLabel, opts.onAction));
        return;
      }
      // 상단 툴바: 전체 비우기 (즐겨찾기 툴바와 동일 스타일 재사용)
      var bar = el("div", "fav-toolbar");
      bar.appendChild(el("span", "fav-toolbar-info", "최근 " + total + "명"));
      if (opts.onClearAll) {
        var clr = el("button", "fav-toolbar-btn");
        clr.type = "button";
        clr.appendChild(icon("trash"));
        clr.appendChild(document.createTextNode(" 전체 비우기"));
        clr.addEventListener("click", opts.onClearAll);
        bar.appendChild(clr);
      }
      container.appendChild(bar);

      var frag = document.createDocumentFragment();
      groups.forEach(function (g) {
        var header = el("div", "section-header");
        header.appendChild(document.createTextNode(g.label + " "));
        header.appendChild(el("span", "count", "(" + g.members.length + ")"));
        var section = el("div", "list-section"); // sticky 헤더 누적(겹침) 방지
        section.appendChild(header);
        appendRows(section, g.members, opts);
        frag.appendChild(section);
      });
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
        var key = favColorKey(sec.group.color);
        var collapsed = !!(opts.collapsed && opts.collapsed[gid]);
        var header = el("div", "section-header fav-group-header");
        // 색 점(클릭 시 색상 변경)
        header.appendChild(favDot(sec.group.color, !!opts.onSetColor, function () { opts.onSetColor(sec.group); }));
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
        var section = el("div", "list-section fav-group-section"); // sticky 헤더 누적(겹침) 방지
        // 그룹 색을 섹션 변수로 주입 → 헤더 좌측 바·멤버 행 좌측 액센트에 사용
        section.style.setProperty("--fav-color", key === "none" ? "transparent" : "var(--fav-c-" + key + ")");
        section.appendChild(header);
        if (!collapsed) {
          if (sec.members.length) appendRows(section, sec.members, opts);
          else section.appendChild(el("div", "fav-group-empty", "이 그룹에 연락처가 없습니다. 연락처의 북마크 버튼으로 지정하세요."));
        }
        frag.appendChild(section);
      });

      // 미분류
      if (fs.ungrouped.length) {
        var uh = el("div", "section-header fav-group-header fav-group-header--plain");
        uh.appendChild(favDot(null, false)); // 색 점 열 정렬용(무채색 = 미분류)
        uh.appendChild(el("span", "section-leaf section-muted", "미분류 "));
        uh.appendChild(el("span", "count", "(" + fs.ungrouped.length + ")"));
        var us = el("div", "list-section");
        us.appendChild(uh);
        appendRows(us, fs.ungrouped, opts);
        frag.appendChild(us);
      }
      container.appendChild(frag);
    },

    /** 그룹 지정 오버레이 목록(다중 체크). opts: groups,selected(Set/obj),onToggle,onAddGroup */
    renderFavGroupPicker: function (container, opts) {
      container.textContent = "";
      var counts = opts.counts || {};
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
        row.appendChild(favDot(g.color, false));
        row.appendChild(el("span", "pick-name", g.name));
        row.appendChild(el("span", "fav-pick-count", (counts[g.id] || 0) + "명"));
        row.addEventListener("click", function () { opts.onToggle(g.id); });
        card.appendChild(row);
      });
      // 새 그룹 만들기 — 모달 내 입력칸(이전 window.prompt 대체)
      var form = el("form", "fav-pick-addform");
      var input = el("input", "fav-pick-input");
      input.type = "text"; input.placeholder = "새 그룹 이름"; input.maxLength = 30;
      input.setAttribute("aria-label", "새 그룹 이름");
      var addBtn = el("button", "fav-pick-addbtn");
      addBtn.type = "submit";
      addBtn.appendChild(icon("plus"));
      addBtn.appendChild(el("span", null, "추가"));
      form.appendChild(input);
      form.appendChild(addBtn);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v) { input.focus(); return; }
        opts.onAddGroup(v);
      });
      card.appendChild(form);
      container.appendChild(card);
    },

    /** 조직도(재귀 트리): 부서 → 과 → 팀 … 임의 깊이. 각 레벨 접기 + 리더 강조.
     *  opts: onOpen,onFav,collapsed,onToggle,reorder,onToggleReorder,onMove */
    renderOrgView: function (container, tree, opts) {
      container.textContent = "";
      if (!tree.length) {
        container.appendChild(UI.emptyState("조직 정보가 없습니다.",
          opts.onManage ? "부서 관리" : null, opts.onManage));
        return;
      }
      var totalPeople = tree.reduce(function (a, n) { return a + n.count; }, 0);
      var summary = el("div", "org-summary");
      summary.appendChild(el("span", "org-summary-info",
        "총 " + tree.length + "개 부서 · " + totalPeople + "명"));
      var bar = el("div", "org-toolbar");
      // 아이콘+라벨 툴바 버튼 헬퍼
      function tbtn(ico, label, cls, fn) {
        var b = el("button", "org-tbtn" + (cls ? " " + cls : ""));
        b.type = "button";
        b.appendChild(icon(ico));
        b.appendChild(el("span", "org-tbtn-label", label));
        b.addEventListener("click", fn);
        bar.appendChild(b);
        return b;
      }
      if (opts.reorder) {
        // 편집 중: 완료 버튼만 강조
        tbtn("check", "순서 편집 완료", "org-tbtn--done is-active", opts.onToggleReorder);
      } else {
        if (opts.onToggleAll) {
          tbtn(opts.allCollapsed ? "expand-all" : "collapse-all",
            opts.allCollapsed ? "모두 펼치기" : "모두 접기", null, opts.onToggleAll);
        }
        if (opts.onToggleReorder) tbtn("grip", "사원 순서", null, opts.onToggleReorder);
        if (opts.onManage) tbtn("building", "부서 관리", null, opts.onManage);
      }
      summary.appendChild(bar);
      container.appendChild(summary);
      if (opts.reorder) {
        // 힌트의 버튼 지칭을 이모지 대신 실제 아이콘으로 → 화면 버튼과 1:1 매칭.
        var hint = el("div", "org-reorder-hint");
        hint.appendChild(icon("chevron", "chev-up"));
        hint.appendChild(icon("chevron", "chev-down"));
        hint.appendChild(el("span", null, " 로 같은 부서 안에서 순서를 바꾸고, "));
        hint.appendChild(icon("building"));
        hint.appendChild(el("span", null, " 버튼으로 다른 부서로 옮깁니다."));
        container.appendChild(hint);
      }

      // 트리 시맨틱 컨테이너: role=tree + roving tabindex + 화살표키 내비게이션
      var treeEl = el("div", "org-tree");
      treeEl.setAttribute("role", "tree");
      treeEl.setAttribute("aria-label", "조직도");
      // reorder 시 멤버 행 액션 간격을 넓혀(▲▼/🏢) 오터치를 줄인다(트리에 스코프 → 타 탭 누수 방지)
      if (opts.reorder) treeEl.classList.add("org-reordering");
      tree.forEach(function (n) { treeEl.appendChild(orgNode(n, 0, opts)); });

      function items() {
        return Array.prototype.slice.call(treeEl.querySelectorAll('[role="treeitem"]'));
      }
      function focusItem(it) { if (it) it.focus(); }
      // 어떤 경로(Tab·클릭·토글 후 포커스 복원)로 진입하든 포커스된 노드를 유일한 탭 정지점으로
      treeEl.addEventListener("focusin", function (e) {
        var cur = e.target.closest && e.target.closest('[role="treeitem"]');
        if (!cur) return;
        items().forEach(function (it) { it.tabIndex = it === cur ? 0 : -1; });
      });
      treeEl.addEventListener("keydown", function (e) {
        var cur = e.target.closest && e.target.closest('[role="treeitem"]');
        if (!cur) return;
        var list = items(), i = list.indexOf(cur);
        switch (e.key) {
          case "ArrowDown": e.preventDefault(); focusItem(list[i + 1]); break;
          case "ArrowUp": e.preventDefault(); focusItem(list[i - 1]); break;
          case "Home": e.preventDefault(); focusItem(list[0]); break;
          case "End": e.preventDefault(); focusItem(list[list.length - 1]); break;
          case "ArrowRight": {
            e.preventDefault();
            if (cur.getAttribute("aria-expanded") === "false") { cur.click(); } // 펼침(재렌더 후 포커스 복원)
            else { // 이미 펼침 → 첫 자식 노드로
              var body = cur.nextElementSibling;
              focusItem(body && body.querySelector('[role="treeitem"]'));
            }
            break;
          }
          case "ArrowLeft": {
            e.preventDefault();
            if (cur.getAttribute("aria-expanded") === "true") { cur.click(); } // 접힘
            else { // 접힘/말단 → 부모 노드로
              var box = cur.parentElement && cur.parentElement.parentElement;
              if (box && box.classList.contains("org-body")) focusItem(box.previousElementSibling);
            }
            break;
          }
        }
      });
      container.appendChild(treeEl);
      // 최초 탭 정지점 1개 지정(나머지는 orgNode 에서 -1)
      var first = treeEl.querySelector('[role="treeitem"]');
      if (first) first.tabIndex = 0;
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
      var def = el("button", "ef-photo-btn"); def.id = "ef-photo-default"; def.type = "button"; def.textContent = "기본 아이콘";
      var rem = el("button", "ef-photo-btn ef-photo-rem"); rem.id = "ef-photo-remove"; rem.type = "button"; rem.textContent = "제거";
      pbtns.appendChild(pick); pbtns.appendChild(def); pbtns.appendChild(rem);
      photoRow.appendChild(pbtns);
      var fileInp = el("input"); fileInp.id = "ef-photo-file"; fileInp.type = "file"; fileInp.accept = "image/*"; fileInp.hidden = true;
      photoRow.appendChild(fileInp);
      form.appendChild(photoRow);

      form.appendChild(field("이름", textInput("ef-name", contact.name, "홍길동")));
      form.appendChild(field("직급", textInput("ef-grade", contact.grade, "주무관")));

      form.appendChild(pickerField("부서", "ef-dept-btn", "ef-dept",
        (contact.deptId != null ? String(contact.deptId) : "0"),
        deptLabel(contact.deptId, "(미지정)")));

      form.appendChild(field("직책", textInput("ef-position", contact.position, "팀장")));
      form.appendChild(field("담당업무", textInput("ef-work", contact.work, "채용")));
      form.appendChild(field("휴대전화", textInput("ef-phone", contact.phone, "010-0000-0000", "tel")));
      form.appendChild(field("행정번호", textInput("ef-tel", contact.tel, "02-000-0000", "tel")));
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

      var memoInp = el("textarea", "ef-input");
      memoInp.id = "ef-memo";
      memoInp.rows = 3;
      memoInp.placeholder = "개인 메모 (이 기기에만 저장 · 공유/CSV에는 포함 안 됨)";
      memoInp.style.resize = "vertical";
      memoInp.style.minHeight = "72px";
      if (contact.memo) memoInp.value = contact.memo;
      form.appendChild(field("메모", memoInp));

      container.appendChild(form);
    },

    /** 부서 관리 목록: 직제순 + 레벨 들여쓰기 트리(상위 접기/펼치기).
     *  ▲▼ 로 순서 변경, 각 행 탭 → onEdit. h: onEdit,onMove,onAddChild,onDelete,onToggle,collapsed */
    renderDeptManager: function (container, departments, counts, h) {
      container.textContent = "";
      if (!departments.length) {
        container.appendChild(UI.emptyState("부서가 없습니다. ‘부서 추가’로 만들어 보세요."));
        return;
      }
      var collapsed = h.collapsed || {};
      var byParent = {};
      departments.forEach(function (d) {
        var p = d.parentId || 0;
        (byParent[p] = byParent[p] || []).push(d);
      });
      var card = el("div", "info-card");
      var cutoff = null; // 접힌 상위의 depth — 이보다 깊은 후손 행은 숨김(pre-order 가정)
      departments.forEach(function (d) {
        var depth = Data.depthOf(d.id);
        if (cutoff != null && depth > cutoff) return;
        cutoff = null;
        var kids = !!(byParent[d.id] && byParent[d.id].length);
        var isCol = !!collapsed[d.id];
        var sibs = byParent[d.parentId || 0];
        var sidx = sibs.indexOf(d);

        var row = el("div", "deptmgr-row");
        row.style.paddingLeft = (8 + depth * 16) + "px";

        if (kids) {
          var tg = el("button", "deptmgr-toggle" + (isCol ? " is-collapsed" : ""));
          tg.type = "button";
          tg.setAttribute("aria-label", d.name + (isCol ? " 펼치기" : " 접기"));
          tg.setAttribute("aria-expanded", isCol ? "false" : "true");
          tg.appendChild(icon("chevron", "section-chevron"));
          tg.addEventListener("click", function (e) { e.stopPropagation(); h.onToggle(d.id); });
          row.appendChild(tg);
        } else {
          row.appendChild(el("span", "deptmgr-toggle-spacer"));
        }

        var main = el("button", "deptmgr-main");
        main.type = "button";
        var nm = el("div", "info-value");
        nm.appendChild(document.createTextNode(d.name));
        if (d._custom && window.Data && Data.hasBaseData()) nm.appendChild(el("span", "edit-chip edit-chip--inline", "추가"));
        main.appendChild(nm);
        var dc = (counts.direct[d.id] || 0), cc = (counts.child[d.id] || 0);
        var subTxt = "직속 " + dc + "명" + (cc ? " · 하위 " + cc + "개" : "");
        if (dc === 0 && cc === 0) subTxt += " · 빈 부서(조직도 미표시)";
        main.appendChild(el("div", "info-label", subTxt));
        main.addEventListener("click", function () { h.onEdit(d); });
        row.appendChild(main);

        var acts = el("div", "deptmgr-acts");
        if (h.onMove) {
          acts.appendChild(moveBtn("up", sidx <= 0, function () { h.onMove(d, -1); }));
          acts.appendChild(moveBtn("down", sidx < 0 || sidx >= sibs.length - 1, function () { h.onMove(d, 1); }));
        }
        var addc = el("button", "mini-btn mini-btn--ghost");
        addc.type = "button";
        addc.setAttribute("aria-label", d.name + " 하위 부서 추가");
        addc.appendChild(icon("plus"));
        addc.addEventListener("click", function () { h.onAddChild(d); });
        acts.appendChild(addc);
        if (h.onDelete) {
          var del = el("button", "mini-btn mini-btn--ghost deptmgr-del");
          del.type = "button";
          del.setAttribute("aria-label", d.name + " 삭제");
          del.appendChild(icon("trash"));
          del.addEventListener("click", function () { h.onDelete(d); });
          acts.appendChild(del);
        }
        row.appendChild(acts);
        card.appendChild(row);

        if (isCol && kids) cutoff = depth;
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

    /** 온보딩 빈 상태: 제목 + 안내 + 액션 버튼 여러 개.
     *  opts: { icon, title, msg, actions:[{label,onClick,primary}] } */
    onboarding: function (opts) {
      opts = opts || {};
      var wrap = el("div", "empty empty--onboarding");
      var ico = el("span", "empty-ico");
      ico.appendChild(icon(opts.icon || "contacts"));
      wrap.appendChild(ico);
      if (opts.title) wrap.appendChild(el("div", "empty-title", opts.title));
      if (opts.msg) wrap.appendChild(el("div", "empty-msg", opts.msg));
      var actions = opts.actions || [];
      if (actions.length) {
        var row = el("div", "empty-actions");
        actions.forEach(function (a) {
          var b = el("button", "empty-action" + (a.primary ? " empty-action--primary" : ""), a.label);
          b.type = "button";
          b.addEventListener("click", a.onClick);
          row.appendChild(b);
        });
        wrap.appendChild(row);
      }
      return wrap;
    },

    /** 상세 본문 */
    renderDetail: function (container, contact, opts) {
      opts = opts || {};
      container.textContent = "";

      var hero = el("div", "detail-hero");
      var av = makeAvatar(contact, ""); // 아바타는 썸네일(동기)
      var hasPhoto = !!(window.Photos && (Photos.has ? Photos.has(contact.id) : (Photos.get && Photos.get(contact.id))));
      if (hasPhoto && opts.onPhoto) {
        av.setAttribute("role", "button");
        av.tabIndex = 0;
        av.setAttribute("aria-label", "사진 크게 보기");
        av.style.cursor = "zoom-in";
        // 원본(full)은 뷰어 열 때 지연 로드(getFull 은 Promise). 동기 반환(레거시)도 호환.
        var openFull = function () {
          var thumb = (window.Photos && Photos.get) ? Photos.get(contact.id) : null;
          if (window.Photos && Photos.getFull) {
            var r = Photos.getFull(contact.id);
            if (r && typeof r.then === "function") r.then(function (url) { opts.onPhoto(url || thumb, contact.name); });
            else opts.onPhoto(r || thumb, contact.name);
          } else opts.onPhoto(thumb, contact.name);
        };
        av.addEventListener("click", openFull);
        av.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFull(); } });
      }
      hero.appendChild(av);
      hero.appendChild(el("h2", "detail-name", contact.name || ""));
      var roleParts = [contact.position, contact.dept].filter(Boolean);
      if (roleParts.length) hero.appendChild(el("p", "detail-role", roleParts.join(" · ")));
      var chips = el("div", "detail-chips");
      var sb = statusBadge(contact.status);
      if (sb) chips.appendChild(sb);
      // 번들 명부가 있을 때만 '추가/수정' 구분이 의미. 없으면(전부 사용자 데이터) 숨김.
      if (window.Data && Data.hasBaseData()) {
        if (contact._custom) chips.appendChild(el("span", "edit-chip", "추가한 연락처"));
        else if (contact._edited) chips.appendChild(el("span", "edit-chip", "수정됨"));
      }
      if (chips.childNodes.length) hero.appendChild(chips);
      container.appendChild(hero);

      var qa = el("div", "quick-actions");
      qa.appendChild(quickComm("phone", "전화", contact.phone ? "tel:" + clean(contact.phone) : null, "전화 걸기"));
      qa.appendChild(quickComm("message", "문자", contact.phone ? "sms:" + clean(contact.phone) : null, "문자 보내기"));
      qa.appendChild(quickComm("building", "행정전화", contact.tel ? "tel:" + clean(contact.tel) : null, "행정번호로 전화"));
      qa.appendChild(quickBtn("share", "공유", function () { shareContact(contact); }, "연락처 공유", true));
      qa.appendChild(quickBtn("download", "저장", function () { downloadVCard(contact); }, "연락처 파일로 저장", true));
      container.appendChild(qa);

      // 연락처 섹션
      var c1 = el("div", "info-card");
      addPhoneRow(c1, "mobile", "휴대전화", contact.phone);
      addPhoneRow(c1, "building", "행정번호", contact.tel);
      deptReps(contact).forEach(function (r) {
        var who = (r.position ? r.position + " " : "") + r.name;
        addPhoneRow(c1, "users", r.deptName + " 대표(" + who + ")", r.tel);
      });
      addInfo(c1, "cake", "생년월일", contact.birth);
      if (c1.childNodes.length) {
        container.appendChild(sectionTitle("연락처"));
        container.appendChild(c1);
      }

      // 소속 섹션
      var c2 = el("div", "info-card");
      addOrgRow(c2, contact, opts.onOrg);
      addInfo(c2, "badge", "직급", contact.grade);
      addInfo(c2, "work", "담당업무", contact.work);
      addInfo(c2, "status", "재직상태", contact.status && contact.status !== "미설정" ? contact.status : null);
      if (c2.childNodes.length) {
        container.appendChild(sectionTitle("소속"));
        container.appendChild(c2);
      }

      // 메모(개인·로컬) — 여러 줄 보존
      if (contact.memo) {
        container.appendChild(sectionTitle("메모"));
        var cm = el("div", "info-card");
        var mrow = el("div", "info-row");
        var mico = el("span", "info-ico"); mico.appendChild(icon("edit")); mrow.appendChild(mico);
        var mtext = el("div", "info-text");
        var mval = el("div", "info-value");
        mval.style.whiteSpace = "pre-wrap"; // 줄바꿈 유지
        mval.textContent = contact.memo;
        mtext.appendChild(mval);
        mrow.appendChild(mtext);
        cm.appendChild(mrow);
        container.appendChild(cm);
      }
    },
  };

  function sectionTitle(text) { return el("div", "info-section-title", text); }

  // 통신 quick(전화/문자/행정): 값 없으면 disabled 버튼(접근 가능·시각적 비활성)
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

  /** 본인 부서에서 상위로 올라가며 각 조직 단위 리더(장)의 행정번호를 수집.
   *  팀 → 과 → 국 순(가까운 단위 먼저). 본인 제외, 같은 번호는 중복 제거.
   *  각 항목을 단위명·직책으로 라벨링해 '팀장을 부서 대표로 오인'하는 문제를 없앤다.
   *  반환: [{ deptName, name, position, tel }] */
  function deptReps(contact) {
    if (!(window.Data && Data.membersOfDept && Data.deptPath)) return [];
    var path = Data.deptPath(contact.deptId); // [최상위 … 본인부서]
    var out = [], seenTel = {};
    for (var i = path.length - 1; i >= 0; i--) { // 본인부서(가까운 단위)부터 상위로
      var dept = path[i];
      var mem = Data.membersOfDept(dept.id);
      for (var j = 0; j < mem.length; j++) {
        var m = mem[j];
        if (m.id === contact.id || !isLead(m) || !m.tel) continue;
        var key = clean(m.tel);
        if (seenTel[key]) break;          // 상위와 동일 번호면 이 단위는 건너뜀
        seenTel[key] = true;
        out.push({ deptName: dept.name, name: m.name, position: m.position || "", tel: m.tel });
        break;                            // 단위별 리더 1명
      }
    }
    return out;
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
