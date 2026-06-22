/**
 * 연락처 가져오기/내보내기 (CSV·XLSX 가져오기, CSV·vCard 내보내기).
 * app.js 에서 분리. ContactsIO.init(ctx) 로 컨트롤러 의존성을 주입받는다.
 *   ctx = { snack, dialog, render, refreshCounts, rebuildSuggest, dateStamp }
 * 전역 모듈(Data/Storage/Importer/Photos/UI)은 직접 사용. 모든 처리는 기기 로컬.
 */
(function (global) {
  "use strict";

  global.ContactsIO = {
    init: function (ctx) {
      var showSnack = ctx.snack;
      var appDialog = ctx.dialog;
      var render = ctx.render;
      var refreshCounts = ctx.refreshCounts;
      var rebuildSearchSuggest = ctx.rebuildSuggest;
      var dateStamp = ctx.dateStamp;

      // ---------- 연락처 CSV/Excel 가져오기 (로컬) ----------
      var importContactsFile = document.getElementById("import-contacts-file");
      var FIELD_ALIASES = {
        name: ["이름", "성명", "직원명", "name"],
        position: ["직책", "직위", "position"],
        grade: ["직급", "급수", "계급", "grade"],
        work: ["담당업무", "업무", "담당", "work"],
        phone: ["휴대전화", "휴대폰", "핸드폰", "휴대", "개인전화", "연락처", "hp", "mobile", "phone"],
        tel: ["행정번호", "사내번호", "내선", "내선번호", "사무실", "직통", "전화", "tel"],
        birth: ["생년월일", "생일", "출생", "birth"],
        status: ["재직상태", "상태", "재직", "status"],
      };
      // 조직 위계 열(상위 → 하위). 존재하는 열만 경로로 사용, 사람은 가장 말단(팀)에 배치
      var HIER_ALIASES = [
        ["상위부서", "상위조직", "상위", "국", "실", "본부"],   // 최상위(국/실/관)
        ["부서", "부서명", "소속", "과", "department"],          // 과
        ["팀", "팀명", "담당팀"],                                // 팀
      ];
      function norm(s) { return (s || "").toString().trim().toLowerCase().replace(/\s+/g, ""); }
      function buildFieldMap(headers) {
        var map = {};
        Object.keys(FIELD_ALIASES).forEach(function (field) {
          var aliases = FIELD_ALIASES[field].map(norm);
          var h = headers.find(function (hd) { return aliases.indexOf(norm(hd)) !== -1; });
          if (h) map[field] = h;
        });
        return map;
      }
      function normStatus(s) {
        s = (s || "").trim();
        var m = { "재직중": "재직", "휴직중": "휴직", "파견중": "파견", "교육중": "교육" };
        s = m[s] || s;
        return ["재직", "휴직", "파견", "교육"].indexOf(s) >= 0 ? s : "미설정";
      }
      function applyContactImport(rows) {
        var headers = Object.keys(rows[0] || {});
        var fmap = buildFieldMap(headers);
        if (!fmap.name) throw new Error("‘이름’ 열을 찾을 수 없습니다. 양식을 확인하세요.");
        // 위계 열(상위부서/부서/팀) 헤더 탐지
        var hierHeaders = HIER_ALIASES.map(function (aliases) {
          var a = aliases.map(norm);
          return headers.find(function (hd) { return a.indexOf(norm(hd)) !== -1; }) || null;
        });

        var pathCache = {}, sortCounter = 0, newDepts = 0;
        Data.getDepartments().forEach(function (d) {
          pathCache[(d.parentId || 0) + " " + d.name] = { id: d.id, level: d.level || 0 };
          if ((d.sortOrder || 0) > sortCounter) sortCounter = d.sortOrder || 0;
        });
        // 이름 경로(top→leaf)를 부서 체인으로 생성하고 말단 부서 반환
        function resolveDeptPath(names) {
          var parentId = 0, level = 0, leaf = { id: 0, name: "" };
          names.forEach(function (nm) {
            nm = (nm || "").trim();
            if (!nm) return;
            var key = parentId + " " + nm;
            var info = pathCache[key];
            if (!info) {
              sortCounter += 10;
              var id = Storage.addDept({ name: nm, parentId: parentId, level: level, sortOrder: sortCounter });
              info = { id: id, level: level };
              pathCache[key] = info;
              newDepts++;
            }
            parentId = info.id; level = info.level + 1;
            leaf = { id: info.id, name: nm };
          });
          return leaf;
        }
        function v(r, f) { return fmap[f] ? (r[fmap[f]] || "").trim() : ""; }
        function leafOf(r) { for (var i = hierHeaders.length - 1; i >= 0; i--) { var h = hierHeaders[i]; if (h && (r[h] || "").trim()) return r[h].trim(); } return ""; }
        function fieldsFromRow(r) {
          var leaf = resolveDeptPath(hierHeaders.map(function (h) { return h ? (r[h] || "").trim() : ""; }));
          return { name: v(r, "name"), deptId: leaf.id, dept: leaf.name, team: "",
            position: v(r, "position"), grade: v(r, "grade"), work: v(r, "work"),
            phone: v(r, "phone"), tel: v(r, "tel"), birth: v(r, "birth"), status: normStatus(v(r, "status")) };
        }
        var idx = buildContactMatchIndex();
        var added = 0, updated = 0, skipped = 0;
        rows.forEach(function (r) {
          var name = v(r, "name");
          if (!name) { skipped++; return; }
          var ph = digits(v(r, "phone")) || digits(v(r, "tel"));
          var m = matchExisting(idx, name, ph, leafOf(r));
          if (m) { Storage.saveContact(m.id, fieldsFromRow(r)); updated++; }  // 일치 → 갱신(중복 누적 방지)
          else { Storage.addContact(fieldsFromRow(r)); added++; }             // 신규 → 추가
        });
        return { added: added, updated: updated, skipped: skipped, newDepts: newDepts };
      }
      function digits(s) { return (s || "").replace(/\D/g, ""); }
      // 기존 연락처 색인: 이름+전화digits(우선) / 이름+부서leaf
      function buildContactMatchIndex() {
        var byNamePhone = {}, byNameDept = {};
        (window.Data && Data.getAllContacts ? Data.getAllContacts() : []).forEach(function (c) {
          var nm = (c.name || "").trim(); if (!nm) return;
          var ph = digits(c.phone) || digits(c.tel);
          if (ph.length >= 7) byNamePhone[nm + "|" + ph] = c;
          if (c.dept) byNameDept[nm + "|" + c.dept] = c;
        });
        return { byNamePhone: byNamePhone, byNameDept: byNameDept };
      }
      function matchExisting(idx, name, rowPhone, leaf) {
        if (rowPhone.length >= 7 && idx.byNamePhone[name + "|" + rowPhone]) return idx.byNamePhone[name + "|" + rowPhone];
        if (leaf && idx.byNameDept[name + "|" + leaf]) return idx.byNameDept[name + "|" + leaf];
        return null;
      }
      // 미리보기(dry-run, 변경 없음): 신규/갱신/건너뜀 건수
      function classifyImport(rows) {
        var headers = Object.keys(rows[0] || {});
        var fmap = buildFieldMap(headers);
        if (!fmap.name) throw new Error("'이름' 열을 찾을 수 없습니다. 양식을 확인하세요.");
        var hierHeaders = HIER_ALIASES.map(function (aliases) {
          var a = aliases.map(norm);
          return headers.find(function (hd) { return a.indexOf(norm(hd)) !== -1; }) || null;
        });
        function v(r, f) { return fmap[f] ? (r[fmap[f]] || "").trim() : ""; }
        function leafOf(r) { for (var i = hierHeaders.length - 1; i >= 0; i--) { var h = hierHeaders[i]; if (h && (r[h] || "").trim()) return r[h].trim(); } return ""; }
        var idx = buildContactMatchIndex();
        var news = 0, updates = 0, skipped = 0;
        rows.forEach(function (r) {
          var name = v(r, "name");
          if (!name) { skipped++; return; }
          var ph = digits(v(r, "phone")) || digits(v(r, "tel"));
          if (matchExisting(idx, name, ph, leafOf(r))) updates++; else news++;
        });
        return { news: news, updates: updates, skipped: skipped };
      }
      function runImport(rows) {
        var res;
        try { res = applyContactImport(rows); }
        catch (e) { showSnack("가져오기 실패: " + e.message); return; }
        Data.rebuild(); render(); refreshCounts(); rebuildSearchSuggest();
        showSnack((importMode === "replace" ? "대체 완료: " : "가져오기 완료: ") +
          "추가 " + res.added + "명" + (res.updated ? " · 갱신 " + res.updated + "명" : "") +
          (res.newDepts ? " · 신규 부서 " + res.newDepts + "개" : "") +
          (res.skipped ? " · 건너뜀 " + res.skipped + "건" : ""));
      }
      var importMode = "append"; // "append" | "replace"
      document.getElementById("import-contacts-btn").addEventListener("click", function () {
        importMode = "append";
        importContactsFile.value = "";
        importContactsFile.click();
      });
      document.getElementById("import-replace-btn").addEventListener("click", function () {
        importMode = "replace";
        importContactsFile.value = "";
        importContactsFile.click();
      });
      importContactsFile.addEventListener("change", function () {
        var file = importContactsFile.files && importContactsFile.files[0];
        if (!file) return;
        var isCSV = /\.csv$/i.test(file.name);
        var reader = new FileReader();
        reader.onload = function () {
          var parse;
          try {
            parse = isCSV
              ? Promise.resolve(Importer.parseCSV(Importer.decodeText(reader.result)))
              : Importer.parseXLSX(reader.result);
          } catch (e) { showSnack("가져오기 실패: " + e.message); return; }
          parse.then(function (rows) {
            if (!rows || !rows.length) { showSnack("가져올 행이 없습니다."); return; }
            if (importMode === "replace") {
              appDialog({ title: "연락처 가져오기", message: "초기화 후 가져오기: 기존 샘플·편집·추가·가져온 연락처와 부서를 모두 비우고 이 파일(" + rows.length + "건)만 남깁니다. 계속할까요?", okLabel: "대체", danger: true })
                .then(function (ok) {
                  if (!ok) return;
                  Storage.resetAllEdits(); if (window.Photos) Photos.clearAll(); Storage.setBaseHidden(true); Data.rebuild();
                  runImport(rows);
                });
              return;
            }
            // 추가 모드: 미리보기(신규/갱신/건너뜀) → 일치 항목은 갱신해 중복 누적 방지
            var cls;
            try { cls = classifyImport(rows); }
            catch (e) { showSnack("가져오기 실패: " + e.message); return; }
            var msg = "총 " + rows.length + "건\n· 신규 추가 " + cls.news + "명\n· 기존과 일치(갱신) " + cls.updates + "명"
              + (cls.skipped ? "\n· 이름 없음(건너뜀) " + cls.skipped + "건" : "")
              + "\n\n일치하는 연락처(이름+전화 또는 이름+부서)는 새 내용으로 갱신되어 중복으로 쌓이지 않습니다.";
            appDialog({ title: "가져오기 미리보기", message: msg, okLabel: "가져오기" })
              .then(function (ok) { if (ok) runImport(rows); });
          }).catch(function (e) { showSnack("가져오기 실패: " + e.message); });
        };
        reader.onerror = function () { showSnack("파일을 읽지 못했습니다."); };
        reader.readAsArrayBuffer(file); // CSV/XLSX 모두 ArrayBuffer로 읽어 인코딩 자동 판별
      });
      document.getElementById("import-template-btn").addEventListener("click", function () {
        var csv = "이름,상위부서,부서,팀,직책,직급,담당업무,휴대전화,행정번호,생년월일,재직상태\n" +
          "홍길동,행정복지국,자치행정과,총무팀,팀장,사무관,총무,010-1234-5678,062-608-0000,1980-01-01,재직\n" +
          "김영희,행정복지국,자치행정과,,과장,서기관,자치행정,010-2222-3333,062-608-0001,1978-05-05,재직\n";
        var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = "행정전화부-가져오기양식.csv";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      });

      // ---------- 연락처 CSV 내보내기 (가져오기 양식과 동일 열 → 재가져오기 호환) ----------
      function csvCell(v) {
        v = (v == null ? "" : String(v));
        // CSV 수식 인젝션 방어(CWE-1236): =,+,-,@,탭/CR 로 시작하면 앞에 ' 를 붙여 수식 실행 차단
        if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
        return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }
      // 조직 경로(top→leaf) 이름들을 [상위부서, 부서, 팀] 3열로 매핑.
      // 3단 이하: 앞에서부터 채움(양식 관례). 3단 초과: 가장 가까운 3단(상위2+말단).
      function hier3(names) {
        var p = (names || []).filter(Boolean);
        if (p.length <= 3) return [p[0] || "", p[1] || "", p[2] || ""];
        return [p[p.length - 3], p[p.length - 2], p[p.length - 1]];
      }
      // 조직도(직제) 순서 그대로 평탄화 — 가나다 정렬로 내보내면 재가져오기 시 부서가
      // 그 순서로 생성돼 조직 구조가 흐트러지므로, 화면 조직도와 동일 순서로 출력한다.
      function orgOrderedContacts() {
        var ordered = [];
        if (window.Data && Data.groupedByOrg) {
          (function flat(nodes) {
            nodes.forEach(function (n) {
              (n.members || []).forEach(function (m) { ordered.push(m); }); // 부모 직속 인원 먼저
              if (n.children && n.children.length) flat(n.children);        // 그 다음 하위 부서
            });
          })(Data.groupedByOrg());
        } else if (window.Data && Data.getAllContacts) {
          ordered = Data.getAllContacts();
        }
        return ordered;
      }
      function exportContactsCSV() {
        var ordered = orgOrderedContacts();
        if (!ordered.length) { showSnack("내보낼 연락처가 없습니다."); return; }
        var headers = ["이름", "상위부서", "부서", "팀", "직책", "직급", "담당업무", "휴대전화", "행정번호", "생년월일", "재직상태"];
        var lines = [headers.join(",")];
        ordered.forEach(function (c) {
          var path = (Data.deptPath ? Data.deptPath(c.deptId) : []).map(function (p) { return p.name; });
          var h3 = hier3(path), status = (c.status && c.status !== "미설정") ? c.status : "";
          lines.push([
            c.name || "", h3[0], h3[1], h3[2],
            c.position || "", c.grade || "", c.work || "",
            c.phone || "", c.tel || "", c.birth || "", status,
          ].map(csvCell).join(","));
        });
        var csv = "﻿" + lines.join("\r\n") + "\r\n"; // BOM(엑셀 한글) + CRLF
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = "행정전화부-연락처-" + dateStamp() + ".csv";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        showSnack(ordered.length + "건을 CSV로 내보냈습니다.");
      }
      document.getElementById("export-contacts-csv-btn").addEventListener("click", exportContactsCSV);

      // 연락처 vCard(.vcf) 일괄 내보내기 — 폰/Outlook 주소록에 바로 추가
      function exportContactsVCard() {
        var ordered = orgOrderedContacts();
        if (!ordered.length) { showSnack("내보낼 연락처가 없습니다."); return; }
        var n = UI.downloadVCards(ordered, "행정전화부-연락처-" + dateStamp() + ".vcf");
        showSnack(n + "건을 vCard로 내보냈습니다.");
      }
      var vcardBtn = document.getElementById("export-contacts-vcard-btn");
      if (vcardBtn) vcardBtn.addEventListener("click", exportContactsVCard);
    },
  };
})(window);
