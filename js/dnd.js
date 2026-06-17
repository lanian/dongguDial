/* dnd.js — 포인터 기반 드래그 정렬 엔진 (마우스·터치 공용, 의존성 없음)
 *
 * 핸들(.dnd-handle)을 눌러 드래그를 시작하면 떠 있는 클론이 포인터를 따라가고,
 * 드롭 위치를 알리는 표시선을 그린다. "어디에 떨어지는가"의 계산은 소비자(consumer)가
 * onMove 콜백에서 결정한다 — 같은 부서 안 정렬, 부서 간 이동, 트리 들여쓰기(상위 변경)
 * 처럼 맥락마다 규칙이 다르기 때문이다.
 *
 *   DnD.attach(container, opts) → detach 함수
 *     opts.scrollEl            자동 스크롤 대상(생략 시 container)
 *     opts.onStart(itemEl)     드래그 시작 1회. 슬롯 등 사전계산 결과(ctx)를 반환
 *     opts.onMove(x,y,ctx,el)  포인터 이동마다. { rect:{left,top,width}, target } 또는 null 반환
 *                              rect = 표시선을 그릴 뷰포트 좌표, target = 드롭에 쓸 임의 식별자
 *     opts.onDrop(itemEl, target)  드롭(이동 발생) 시 1회. target 이 있을 때만 호출
 *
 * 핸들만 드래그를 시작하므로 터치 스크롤과 충돌하지 않는다(롱프레스 불필요).
 */
(function () {
  "use strict";

  function attach(container, opts) {
    var scrollEl = opts.scrollEl || container;
    var d = null; // 현재 드래그 상태

    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return; // 좌클릭/터치만
      var handle = e.target.closest && e.target.closest(".dnd-handle");
      if (!handle || !container.contains(handle)) return;
      var item = handle.closest("[data-dnd]");
      if (!item) return;
      e.preventDefault();
      start(item, handle, e);
    }

    function start(item, handle, e) {
      var rect = item.getBoundingClientRect();
      var ctx = opts.onStart ? opts.onStart(item) : null;

      var clone = item.cloneNode(true);
      clone.classList.add("dnd-clone");
      clone.style.width = rect.width + "px";
      document.body.appendChild(clone);

      var line = document.createElement("div");
      line.className = "dnd-indicator";
      line.style.display = "none";
      document.body.appendChild(line);

      item.classList.add("dnd-source");
      document.body.classList.add("dnd-active");

      d = {
        item: item, ctx: ctx, clone: clone, line: line, pointerId: e.pointerId,
        grabDX: e.clientX - rect.left, grabDY: e.clientY - rect.top,
        startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
        moved: false, target: null, raf: 0,
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}

      d.raf = requestAnimationFrame(tick); // 가장자리 자동 스크롤 루프
      paint(e.clientX, e.clientY);
    }

    function onMove(e) {
      if (!d) return;
      e.preventDefault();
      d.lastX = e.clientX; d.lastY = e.clientY;
      if (!d.moved && Math.abs(e.clientY - d.startY) + Math.abs(e.clientX - d.startX) > 4) d.moved = true;
      paint(e.clientX, e.clientY);
    }

    // 클론 위치 + 드롭 표시선 갱신
    function paint(x, y) {
      if (!d) return;
      d.clone.style.transform = "translate(" + (x - d.grabDX) + "px," + (y - d.grabDY) + "px)";
      var res = opts.onMove ? opts.onMove(x, y, d.ctx, d.item) : null;
      if (res && res.rect) {
        d.target = res.target;
        var r = res.rect;
        d.line.style.display = "block";
        d.line.style.transform = "translate(" + r.left + "px," + r.top + "px)";
        d.line.style.width = r.width + "px";
      } else {
        d.target = res && ("target" in res) ? res.target : null;
        d.line.style.display = "none";
      }
    }

    // 화면 가장자리 근처면 스크롤(드래그 중 긴 목록 이동)
    function tick() {
      if (!d) return;
      var r = scrollEl.getBoundingClientRect();
      var EDGE = 64, sp = 0;
      if (d.lastY < r.top + EDGE) sp = -Math.ceil((r.top + EDGE - d.lastY) / 5);
      else if (d.lastY > r.bottom - EDGE) sp = Math.ceil((d.lastY - (r.bottom - EDGE)) / 5);
      if (sp) {
        var before = scrollEl.scrollTop;
        scrollEl.scrollTop += sp;
        if (scrollEl.scrollTop !== before) paint(d.lastX, d.lastY);
      }
      d.raf = requestAnimationFrame(tick);
    }

    function finish(applyDrop) {
      if (!d) return;
      var item = d.item, target = d.target, moved = d.moved;
      cancelAnimationFrame(d.raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (d.clone.parentNode) d.clone.parentNode.removeChild(d.clone);
      if (d.line.parentNode) d.line.parentNode.removeChild(d.line);
      item.classList.remove("dnd-source");
      document.body.classList.remove("dnd-active");
      d = null;
      if (applyDrop && moved && target != null && opts.onDrop) opts.onDrop(item, target);
    }

    function onUp() { finish(true); }
    function onCancel() { finish(false); }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); finish(false); } }

    container.addEventListener("pointerdown", onPointerDown);
    return function detach() {
      container.removeEventListener("pointerdown", onPointerDown);
      finish(false);
    };
  }

  // 슬롯 배열에서 포인터 y 와 가장 가까운 슬롯 인덱스
  function nearestSlot(slots, y) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < slots.length; i++) {
      var dist = Math.abs(slots[i].y - y);
      if (dist < bestD) { bestD = dist; best = i; }
    }
    return best;
  }

  window.DnD = { attach: attach, nearestSlot: nearestSlot };
})();
