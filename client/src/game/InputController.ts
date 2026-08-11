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

export class InputController {
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (e) => this.pressed.add(e.code));
    window.addEventListener("keyup", (e) => this.pressed.delete(e.code));
    window.addEventListener("blur", () => this.pressed.clear());
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
