import { clamp } from "./land.mjs";

const KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight",
  "ShiftLeft", "ShiftRight", "Space", "KeyR", "KeyE", "Enter", "KeyF", "KeyQ", "KeyV",
]);
const START_PITCH = 0.32;
const DEADZONE = 0.10;
const ACTIONS = { Space: "jump", TouchJump: "jump", KeyE: "interact", Enter: "interact", KeyF: "attack", KeyQ: "dodge" };

export function createControls(canvas, { stick, jump, interact, attack, dodge }, onReset, onCenter) {
  const keys = new Set();
  const queue = [];
  let drag = null, touch = null, stickSprinting = false;
  let stickX = 0, stickZ = 0, currentX = 0, currentZ = 0, currentSprint = false;
  const camera = { yaw: 0, pitch: START_PITCH };

  function clearStick() {
    touch = null;
    stickX = stickZ = 0;
    stickSprinting = false;
    stick.style.removeProperty("--stick-x");
    stick.style.removeProperty("--stick-y");
  }
  function clearInput() {
    keys.clear();
    if (touch && stick.hasPointerCapture(touch.id)) stick.releasePointerCapture(touch.id);
    clearStick();
    if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
    queue.length = 0;
    currentX = currentZ = 0;
    currentSprint = false;
  }
  window.addEventListener("blur", clearInput);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearInput(); });
  window.addEventListener("keydown", (event) => {
    if (!KEYS.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.code === "Space" || event.code === "Enter") && event.target.closest?.("button, a")) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === "KeyR") onReset();
    else if (event.code === "KeyV") onCenter();
    else queue.push({ time: event.timeStamp, code: event.code, pressed: true });
  });
  window.addEventListener("keyup", (event) => {
    if (KEYS.has(event.code)) queue.push({ time: event.timeStamp, code: event.code, pressed: false });
  });
  jump.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    jump.setPointerCapture(event.pointerId);
    queue.push({ time: event.timeStamp, code: "TouchJump", pressed: true });
  });
  jump.addEventListener("lostpointercapture", event => {
    queue.push({ time: event.timeStamp, code: "TouchJump", pressed: false });
  });
  jump.addEventListener("click", event => {
    if (event.detail === 0) queue.push({ time: event.timeStamp, action: "jump" });
  });
  for (const [action, button] of Object.entries({ interact, attack, dodge })) {
    button.addEventListener("click", event => queue.push({ time: event.timeStamp, action }));
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (drag || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    camera.yaw -= (event.clientX - drag.x) * 0.006;
    camera.pitch = clamp(camera.pitch + (event.clientY - drag.y) * 0.005, 0.10, 0.94);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  canvas.addEventListener("lostpointercapture", (event) => {
    if (drag?.id === event.pointerId) drag = null;
  });

  function moveStick(event) {
    const x = (event.clientX - touch.x) / 35, z = (event.clientY - touch.y) / 35;
    const scale = Math.max(1, Math.hypot(x, z));
    stickX = x / scale;
    stickZ = z / scale;
    const magnitude = Math.hypot(stickX, stickZ);
    stickSprinting = stickSprinting ? magnitude > 0.80 : magnitude >= 0.87;
    queue.push({ time: event.timeStamp, x: stickX, z: stickZ, sprint: stickSprinting });
    stick.style.setProperty("--stick-x", `${stickX * 29}px`);
    stick.style.setProperty("--stick-y", `${stickZ * 29}px`);
  }
  stick.addEventListener("pointerdown", (event) => {
    if (touch || event.button !== 0) return;
    const bounds = stick.getBoundingClientRect();
    touch = { id: event.pointerId, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    stick.setPointerCapture(event.pointerId);
    moveStick(event);
  });
  stick.addEventListener("pointermove", (event) => {
    if (touch?.id === event.pointerId) moveStick(event);
  });
  stick.addEventListener("lostpointercapture", (event) => {
    if (touch?.id !== event.pointerId) return;
    clearStick();
    queue.push({ time: event.timeStamp, x: 0, z: 0, sprint: false });
  });

  function center(heading) {
    camera.yaw = heading + Math.PI;
  }
  return {
    camera,
    center,
    resetCamera(heading) {
      clearInput();
      camera.pitch = START_PITCH;
      center(heading);
    },
    sample(time) {
      const tapped = new Set();
      const actions = { jump: false, interact: false, attack: false, dodge: false };
      while (queue.length && queue[0].time <= time + 1e-5) {
        const event = queue.shift();
        if (event.action) actions[event.action] = true;
        else if (event.code) {
          if (event.pressed) {
            const action = ACTIONS[event.code];
            if (action) {
              actions[action] = true;
              if (action === "jump") keys.add(event.code);
            } else {
              keys.add(event.code);
              tapped.add(event.code);
            }
          } else keys.delete(event.code);
        } else {
          currentX = event.x;
          currentZ = event.z;
          currentSprint = event.sprint;
        }
      }
      const down = code => keys.has(code) || tapped.has(code);
      const held = (a, b) => Number(down(a) || down(b));
      const magnitude = Math.hypot(currentX, currentZ);
      const analog = magnitude > DEADZONE ? (magnitude - DEADZONE) / ((1 - DEADZONE) * magnitude) : 0;
      const x = currentX * analog + held("KeyD", "ArrowRight") - held("KeyA", "ArrowLeft");
      const z = currentZ * analog + held("KeyS", "ArrowDown") - held("KeyW", "ArrowUp");
      const length = Math.max(1, Math.hypot(x, z));
      const cos = Math.cos(camera.yaw), sin = Math.sin(camera.yaw);
      return {
        x: (x * cos + z * sin) / length,
        z: (z * cos - x * sin) / length,
        sprint: down("ShiftLeft") || down("ShiftRight") || currentSprint,
        jumpHeld: keys.has("Space") || keys.has("TouchJump"),
        ...actions,
      };
    },
  };
}
