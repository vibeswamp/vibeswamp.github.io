import { clamp } from "./land.mjs";

const KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight",
  "ShiftLeft", "ShiftRight", "Space", "KeyR", "KeyE", "Enter", "KeyF", "KeyQ", "KeyV", "KeyI", "KeyG",
]);
const START_PITCH = 0.32;
// Phones look flatter from a little further back: horizon in the upper quarter, Klyop in the lower third.
const TOUCH_PITCH = 0.30;
// After a swipe the camera waits, then eases back behind Klyop: quickly while he runs, slowly while he stands,
// so a player who stopped to look at the sunset is not pulled away at once.
const FOLLOW_AFTER_MOVE = 0.9;
const FOLLOW_AFTER_IDLE = 3.2;
const FOLLOW_RATE = 2.1;
const PITCH_RETURN = 1.3;
const CENTER_RATE = 13;
const DEADZONE = 0.10;
const ACTIONS = { Space: "jump", TouchJump: "jump", KeyE: "interact", Enter: "interact", KeyF: "attack", KeyQ: "dodge",
  KeyI: "inventory", KeyG: "focus" };
// With a target held the camera turns to look past Klyop at it, on phones and computers alike.
const FOCUS_RATE = 4.2;

export function createControls(canvas, { stick, jump, interact, attack, dodge, inventory, focus }, onReset, onCenter,
  touchLayout) {
  // The focus button is made by walk-hud.mjs; main.mjs does not need to pass it.
  focus ??= canvas.ownerDocument.getElementById("swalk-focus");
  const keys = new Set();
  const queue = [];
  let drag = null, touch = null, stickSprinting = false;
  let stickX = 0, stickZ = 0, currentX = 0, currentZ = 0, currentSprint = false;
  const restingPitch = () => touchLayout.matches ? TOUCH_PITCH : START_PITCH;
  const camera = { yaw: 0, pitch: restingPitch() };
  let sinceSwipe = Infinity, centerYaw = null;

  function clearStick() {
    touch = null;
    stickX = stickZ = 0;
    stickSprinting = false;
    stick.style.removeProperty("--stick-x");
    stick.style.removeProperty("--stick-y");
    stick.style.removeProperty("--stick-origin-x");
    stick.style.removeProperty("--stick-origin-y");
    stick.removeAttribute("data-active");
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
    // typing a nickname in the room window: the letters go to the field, not to Klyop
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
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
  // A finger acts on the press: quicker in a fight, and a tap that follows a short stick touch sometimes gets no
  // click from the browser at all. Mouse and keyboard keep the click; a click right after a press is the same tap.
  for (const [action, button] of Object.entries({ interact, attack, dodge, inventory, focus })) {
    if (!button) continue;
    let pressedAt = -Infinity;
    button.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" || event.button !== 0) return;
      pressedAt = event.timeStamp;
      queue.push({ time: event.timeStamp, action });
    });
    button.addEventListener("click", event => {
      if (event.timeStamp - pressedAt < 900) return;
      queue.push({ time: event.timeStamp, action });
    });
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (drag || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (dx || dy) {
      centerYaw = null;
      drag.moved = true;
      camera.yaw -= dx * 0.006;
      camera.pitch = clamp(camera.pitch + dy * 0.005, 0.10, 0.94);
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  function endCameraDrag(event) {
    if (drag?.id !== event.pointerId) return;
    if (drag.moved) sinceSwipe = 0;
    drag = null;
  }
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(name, endCameraDrag);
  }

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
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stick.style.setProperty("--stick-origin-x", `${event.clientX - bounds.left}px`);
    stick.style.setProperty("--stick-origin-y", `${event.clientY - bounds.top}px`);
    stick.setAttribute("data-active", "");
    stick.setPointerCapture(event.pointerId);
    moveStick(event);
  });
  stick.addEventListener("pointermove", (event) => {
    if (touch?.id === event.pointerId) moveStick(event);
  });
  function releaseStick(event) {
    if (touch?.id !== event.pointerId) return;
    clearStick();
    queue.push({ time: event.timeStamp, x: 0, z: 0, sprint: false });
  }
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    stick.addEventListener(name, releaseStick);
  }

  function center(heading) {
    if (!touchLayout.matches) {
      camera.yaw = heading + Math.PI;
      return;
    }
    centerYaw = heading + Math.PI;
    sinceSwipe = Infinity;
  }

  // `focusYaw`: the direction from Klyop to the held target (main.mjs may pass it); without it, a pressed focus
  // button means Klyop already faces the target, so his heading is used.
  function updateCamera(heading, dt, focusYaw) {
    const locked = Number.isFinite(focusYaw) ? focusYaw
      : focus?.getAttribute("aria-pressed") === "true" ? heading : null;
    if (locked !== null) {
      centerYaw = null;
      if (drag) return;
      const delta = locked + Math.PI - camera.yaw;
      camera.yaw += Math.atan2(Math.sin(delta), Math.cos(delta)) * -Math.expm1(-FOCUS_RATE * dt);
      camera.pitch += (restingPitch() - camera.pitch) * -Math.expm1(-3 * dt);
      return;
    }
    if (!touchLayout.matches) return;
    if (centerYaw !== null) {
      const weight = -Math.expm1(-CENTER_RATE * dt);
      const delta = centerYaw - camera.yaw;
      const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
      camera.yaw += turn * weight;
      const pitchDelta = restingPitch() - camera.pitch;
      camera.pitch += pitchDelta * weight;
      if (Math.abs(turn) < .008 && Math.abs(pitchDelta) < .008) {
        camera.yaw = centerYaw;
        camera.pitch = restingPitch();
        centerYaw = null;
      }
      return;
    }
    if (drag) return;
    sinceSwipe += dt;
    const magnitude = Math.hypot(currentX, currentZ);
    if (sinceSwipe < (magnitude > DEADZONE ? FOLLOW_AFTER_MOVE : FOLLOW_AFTER_IDLE)) return;
    // Camera-relative movement would keep turning the actor if we chased a sideways or backward stick.
    if (magnitude > DEADZONE && (currentZ >= 0 || Math.abs(currentX) > .07)) return;
    const delta = heading + Math.PI - camera.yaw;
    const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
    camera.yaw += turn * -Math.expm1(-FOLLOW_RATE * dt);
    camera.pitch += (restingPitch() - camera.pitch) * -Math.expm1(-PITCH_RETURN * dt);
  }
  return {
    camera,
    center,
    updateCamera,
    resetCamera(heading) {
      clearInput();
      centerYaw = null;
      sinceSwipe = Infinity;
      camera.pitch = restingPitch();
      camera.yaw = heading + Math.PI;
    },
    sample(time) {
      const tapped = new Set();
      const actions = { jump: false, interact: false, attack: false, dodge: false, inventory: false, focus: false };
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
