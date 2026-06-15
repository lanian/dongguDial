/**
 * CSV / Excel(.xlsx) 파서 — 의존성 없음.
 * - CSV: 따옴표/줄바꿈/ BOM 처리
 * - XLSX: 브라우저 내장 DecompressionStream(deflate-raw)로 압축 해제 후 정규식으로 XML 파싱
 * 두 파서 모두 [{헤더: 값, ...}, ...] (첫 행을 헤더로) 형태를 반환한다.
 */
(function (global) {
  "use strict";

  function decodeEntities(s) {
    return String(s)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&amp;/g, "&");
  }

  function rowsToObjects(rows) {
    if (!rows.length) return [];
    var headers = (rows[0] || []).map(function (h) { return (h || "").trim(); });
    return rows.slice(1)
      .filter(function (r) { return r && r.some(function (c) { return (c || "").trim() !== ""; }); })
      .map(function (r) {
        var o = {};
        headers.forEach(function (h, i) { if (h) o[h] = (r[i] || "").toString().trim(); });
        return o;
      });
  }

  // ---------- CSV ----------
  function decodeText(buf) {
    var u = new Uint8Array(buf);
    var utf8 = new TextDecoder("utf-8", { fatal: false }).decode(u);
    if (utf8.indexOf("�") !== -1) {
      // UTF-8 깨짐 → 한글 Windows CSV(CP949/EUC-KR) 추정
      try { return new TextDecoder("euc-kr").decode(u); } catch (e) { return utf8; }
    }
    return utf8;
  }

  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    var rows = [], row = [], cur = "", q = false, i = 0;
    while (i < text.length) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ",") { row.push(cur); cur = ""; }
        else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (ch === "\r") { /* CRLF: skip */ }
        else cur += ch;
      }
      i++;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rowsToObjects(rows);
  }

  // ---------- XLSX ----------
  function colToIdx(ref) {
    var n = 0;
    for (var i = 0; i < ref.length; i++) n = n * 26 + (ref.charCodeAt(i) - 64);
    return n - 1;
  }

  function unzip(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("올바른 Excel(.xlsx) 파일이 아닙니다.");
    var count = dv.getUint16(eocd + 10, true);
    var off = dv.getUint32(eocd + 16, true);
    var entries = {}, p = off;
    for (var c = 0; c < count; c++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var localOff = dv.getUint32(p + 42, true);
      var name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      var lNameLen = dv.getUint16(localOff + 26, true);
      var lExtraLen = dv.getUint16(localOff + 28, true);
      var dataStart = localOff + 30 + lNameLen + lExtraLen;
      entries[name] = { method: method, data: bytes.subarray(dataStart, dataStart + compSize) };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error("이 브라우저는 .xlsx 해제를 지원하지 않습니다. CSV로 가져오세요."));
    }
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function parseSharedStrings(xml) {
    var out = [];
    if (!xml) return out;
    var re = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      var t = "", tm, tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      while ((tm = tre.exec(m[1]))) t += decodeEntities(tm[1]);
      out.push(t);
    }
    return out;
  }

  function parseSheet(xml, shared) {
    var rows = [], rm, rre = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    while ((rm = rre.exec(xml))) {
      var cells = [], cm, cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      while ((cm = cre.exec(rm[1]))) {
        var attrs = cm[1] || "", body = cm[2] || "";
        var refM = attrs.match(/r="([A-Z]+)\d+"/);
        var type = (attrs.match(/t="([^"]+)"/) || [])[1];
        var val = "";
        if (type === "s") {
          var vi = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          val = shared[parseInt(vi, 10)] || "";
        } else if (type === "inlineStr") {
          var im = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
          val = im ? decodeEntities(im[1]) : "";
        } else {
          var vm = body.match(/<v>([\s\S]*?)<\/v>/);
          val = vm ? decodeEntities(vm[1]) : "";
        }
        cells.push({ col: refM ? colToIdx(refM[1]) : cells.length, val: val });
      }
      var arr = [];
      cells.forEach(function (c) { arr[c.col] = c.val; });
      rows.push(arr);
    }
    return rowsToObjects(rows);
  }

  function parseXLSX(buf) {
    var bytes = new Uint8Array(buf);
    var entries;
    try { entries = unzip(bytes); } catch (e) { return Promise.reject(e); }
    function read(name) {
      var e = entries[name];
      if (!e) return Promise.resolve("");
      var raw = e.method === 8 ? inflateRaw(e.data) : Promise.resolve(e.data);
      return raw.then(function (u) { return new TextDecoder("utf-8").decode(u); });
    }
    var sheetName = Object.keys(entries)
      .filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
      .sort()[0];
    if (!sheetName) return Promise.reject(new Error("시트를 찾을 수 없습니다."));
    return read("xl/sharedStrings.xml").then(function (ssXml) {
      var shared = parseSharedStrings(ssXml);
      return read(sheetName).then(function (sheetXml) { return parseSheet(sheetXml, shared); });
    });
  }

  global.Importer = { parseCSV: parseCSV, parseXLSX: parseXLSX, decodeText: decodeText };
})(typeof window !== "undefined" ? window : globalThis);
