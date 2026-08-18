const STORAGE_PREFIX = "mmo:panel:";

interface StoredPosition {
  left: number;
  top: number;
}

// Panels keep their CSS-authored default position (including the hotbar's centering
// transform) until the user actually drags or has a saved position — that way we
// never need to measure a possibly-hidden element's layout (e.g. the target panel
// starts `hidden` and has no meaningful bounding rect until it's first shown).
// Pins a panel by its top-left corner only. Some panels are authored with a CSS
// `bottom` (e.g. the hotbar, originally bottom-anchored) — leaving that in place
// while also setting an inline `top` would give the element both constraints at
// once, which stretches its height instead of moving it. Clearing `bottom`/`right`
// here keeps `left`/`top` as the single source of truth once a panel goes dynamic.
function pinToTopLeft(panel: HTMLElement, left: number, top: number) {
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.bottom = "auto";
  panel.style.right = "auto";
  panel.style.transform = "none";
}

export function makeDraggable(panel: HTMLElement, key: string) {
  const lockBtn = panel.querySelector<HTMLElement>("[data-lock]");
  const lockKey = `${STORAGE_PREFIX}${key}:locked`;
  const posKey = `${STORAGE_PREFIX}${key}:pos`;

  let locked = localStorage.getItem(lockKey) === "1";

  const savedPos = localStorage.getItem(posKey);
  if (savedPos) {
    try {
      const pos: StoredPosition = JSON.parse(savedPos);
      pinToTopLeft(panel, pos.left, pos.top);
    } catch {
      // ignore malformed storage, fall back to CSS default
    }
  }

  function applyLockVisual() {
    panel.classList.toggle("locked", locked);
    if (lockBtn) lockBtn.textContent = locked ? "🔒" : "🔓";
  }
  applyLockVisual();

  lockBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    locked = !locked;
    localStorage.setItem(lockKey, locked ? "1" : "0");
    applyLockVisual();
  });

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  panel.addEventListener("mousedown", (event) => {
    if (locked) return;
    if ((event.target as HTMLElement).closest("[data-lock], [data-no-drag]")) return;

    const rect = panel.getBoundingClientRect();
    pinToTopLeft(panel, rect.left, rect.top);

    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    panel.classList.add("dragging");
    event.preventDefault();
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) return;

    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
    const newLeft = Math.min(Math.max(0, startLeft + (event.clientX - startX)), maxLeft);
    const newTop = Math.min(Math.max(0, startTop + (event.clientY - startY)), maxTop);

    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("dragging");

    const pos: StoredPosition = { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) };
    localStorage.setItem(posKey, JSON.stringify(pos));
  });
}

interface StoredSize {
  width: number;
  height: number;
}

// A custom resize handle instead of CSS `resize: both`: the native handle renders inside the
// panel's own border-box corner, which sits underneath makeDraggable's mousedown listener with
// no distinct element to exclude it by - mousedown there was being claimed as a drag (moving the
// panel) before the browser's own resize gesture ever got a chance to start. A real element with
// its own `data-no-drag` sidesteps that ambiguity entirely, and gives explicit min/max control.
export function makeResizable(
  panel: HTMLElement,
  handle: HTMLElement,
  key: string,
  minWidth: number,
  minHeight: number,
) {
  const sizeKey = `${STORAGE_PREFIX}${key}:size`;

  const savedSize = localStorage.getItem(sizeKey);
  if (savedSize) {
    try {
      const size: StoredSize = JSON.parse(savedSize);
      panel.style.width = `${size.width}px`;
      panel.style.height = `${size.height}px`;
    } catch {
      // ignore malformed storage, fall back to CSS default
    }
  }

  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  handle.addEventListener("mousedown", (event) => {
    const rect = panel.getBoundingClientRect();
    resizing = true;
    startX = event.clientX;
    startY = event.clientY;
    startWidth = rect.width;
    startHeight = rect.height;
    panel.classList.add("resizing");
    event.preventDefault();
    event.stopPropagation(); // don't also let makeDraggable's own listener treat this as a drag
  });

  window.addEventListener("mousemove", (event) => {
    if (!resizing) return;

    const maxWidth = window.innerWidth - panel.getBoundingClientRect().left;
    const maxHeight = window.innerHeight - panel.getBoundingClientRect().top;
    const newWidth = Math.min(Math.max(minWidth, startWidth + (event.clientX - startX)), maxWidth);
    const newHeight = Math.min(Math.max(minHeight, startHeight + (event.clientY - startY)), maxHeight);

    panel.style.width = `${newWidth}px`;
    panel.style.height = `${newHeight}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!resizing) return;
    resizing = false;
    panel.classList.remove("resizing");

    const size: StoredSize = { width: parseFloat(panel.style.width), height: parseFloat(panel.style.height) };
    localStorage.setItem(sizeKey, JSON.stringify(size));
  });
}
