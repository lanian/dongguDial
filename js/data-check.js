/**
 * 데이터 점검 리포트(읽기 전용): 중복/형식/누락 등 다항목 점검.
 * app.js 에서 분리. DataCheck.init(ctx) — ctx = { dialog }. 전역 Data/UI 직접 사용.
 */
(function (global) {
  "use strict";

  global.DataCheck = {
    init: function (ctx) {
      var appDialog = ctx.dialog;
      function names(list, n) {
        return list.slice(0, n).map(function (c) { return c.name || "(이름없음)"; }).join(", ") + (list.length > n ? " …" : "");
      }
      function showDataCheck() {
        if (!(window.Data && Data.validateContacts)) return;
        var r = Data.validateContacts();
        var parts = [], problems = 0;
        // 연락/식별 핵심
        if (r.noName.length) { problems += r.noName.length; parts.push("● 이름 누락 " + r.noName.length + "명"); }
        if (r.noContact.length) {
          problems += r.noContact.length;
          parts.push("● 연락처 없음(휴대폰·행정번호 모두 없음) " + r.noContact.length + "명: " + names(r.noContact, 10));
        }
        if (r.badMobile.length) {
          problems += r.badMobile.length;
          parts.push("● 휴대폰 형식 이상(01x·10~11자리 아님) " + r.badMobile.length + "명: " +
            r.badMobile.slice(0, 8).map(function (c) { return c.name + "(" + (c.phone || "") + ")"; }).join(", ") + (r.badMobile.length > 8 ? " …" : ""));
        }
        if (r.dupContacts.length) {
          problems += r.dupContacts.length;
          parts.push("● 중복 의심(이름+전화 동일) " + r.dupContacts.length + "쌍: " +
            r.dupContacts.slice(0, 6).map(function (g) { return g[0].name; }).join(", ") + (r.dupContacts.length > 6 ? " …" : ""));
        }
        if (r.dupPhones.length) {
          problems += r.dupPhones.length;
          parts.push("● 같은 번호 공유 " + r.dupPhones.length + "건");
          r.dupPhones.slice(0, 6).forEach(function (d) {
            parts.push("   " + UI.formatPhone(d.phone) + " — " + d.people.map(function (c) { return c.name; }).join(", "));
          });
          if (r.dupPhones.length > 6) parts.push("   …외 " + (r.dupPhones.length - 6) + "건");
        }
        // 분류/형식
        if (r.orphans.length) {
          problems += r.orphans.length;
          parts.push("● 부서 미배정 " + r.orphans.length + "명: " + names(r.orphans, 10));
        }
        if (r.badBirth.length) {
          problems += r.badBirth.length;
          parts.push("● 생년월일 형식 오류 " + r.badBirth.length + "건(YYYY-MM-DD 아님): " +
            r.badBirth.slice(0, 8).map(function (c) { return c.name + "(" + c.birth + ")"; }).join(", ") + (r.badBirth.length > 8 ? " …" : ""));
        }
        if (r.emptyDepts.length) { problems += r.emptyDepts.length; parts.push("● 이름 없는 부서 " + r.emptyDepts.length + "개"); }
        // 참고(문제 아님)
        if (r.dupNames.length) {
          parts.push("〔참고〕 동명이인 " + r.dupNames.length + "건: " +
            r.dupNames.slice(0, 8).map(function (g) { return g.name + "(" + g.people.length + ")"; }).join(", ") + (r.dupNames.length > 8 ? " …" : ""));
        }
        var head = "총 " + r.total + "명 점검 · 문제 " + problems + "건\n\n";
        var msg = problems ? head + parts.join("\n")
          : "총 " + r.total + "명 점검 — 발견된 문제가 없습니다. 데이터가 깨끗합니다 👍"
            + (r.dupNames.length ? "\n\n" + parts.join("\n") : "");
        appDialog({ title: "데이터 점검", message: msg, okLabel: "확인", cancelLabel: "" });
      }
      var checkBtn = document.getElementById("data-check-btn");
      if (checkBtn) checkBtn.addEventListener("click", showDataCheck);
    },
  };
})(window);

