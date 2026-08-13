const KEY_TO_AXIS: Record<string, [x: number, z: number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function isTypingTarget(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

export class InputController {
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (isTypingTarget()) return;
      this.pressed.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      if (isTypingTarget()) return;
      this.pressed.delete(e.code);
    });
    window.addEventListener("blur", () => this.pressed.clear());
    // Focusing a text field mid-keypress (e.g. pressing Enter to open chat while still holding
    // W) must not leave that key stuck "pressed" forever, since keyup will now be swallowed too.
    window.addEventListener("focusin", () => {
      if (isTypingTarget()) this.pressed.clear();
    });
  }

  getMovement(): { moveX: number; moveZ: number } {
    let x = 0;
    let z = 0;
    for (const code of this.pressed) {
      const axis = KEY_TO_AXIS[code];
      if (!axis) continue;
      x += axis[0];
      z += axis[1];
    }

    const length = Math.hypot(x, z);
    if (length === 0) return { moveX: 0, moveZ: 0 };
    return { moveX: x / length, moveZ: z / length };
  }
}
