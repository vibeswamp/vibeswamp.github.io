async function readFile(response, onBytes) {
  if (!response.body) {
    const blob = await response.blob();
    onBytes(blob.size);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.byteLength);
  }
  return new Blob(chunks, { type: response.headers.get("Content-Type") ?? "" });
}

export async function preloadWalkAssets(manifest, manager, report) {
  const controller = new AbortController();
  const files = new Map(manifest.map(item => [
    item.path, { ...item, loaded: 0, status: "waiting" },
  ]));

  function update() {
    let loaded = 0, total = 0;
    const groups = {};
    for (const file of files.values()) {
      const group = groups[file.group] ??= { loaded: 0, total: 0, finished: 0, count: 0, skipped: 0 };
      const size = file.status === "skipped" ? file.loaded : file.bytes;
      loaded += file.loaded;
      total += size;
      group.loaded += file.loaded;
      group.total += size;
      group.count++;
      if (file.status === "done" || file.status === "skipped") group.finished++;
      if (file.status === "skipped") group.skipped++;
    }
    report({ loaded, total, groups });
  }

  update();
  const tasks = Array.from(files.values(), async file => {
    try {
      const response = await fetch(file.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Asset HTTP ${response.status}: ${file.path}`);
      file.source = response.url;
      file.blob = await readFile(response, count => {
        file.loaded += count;
        update();
      });
      if (file.loaded !== file.bytes) throw new Error(`Unexpected asset size: ${file.path}`);
      file.status = "done";
    } catch (error) {
      if (!file.optional) throw error;
      file.status = "skipped";
      file.blob = null;
      console.warn("Optional 3D asset:", error);
    }
    update();
  });
  try {
    await Promise.all(tasks);
  } catch (error) {
    controller.abort();
    await Promise.allSettled(tasks);
    throw error;
  }

  manager.setURLModifier(url => {
    const resolved = new URL(url, document.baseURI);
    const file = resolved.origin === location.origin ? files.get(resolved.pathname) : null;
    if (!file) return url;
    return file.objectUrl ??= URL.createObjectURL(file.blob ?? new Blob());
  });

  return {
    manager,
    async json(url) {
      const file = files.get(new URL(url, document.baseURI).pathname);
      if (!file?.blob) throw new Error(`Unavailable 3D data: ${url}`);
      return { data: JSON.parse(await file.blob.text()), url: file.source };
    },
    dispose() {
      for (const file of files.values()) {
        if (file.objectUrl) URL.revokeObjectURL(file.objectUrl);
      }
      files.clear();
    },
  };
}
