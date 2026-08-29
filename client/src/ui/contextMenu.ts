const contextMenuEl = document.getElementById("context-menu")!;
const contextMenuListEl = document.getElementById("context-menu-list")!;

export interface ContextMenuAction {
  label: string;
  onClick: () => void;
}

export function closeContextMenu() {
  contextMenuEl.hidden = true;
  contextMenuListEl.innerHTML = "";
}

export function openContextMenu(x: number, y: number, actions: ContextMenuAction[]) {
  contextMenuListEl.innerHTML = "";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      closeContextMenu();
    });
    contextMenuListEl.appendChild(btn);
  }

  contextMenuEl.hidden = false;
  const maxLeft = window.innerWidth - contextMenuEl.offsetWidth - 8;
  const maxTop = window.innerHeight - contextMenuEl.offsetHeight - 8;
  contextMenuEl.style.left = `${Math.min(x, Math.max(8, maxLeft))}px`;
  contextMenuEl.style.top = `${Math.min(y, Math.max(8, maxTop))}px`;
}

// A regular left-click anywhere outside the menu dismisses it - a separate event from the
// right-click that opens it, so this never races with openContextMenu.
document.addEventListener("click", (event) => {
  if (!contextMenuEl.hidden && !contextMenuEl.contains(event.target as Node)) closeContextMenu();
});
