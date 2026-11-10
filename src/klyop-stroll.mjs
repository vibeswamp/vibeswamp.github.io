// The baked camera angles advance in the opposite order to screen octants.
export function spriteRow(dx, dy) {
  const octant = Math.round(Math.atan2(dx, dy) / (Math.PI / 4));
  return (8 - octant) % 8;
}

const STAND = 4;

function mountStroll(bank) {
  const runner = bank.querySelector(".klyop-trail-runner");
  const image = runner.querySelector("img");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false, ready = false, path = [];
  let leg = 0, fraction = 0, row = 0, gait = 0, rest = 0;
  let frame = 0, last = null, shown;
  let speed = 100;

  function pose(column) {
    const transform = `translate(${column * -20}%, ${row * -12.5}%)`;
    if (shown === transform) return;
    image.style.transform = transform;
    shown = transform;
  }

  function place() {
    const [ax, ay] = path[leg];
    const [bx, by] = path[(leg + 1) % path.length];
    const x = ax + (bx - ax) * fraction;
    const y = ay + (by - ay) * fraction;
    runner.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = null;
  }

  function sync() {
    if (!visible || document.hidden) { stop(); return; }
    if (!image.hasAttribute("src")) image.src = image.dataset.src;
    if (!ready) return;
    if (reduced.matches || !path.length) {
      stop();
      pose(STAND);
      return;
    }
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function fit() {
    if (!ready) return;
    const left = 12;
    const right = bank.clientWidth - runner.offsetWidth - left;
    const height = runner.offsetHeight;
    const top = 2 - height * 0.10;
    const bottom = Math.max(top, bank.clientHeight - height * 0.94 - 2);
    const span = right - left;
    if (span < 40 || bottom - top < 2) {
      path = [];
      runner.style.transform = `translate3d(${Math.max(0, right / 2)}px, ${bottom}px, 0)`;
      sync();
      return;
    }
    const a = left + span * 0.28;
    const b = left + span * 0.70;
    const diagonal = Math.min(bottom - top, span * 0.08);
    speed = Math.min(116, 76 + bank.clientWidth * 0.04);
    path = [
      [left, bottom, true], [a, bottom, true], [a, top], [a + diagonal, bottom],
      [b, bottom, true], [b + diagonal, top], [right, top], [right, bottom, true],
      [b + diagonal, bottom], [b, top], [a + diagonal, top, true], [a, bottom]
    ];
    place();
    sync();
  }

  function tick(now) {
    frame = 0;
    if (!visible || document.hidden || reduced.matches) { sync(); return; }
    const dt = last === null ? 0 : Math.min(50, now - last);
    last = now;
    if (rest > 0) {
      rest = Math.max(0, rest - dt);
    } else {
      const next = (leg + 1) % path.length;
      const [ax, ay] = path[leg];
      const [bx, by, pause] = path[next];
      const dx = bx - ax, dy = by - ay;
      row = spriteRow(dx, dy);
      fraction = Math.min(1, fraction + dt * speed / (1000 * Math.hypot(dx, dy)));
      gait += dt;
      place();
      if (fraction === 1) {
        leg = next;
        fraction = 0;
        if (pause) rest = 950;
      }
      pose(rest > 0 ? STAND : Math.floor(gait / 92) % 4);
    }
    frame = requestAnimationFrame(tick);
  }

  image.addEventListener("load", () => {
    ready = true;
    runner.hidden = false;
    pose(STAND);
    fit();
  }, { once: true });
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(bank);
  else window.addEventListener("resize", fit);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.intersectionRatio > 0;
      sync();
    }, { threshold: 0.01 }).observe(bank);
  } else {
    const check = () => {
      const rect = bank.getBoundingClientRect();
      visible = rect.top < window.innerHeight && rect.bottom > 0;
      sync();
    };
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();
  }
}

const bank = typeof document === "undefined" ? null : document.querySelector(".klyop-trail-bank");
if (bank) mountStroll(bank);
