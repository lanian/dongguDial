/**
 * 백업 / 복구 (평문·암호화 내보내기, 가져오기·복원). app.js 에서 분리.
 * BackupIO.init(ctx) — ctx = { dialog, snack, render, refreshCounts, applyTheme, setThemeUI, dateStamp }
 * 전역 모듈(Storage/Data/Photos/BackupCrypto/UI)·crypto 는 직접 사용. 모든 처리는 기기 로컬.
 */
(function (global) {
  "use strict";

  global.BackupIO = {
    init: function (ctx) {
      var appDialog = ctx.dialog;
      var showSnack = ctx.snack;
      var render = ctx.render;
      var refreshCounts = ctx.refreshCounts;
      var applyTheme = ctx.applyTheme;
      var setThemeUI = ctx.setThemeUI;
      var dateStamp = ctx.dateStamp;
      var importFile = document.getElementById("import-file");

      // 사진(full 포함)은 IDB에서 비동기로 읽어 백업에 담는다. 반환: Promise<data>
      function buildBackupData() {
        var data = Storage.exportData();
        if (!(window.Photos && Photos.all)) return Promise.resolve(data);
        return Promise.resolve(Photos.all()).then(function (photos) { data.photos = photos; return data; });
      }
      // 평문 백업을 Blob 으로 스트리밍 조립한다. 사진을 IDB 커서로 한 건씩 흘려보내며 Blob 조각으로
      // 누적하므로, 전체 사진 맵 + 거대한 단일 JSON 문자열이 JS 힙에 동시 상주하지 않는다(모바일 OOM 완화).
      function buildBackupBlob() {
        var data = Storage.exportData(); // 사진 제외 본문
        if (!(window.Photos && Photos.streamAll)) {
          return Promise.resolve(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        }
        var head = JSON.stringify(data); // 항상 '}' 로 끝남
        var parts = [head.slice(0, -1), ',"photos":{'];
        var first = true;
        return Photos.streamAll(function (id, val) {
          parts.push((first ? "" : ",") + JSON.stringify(String(id)) + ":" + JSON.stringify(val));
          first = false;
        }).then(function () {
          parts.push("}}");
          return new Blob(parts, { type: "application/json" });
        });
      }
      function downloadJson(obj, filename) {
        UI.downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), filename);
      }

      // ---------- 내보내기 ----------
      document.getElementById("export-btn").addEventListener("click", function () {
        buildBackupBlob().then(function (blob) { UI.downloadBlob(blob, "행정전화부-백업-" + dateStamp() + ".json"); });
      });
      // 사진 제외 백업: 사진(IDB)을 빼고 본문(연락처·부서·즐겨찾기 등)만 — 파일이 가볍다.
      var exportNoPhotoBtn = document.getElementById("export-nophoto-btn");
      if (exportNoPhotoBtn) exportNoPhotoBtn.addEventListener("click", function () {
        UI.downloadBlob(new Blob([JSON.stringify(Storage.exportData(), null, 2)], { type: "application/json" }),
          "행정전화부-백업(사진제외)-" + dateStamp() + ".json");
        showSnack("사진 제외 백업을 내보냈습니다");
      });
      function exportBackupEncrypted() {
        if (!(window.crypto && crypto.subtle)) { showSnack("이 브라우저는 백업 암호화를 지원하지 않습니다"); return; }
        appDialog({ title: "백업 암호 설정", message: "이 암호로 백업 파일을 잠급니다.\n암호를 분실하면 복구할 수 없습니다.", value: "", placeholder: "암호 (8자 이상)", okLabel: "다음", inputType: "password", autocomplete: "off", maxLength: 64 }).then(function (p1) {
          if (!p1) return;
          if (p1.length < 8) { showSnack("암호는 8자 이상이어야 합니다"); return; }
          appDialog({ title: "백업 암호 확인", value: "", placeholder: "암호 다시 입력", okLabel: "내보내기", inputType: "password", autocomplete: "off", maxLength: 64 }).then(function (p2) {
            if (!p2) return;
            if (p2 !== p1) { showSnack("암호가 일치하지 않습니다"); return; }
            buildBackupData().then(function (data) { return BackupCrypto.encrypt(data, p1); })
              .then(function (env) { downloadJson(env, "행정전화부-백업(암호화)-" + dateStamp() + ".json"); showSnack("암호화 백업을 내보냈습니다"); })
              .catch(function (e) { showSnack("암호화 실패: " + e.message); });
          });
        });
      }
      var exportEncBtn = document.getElementById("export-enc-btn");
      if (exportEncBtn) exportEncBtn.addEventListener("click", exportBackupEncrypted);

      // ---------- 가져오기 / 복구 ----------
      var backupImportMode = "merge"; // "merge" | "replace"
      document.getElementById("import-btn").addEventListener("click", function () {
        backupImportMode = "merge";
        importFile.value = "";
        importFile.click();
      });
      document.getElementById("import-replace-backup-btn").addEventListener("click", function () {
        backupImportMode = "replace";
        importFile.value = "";
        importFile.click();
      });
      importFile.addEventListener("change", function () {
        var file = importFile.files && importFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var parsed;
          try { parsed = JSON.parse(String(reader.result)); }
          catch (e) { showSnack("가져오기 실패: " + e.message); return; }
          function continueImport(data) {
            function proceed() {
              var result;
              try {
                result = Storage.importData(data, backupImportMode);
                Data.rebuild();
                applyTheme(Storage.getTheme());
                setThemeUI(Storage.getTheme());
                refreshCounts();
                render();
              } catch (e) { showSnack("가져오기 실패: " + e.message); return; }
              var base = (backupImportMode === "replace" ? "대체 복구 완료: " : "복구 완료: ") +
                "즐겨찾기 " + result.favorites + ", 최근 " + result.recent +
                ", 편집 " + result.edits + ", 추가 " + result.custom;
              // 사진 복원은 비동기 → 완료(또는 실패)된 뒤에 재렌더·스낵바를 띄운다.
              if (!(window.Photos && (backupImportMode === "replace" || data.photos))) { showSnack(base); return; }
              Photos.importMap(data.photos || {}, backupImportMode === "replace")
                .then(function () { render(); showSnack(base); })
                .catch(function () { render(); showSnack(base + " (사진 일부 복원 실패)"); });
            }
            if (backupImportMode === "replace") {
              appDialog({ title: "초기화 후 복구", message: "기존 즐겨찾기·편집·추가·부서·사진을 모두 비우고 이 백업으로 대체합니다. 계속할까요?", okLabel: "대체", danger: true })
                .then(function (ok) { if (ok) proceed(); });
            } else proceed();
          }
          if (parsed && parsed.type === "backup-enc") {
            // 암호화 백업 → 암호 입력받아 복호화 후 진행
            if (!(window.crypto && crypto.subtle)) { showSnack("이 브라우저는 암호화 백업을 열 수 없습니다"); return; }
            appDialog({ title: "백업 암호 입력", message: "암호화된 백업입니다. 암호를 입력하세요.", value: "", placeholder: "암호", okLabel: "복호화", inputType: "password", autocomplete: "off", maxLength: 64 }).then(function (pass) {
              if (!pass) return;
              BackupCrypto.decrypt(parsed, pass).then(function (dec) {
                // 복호화는 성공했으나 내용이 백업 형식이 아니면 '암호 오류'와 구분해 안내
                if (!dec || dec.app !== "dongguDial" || dec.type !== "backup") {
                  showSnack("암호는 맞지만 백업 내용을 인식할 수 없습니다(파일 손상)."); return;
                }
                continueImport(dec);
              }).catch(function () { showSnack("암호가 올바르지 않거나 손상된 파일입니다."); });
            });
          } else {
            continueImport(parsed);
          }
        };
        reader.onerror = function () { showSnack("파일을 읽지 못했습니다."); };
        reader.readAsText(file);
      });
    },
  };
})(window);
