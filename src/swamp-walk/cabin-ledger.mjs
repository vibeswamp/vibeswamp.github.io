export function addCabinLedger(THREE, root, owned, projects, copy, hasWall) {
  const producers = copy.producers.filter(({ id }) => owned[id] > 0);
  const work = copy.projects.filter(({ id }) => projects.has(id));
  if (!producers.length && !work.length) return;
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 448;
  const ctx = canvas.getContext("2d");
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  const images = new Map();

  function paint() {
    ctx.fillStyle = "#c3aa72";
    ctx.fillRect(0, 0, 768, 448);
    ctx.strokeStyle = "#695432";
    ctx.lineWidth = 10;
    ctx.strokeRect(9, 9, 750, 430);
    ctx.fillStyle = "#2a3224";
    ctx.font = "bold 38px system-ui";
    ctx.fillText(copy.title, 36, 61, 688);
    ctx.font = "bold 18px system-ui";
    for (const [i, { id, name }] of producers.entries()) {
      const x = 38 + i % 4 * 174, y = 77 + Math.floor(i / 4) * 107;
      ctx.fillStyle = "#283b30";
      ctx.fillRect(x, y, 154, 76);
      const tile = images.get(id);
      if (tile) ctx.drawImage(tile, x, y, 126, 76);
      ctx.fillStyle = "#f3deaa";
      ctx.fillText(String(owned[id]), x + 130, y + 25, 23);
      ctx.fillStyle = "#272b1f";
      ctx.fillText(name, x, y + 96, 153);
    }
    const top = 92 + Math.ceil(producers.length / 4) * 107;
    ctx.fillStyle = "#39482e";
    ctx.font = "bold 21px system-ui";
    for (const [i, { name }] of work.entries()) {
      ctx.fillText(`✓  ${name}`, 40 + i % 2 * 353, top + Math.floor(i / 2) * 30, 330);
    }
    atlas.needsUpdate = true;
  }
  for (const { id } of producers) {
    const img = new Image();
    img.onload = () => { images.set(id, img); paint(); };
    img.src = `/brand/swamp/${id}.webp`;
  }
  paint();
  const group = new THREE.Group();
  group.name = "Cabin/ledger";
  group.position.set(0.55, 1.42, -1.49);
  const trim = new THREE.MeshStandardMaterial({ color: 0x805837, roughness: 0.84 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.81, 0.065), trim);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.75), new THREE.MeshStandardMaterial({
    map: atlas, roughness: 0.9, emissive: 0x8e683d, emissiveIntensity: 0.11,
  }));
  board.position.z = 0.035;
  group.add(frame, board);
  if (!hasWall) for (const x of [-0.52, 0.52]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.072, 1.05, 0.072), trim);
    leg.position.set(x, -0.895, -0.025);
    group.add(leg);
  }
  root.add(group);
}
