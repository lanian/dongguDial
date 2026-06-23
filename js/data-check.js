/**
 * 데이터 점검 리포트(액션 가능): 문제 연락처를 탭하면 해당 연락처 상세로 이동.
 * DataCheck.render(container, onOpen) — onOpen(contact) 콜백. 전역 Data/UI 직접 사용.
 */
(function (global) {
  "use strict";

  function elx(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  global.DataCheck = {
    render: function (container, onOpen) {
      container.textContent = "";
      if (!(window.Data && Data.validateContacts)) return;
      var r = Data.validateContacts();
      var problems = r.noName.length + r.noContact.length + r.badMobile.length + r.dupContacts.length +
        r.dupPhones.length + r.orphans.length + r.badBirth.length + r.emptyDepts.length;

      var summary = elx("div", "datacheck-summary");
      summary.appendChild(elx("span", "datacheck-summary-total", "총 " + r.total + "명 점검"));
      summary.appendChild(elx("span", "datacheck-summary-count" + (problems ? " is-bad" : " is-ok"),
        problems ? ("문제 " + problems + "건") : "문제 없음 👍"));
      container.appendChild(summary);

      // 연락처 1명 → 탭 시 상세 이동하는 행(이름 + 부서·사유로 식별 정보 강화)
      function row(c, reason) {
        var btn = elx("button", "datacheck-row");
        btn.type = "button";
        if (window.UI && UI.avatarColor) {
          var av = elx("span", "datacheck-avatar", (c.name || "?").trim().charAt(0) || "?");
          av.style.background = UI.avatarColor(c.name || "");
          btn.appendChild(av);
        }
        var t = elx("div", "datacheck-row-text");
        t.appendChild(elx("div", "datacheck-row-name", c.name || "(이름 없음)"));
        var bits = [];
        var dept = c._deptShort || c.dept;
        if (dept) bits.push(dept);
        if (reason) bits.push(reason);
        if (bits.length) t.appendChild(elx("div", "datacheck-row-sub", bits.join(" · ")));
        btn.appendChild(t);
        btn.appendChild(UI.icon ? UI.icon("chevron", "datacheck-chev") : elx("span"));
        btn.addEventListener("click", function () { if (onOpen) onOpen(c); });
        return btn;
      }
      // 연락처 문제 섹션(탭 가능). reasonFn(c) → 행별 사유 텍스트.
      function section(title, contacts, reasonFn) {
        if (!contacts.length) return;
        container.appendChild(elx("div", "datacheck-section-title", title + " " + contacts.length));
        var card = elx("div", "datacheck-card");
        contacts.slice(0, 100).forEach(function (c) { card.appendChild(row(c, reasonFn ? reasonFn(c) : "")); });
        if (contacts.length > 100) card.appendChild(elx("div", "datacheck-more", "…외 " + (contacts.length - 100) + "명"));
        container.appendChild(card);
      }
      // 그룹 문제(같은 번호·동명이인·중복) → 그룹마다 별도 카드(라벨 + 해당 인원)로 분리해 혼재 방지
      function groupSection(title, groups, labelFn) {
        if (!groups.length) return;
        container.appendChild(elx("div", "datacheck-section-title", title + " " + groups.length));
        groups.slice(0, 40).forEach(function (g) {
          var people = g.people || g; // {people:[...]} 또는 배열
          var card = elx("div", "datacheck-card datacheck-group");
          var label = labelFn ? labelFn(g) : "";
          if (label) card.appendChild(elx("div", "datacheck-group-label", label));
          people.forEach(function (c) { card.appendChild(row(c, "")); }); // 사유는 그룹 라벨이 대신
          container.appendChild(card);
        });
        if (groups.length > 40) container.appendChild(elx("div", "datacheck-more", "…외 " + (groups.length - 40) + "건"));
      }

      if (!problems && !r.dupNames.length) {
        container.appendChild(elx("div", "datacheck-clean", "발견된 문제가 없습니다. 데이터가 깨끗합니다 👍"));
        return;
      }
      // 핵심(연락/식별)
      section("이름 누락", r.noName);
      section("연락처 없음(휴대폰·행정번호 모두 없음)", r.noContact);
      section("휴대폰 형식 이상", r.badMobile, function (c) { return c.phone || ""; });
      groupSection("중복 의심(이름+전화 동일)", r.dupContacts, function (g) {
        return g[0].name + " · " + UI.formatPhone(g[0].phone || "");
      });
      groupSection("같은 번호 공유", r.dupPhones, function (g) { return UI.formatPhone(g.phone) + " 공유"; });
      // 분류/형식
      section("부서 미배정", r.orphans);
      section("생년월일 형식 오류", r.badBirth, function (c) { return c.birth || ""; });
      if (r.emptyDepts.length) container.appendChild(elx("div", "datacheck-section-title", "이름 없는 부서 " + r.emptyDepts.length + "개"));
      // 참고(문제 아님): 동명이인 — 그룹마다 같은 이름 인원을 부서와 함께 묶어 구분
      groupSection("〔참고〕 동명이인", r.dupNames, function (g) { return g.name + " · " + g.people.length + "명"; });
    },
  };
})(window);
