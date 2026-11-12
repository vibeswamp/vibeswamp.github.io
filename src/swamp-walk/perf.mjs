import { PROFILE } from "./quality.mjs";

// `?perf=1` in the address shows frame time, draw calls and downloaded megabytes over the scene,
// so a screenshot from a real phone is a measurement.
export function createPerfOverlay(renderer, root) {
  if (!new URLSearchParams(location.search).has("perf")) return null;
  const box = document.createElement("pre");
  box.className = "walk-perf";
  box.setAttribute("aria-hidden", "true");
  root.append(box);
  const times = [];
  let last = 0, shownAt = 0;
  return {
    frame(stamp) {
      if (last) times.push(stamp - last);
      last = stamp;
      if (times.length > 240) times.shift();
      if (stamp - shownAt < 500 || !times.length) return;
      shownAt = stamp;
      const sorted = [...times].sort((a, b) => a - b);
      const mean = sorted.reduce((sum, time) => sum + time, 0) / sorted.length;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      const { calls, triangles } = renderer.info.render;
      const bytes = performance.getEntriesByType("resource")
        .reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0);
      const { width, height } = renderer.domElement;
      const heap = performance.memory ? ` · JS ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} МБ` : "";
      box.textContent = `${Math.round(1000 / mean)} к/с · p95 ${p95.toFixed(1)} мс\n`
        + `${calls} выз. · ${Math.round(triangles / 1000)} тыс. треуг.\n`
        + `${width}×${height} · DPR ${renderer.getPixelRatio().toFixed(2)}\n`
        + `${(bytes / 1048576).toFixed(1)} МБ скачано${heap} · ${PROFILE}`;
    },
  };
}
