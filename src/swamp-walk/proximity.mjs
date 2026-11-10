function release(group) {
  const resources = new Set();
  group.traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    if (object.skeleton) resources.add(object.skeleton);
    for (const material of [].concat(object.material ?? [])) {
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      resources.add(material);
    }
  });
  for (const resource of resources) resource.dispose();
  group.removeFromParent();
  group.clear();
}

export function createProximityActor({ create, THREE, scene, loadRadius = 14, onLoadError, ...options }) {
  const { x, z, floorAt } = options;
  const spawn = { x, y: floorAt(x, z), z };
  const group = new THREE.Group();
  let actor, pending = false, failed = false, disposed = false;

  function load() {
    pending = true;
    Promise.resolve().then(() => create({ ...options, THREE, scene: group })).then((ready) => {
      pending = false;
      if (disposed) { release(group); return; }
      actor = ready;
      scene.add(group);
    }, (error) => {
      pending = false;
      failed = true;
      release(group);
      if (!disposed) onLoadError?.(error);
    });
  }

  return {
    get position() { return actor?.position ?? spawn; },
    get defeated() { return actor?.defeated ?? false; },
    get loaded() { return Boolean(actor); },
    get loading() { return pending; },
    update(dt, player) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return;
      if (actor) { actor.update(dt, player); return; }
      if (Math.hypot(player.x - x, player.z - z) > loadRadius) { failed = false; return; }
      if (!pending && !failed) load();
    },
    strike(player) { return actor?.strike(player) ?? false; },
    reset() { failed = false; actor?.reset(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      actor = null;
      // Keep a late loader result detached until its own cleanup.
      if (!pending) release(group);
    },
  };
}
