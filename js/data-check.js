/**
 * 데이터 점검 리포트(읽기 전용): 중복 전화·부서 미배정·생일형식·빈 부서명.
 * app.js 에서 분리. DataCheck.init(ctx) — ctx = { dialog }. 전역 Data/UI 직접 사용.
 */
(function (global) {
  "use strict";

  global.DataCheck = {
    init: function (ctx) {
      var appDialog = ctx.dialog;
      function showDataCheck() {
        if (!(window.Data && Data.validateContacts)) return;
        var r = Data.validateContacts();
        var parts = [];
        if (r.dupPhones.length) {
          parts.push("● 중복 전화 " + r.dupPhones.length + "건");
          r.dupPhones.slice(0, 8).forEach(function (d) {
            parts.push("   " + UI.formatPhone(d.phone) + " — " + d.people.map(function (c) { return c.name; }).join(", "));
          });
          if (r.dupPhones.length > 8) parts.push("   …외 " + (r.dupPhones.length - 8) + "건");
        }
        if (r.orphans.length) {
          parts.push("● 부서 미배정 " + r.orphans.length + "명: " +
            r.orphans.slice(0, 10).map(function (c) { return c.name; }).join(", ") + (r.orphans.length > 10 ? " …" : ""));
        }
        if (r.badBirth.length) {
          parts.push("● 생년월일 형식 오류 " + r.badBirth.length + "건(YYYY-MM-DD 아님): " +
            r.badBirth.slice(0, 10).map(function (c) { return c.name + "(" + c.birth + ")"; }).join(", ") + (r.badBirth.length > 10 ? " …" : ""));
        }
        if (r.emptyDepts.length) parts.push("● 이름 없는 부서 " + r.emptyDepts.length + "개");
        var msg = parts.length ? parts.join("\n") : "발견된 문제가 없습니다. 데이터가 깨끗합니다 👍";
        appDialog({ title: "데이터 점검", message: msg, okLabel: "확인", cancelLabel: "" });
      }
      var checkBtn = document.getElementById("data-check-btn");
      if (checkBtn) checkBtn.addEventListener("click", showDataCheck);
    },
  };
})(window);
