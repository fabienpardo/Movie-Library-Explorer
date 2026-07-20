// Touch/pointer gestures for the selection drawer, wired on top of attachPointerDrag:
//  - swipe right on empty panel space to close (the panel follows the finger, LTR app)
//  - drag a movie's title block to reorder the shortlist (press-and-hold on touch so quick
//    swipes still scroll and taps still expand; immediate drag with a mouse)
// A single module-level `activeGesture` guard keeps the two from running at once.
import { attachPointerDrag } from "./gestures.mjs";
import { els, state } from "./state.mjs";
import { closeSelectionPanel, moveSelectionItemTo, renderSelectionPanel } from "./selection.mjs";

const REORDER_HOLD_MS = 320;
let activeGesture = null; // "swipe" | "reorder" | null
// The title block doubles as the detail toggle, so a completed drag must not also fire its
// click. Set when a reorder is claimed and consumed by the capture-phase click guard below.
let suppressClick = false;

// Don't start a horizontal swipe from inside something that scrolls horizontally (e.g. a
// future wide detail card) — that content owns the horizontal axis.
function hasHorizontalScrollAncestor(target, panel) {
  let node = target;
  while (node && node !== panel) {
    if (node.scrollWidth > node.clientWidth + 1) return true;
    node = node.parentElement;
  }
  return false;
}

function attachSwipeToClose(panel) {
  attachPointerDrag(panel, {
    axis: "x",
    shouldStart(event) {
      if (activeGesture || !state.selectionPanelOpen) return false;
      // Mouse users already have the × button; a mouse-drag would fight text selection.
      if (event.pointerType === "mouse") return false;
      const target = event.target;
      if (!target || typeof target.closest !== "function") return false;
      if (target.closest("button, a, input, select, textarea")) return false;
      return !hasHorizontalScrollAncestor(target, panel);
    },
    onClaim() {
      activeGesture = "swipe";
      panel.classList.add("is-dragging"); // kill the slide transition so it tracks the finger
    },
    onMove({ dx }) {
      panel.style.transform = `translateX(${Math.max(0, dx)}px)`; // clamp ≥ 0: can't drag it left
    },
    onEnd({ dx, vx, cancelled }) {
      panel.classList.remove("is-dragging");
      panel.style.transform = "";
      activeGesture = null;
      if (cancelled) return;
      const width = panel.getBoundingClientRect().width || 1;
      // Commit on a long drag or a decisive flick; otherwise the transition snaps it back.
      if (dx > width * 0.45 || (vx > 0.5 && dx > 32)) closeSelectionPanel();
    }
  });
}

function autoScroll(panel, clientY) {
  const rect = panel.getBoundingClientRect();
  const edge = 48;
  if (clientY < rect.top + edge) panel.scrollTop -= 12;
  else if (clientY > rect.bottom - edge) panel.scrollTop += 12;
}

function attachReorder(panel) {
  let dragged = null;
  let list = null;
  let lastPassthroughY = null;

  attachPointerDrag(panel, {
    axis: "y",
    // Touch requires a deliberate press-and-hold; a mouse drags immediately (holding is awkward).
    holdDelay: event => (event.pointerType === "mouse" ? 0 : REORDER_HOLD_MS),
    shouldStart(event) {
      if (activeGesture || !state.selectionPanelOpen) return false;
      const target = event.target;
      if (!target || typeof target.closest !== "function") return false;
      if (!target.closest("[data-selection-move-id]")) return false;
      lastPassthroughY = null;
      return true;
    },
    // The title block sets touch-action:none (otherwise the browser claims the vertical pan
    // and fires pointercancel mid-drag, so a reorder could never complete on touch). That
    // also means it no longer scrolls natively, so a pre-hold drag scrolls the panel here.
    onPassthrough({ event, startEvent }) {
      const previous = lastPassthroughY === null ? startEvent.clientY : lastPassthroughY;
      panel.scrollTop -= event.clientY - previous;
      lastPassthroughY = event.clientY;
    },
    onClaim({ startEvent }) {
      activeGesture = "reorder";
      suppressClick = true; // this pointer ends in a drag, not a detail toggle
      // Use the pointerdown target (pointer capture retargets later events to the panel)
      // to read which item is being dragged before any re-render detaches it.
      const id = startEvent.target.closest("[data-selection-move-id]")?.dataset.selectionMoveId;
      // Collapse any expanded detail first: its .selection-detail div is a sibling of the
      // articles, so reordering article nodes would strand it against the wrong movie.
      if (state.selectionDetailId) { state.selectionDetailId = ""; renderSelectionPanel(); }
      const selector = id && typeof CSS !== "undefined" && CSS.escape ? `[data-selection-move-id="${CSS.escape(id)}"]` : null;
      const grip = selector ? panel.querySelector(selector) : null;
      dragged = grip ? grip.closest(".selection-item") : null;
      list = dragged ? dragged.closest(".selection-list") : null;
      dragged?.classList.add("is-dragging-item");
    },
    onMove({ event }) {
      if (!dragged || !list || !dragged.parentElement) return; // guard: a stray render dropped us
      autoScroll(panel, event.clientY);
      const siblings = [...list.querySelectorAll(".selection-item")].filter(item => item !== dragged);
      const before = siblings.find(item => {
        const rect = item.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
      });
      // Move the live node only; state stays put until drop, where one re-render reconciles.
      if (before) list.insertBefore(dragged, before);
      else list.appendChild(dragged);
    },
    onEnd() {
      const item = dragged;
      const container = list;
      item?.classList.remove("is-dragging-item");
      dragged = null;
      list = null;
      activeGesture = null;
      // The click that follows this pointer (if any) fires before this microtask-free reset,
      // so the capture guard swallows exactly one click; otherwise clear the flag next tick.
      setTimeout(() => { suppressClick = false; }, 0);
      if (!item || !container) { renderSelectionPanel(); return; }
      const id = item.querySelector("[data-selection-move-id]")?.dataset.selectionMoveId;
      if (!id) { renderSelectionPanel(); return; }
      // Commit on cancel too, not just on a clean drop: the browser can revoke the pointer
      // mid-drag (its own gesture recognizer, an incoming call), and by then the item has
      // already visibly moved. Snapping it back would throw away a reorder the user watched
      // happen; landing it where they last saw it is what they expect.
      const index = [...container.querySelectorAll(".selection-item")].indexOf(item);
      // Converge state + storage + DOM in a single re-render (no-op moves fall through fine).
      if (!moveSelectionItemTo(id, index)) renderSelectionPanel();
    }
  });
}

export function initSelectionGestures() {
  const panel = els.selectionPanel;
  if (!panel) return;
  // Capture phase, so a drag's trailing click is swallowed before the panel's click delegation
  // (which would otherwise toggle the dragged item's detail view).
  panel.addEventListener("click", event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  attachSwipeToClose(panel);
  attachReorder(panel);
}
