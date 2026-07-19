// Dependency-free pointer-drag primitive shared by the selection drawer's swipe-to-close
// and drag-to-reorder gestures. Two activation modes:
//   - immediate (default): claimed once movement passes `slop` with the dominant axis
//     matching `axis`, so a wrong-axis move is released back to the browser and taps stay taps.
//   - long-press (`holdDelay` > 0): claimed after the pointer is held roughly still for
//     `holdDelay` ms. Any movement past `holdSlop` before then aborts the gesture, so a quick
//     drag still scrolls and a tap still clicks — only a deliberate press-and-hold reorders.
//     `holdDelay` may be a function of the pointerdown event (e.g. 0 for mouse, 320 for touch).
//
// Move/up/cancel listeners live on `window`, not the element: real touch relies on pointer
// capture, but the E2E suite dispatches synthetic events whose untrusted pointerId makes
// setPointerCapture throw — the window listeners are what actually carries the drag there.
//
// Handlers (all optional except the caller usually wants onEnd):
//   shouldStart(event) -> boolean   gate a gesture at pointerdown
//   onClaim({ event, startEvent })  the drag activated (crossed slop, or the hold elapsed)
//   onMove({ dx, dy, event, startEvent })   per-move delta from the start point (claimed only)
//   onEnd({ dx, dy, vx, vy, cancelled, event, startEvent })   drop or cancel (claimed only)
//   onPassthrough({ dx, dy, event, startEvent })   long-press mode only: moves after the hold
//     was aborted by movement. Because a long-press drag source must set `touch-action: none`
//     (or the browser claims the pan and cancels the pointer mid-drag), the browser no longer
//     scrolls for it — this hook lets the caller drive that scroll. Omit it to simply abort.
// `startEvent` is always the original pointerdown — use it (not `event`) to read the
// drag's origin element, since pointer capture retargets later events to `element`.
// Returns a detach() function.
export function attachPointerDrag(element, { axis, slop = 10, holdDelay = 0, holdSlop = 8, shouldStart, onClaim, onMove, onEnd, onPassthrough } = {}) {
  let active = false;
  let claimed = false;
  let passthrough = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startEvent = null;
  let samples = [];
  let holdTimer = 0;

  function now(event) {
    return event.timeStamp || (typeof performance !== "undefined" ? performance.now() : Date.now());
  }

  function clearHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  }

  function teardown() {
    active = false;
    claimed = false;
    passthrough = false;
    pointerId = null;
    startEvent = null;
    samples = [];
    clearHold();
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleCancel);
  }

  function claim() {
    claimed = true;
    try { element.setPointerCapture(pointerId); } catch { /* synthetic/absent pointer */ }
    onClaim?.({ event: startEvent, startEvent });
  }

  function handleDown(event) {
    if (active) return;
    if (shouldStart && !shouldStart(event)) return;
    active = true;
    claimed = false;
    pointerId = event.pointerId ?? null;
    startX = event.clientX;
    startY = event.clientY;
    startEvent = event;
    samples = [{ t: now(event), x: startX, y: startY }];
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    const delay = typeof holdDelay === "function" ? holdDelay(event) : holdDelay;
    if (delay > 0) holdTimer = setTimeout(() => { holdTimer = 0; if (active && !claimed) claim(); }, delay);
  }

  function matches(event) {
    return active && (pointerId === null || event.pointerId === pointerId);
  }

  function handleMove(event) {
    if (!matches(event)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    samples.push({ t: now(event), x: event.clientX, y: event.clientY });
    if (samples.length > 6) samples.shift();

    if (!claimed) {
      if (passthrough) { onPassthrough({ dx, dy, event, startEvent }); return; }
      if (holdTimer) {
        // Long-press pending: real movement means the user is scrolling or tapping, not
        // holding to reorder. Hand the rest of the gesture to onPassthrough (the drag source
        // sets touch-action:none, so the browser won't scroll it for us), or just abort.
        if (Math.hypot(dx, dy) <= holdSlop) return;
        clearHold();
        if (!onPassthrough) { teardown(); return; }
        passthrough = true;
        onPassthrough({ dx, dy, event, startEvent });
        return;
      }
      // Immediate activation: claim once past slop on the right axis.
      if (Math.hypot(dx, dy) < slop) return;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal !== (axis === "x")) { teardown(); return; } // wrong axis: hand back to the browser
      claim();
    }
    if (event.cancelable) event.preventDefault();
    onMove?.({ dx, dy, event, startEvent });
  }

  function velocity() {
    if (samples.length < 2) return { vx: 0, vy: 0 };
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t || 1;
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }

  function handleUp(event) {
    if (!matches(event)) return;
    const wasClaimed = claimed;
    const origin = startEvent;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const { vx, vy } = velocity();
    teardown();
    if (wasClaimed) onEnd?.({ dx, dy, vx, vy, cancelled: false, event, startEvent: origin });
  }

  function handleCancel(event) {
    if (!matches(event)) return;
    const wasClaimed = claimed;
    const origin = startEvent;
    teardown();
    if (wasClaimed) onEnd?.({ dx: 0, dy: 0, vx: 0, vy: 0, cancelled: true, event, startEvent: origin });
  }

  element.addEventListener("pointerdown", handleDown);
  return function detach() {
    teardown();
    element.removeEventListener("pointerdown", handleDown);
  };
}
