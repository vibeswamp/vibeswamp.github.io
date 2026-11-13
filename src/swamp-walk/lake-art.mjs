function timberBlock(T) {
  const geometry = new T.BoxGeometry();
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    const tile = face === 2 || face === 3 ? 2 : 0;
    uv.setXY(i, (tile * 256 + 10.5 + 235 * uv.getX(i)) / 768, (10.5 + 235 * uv.getY(i)) / 256);
  }
  return geometry;
}

// Use the world-owned deck profile and the texture already shared by the boardwalk.
export function addFishingRest(T, scene, land, timberAtlas) {
  const fishing = land.lakes?.fishing;
  if (!fishing || !land.deck.fishing || !timberAtlas) {
    throw new Error("Fishing rest requires the world fishing profile and the shared deck atlas");
  }
  const x = fishing.endX + .29;
  const z = fishing.z + fishing.width / 2 - .15;
  const y = land.deck.fishing.heightAt(x, z);
  if (!Number.isFinite(y)) throw new Error("Fishing rest requires a deck surface");
  const wood = new T.MeshStandardMaterial({ map: timberAtlas, color: 0xdac299, roughness: .86 });
  const mesh = new T.InstancedMesh(timberBlock(T), wood, 4);
  mesh.name = "Cove rod rest";
  const part = new T.Object3D();
  for (const [index, [dx, lift, width, height, depth, tilt]] of [
    [0, .024, .16, .048, .12, 0], [0, .154, .055, .23, .052, 0],
    [-.027, .283, .032, .127, .046, .42], [.027, .283, .032, .127, .046, -.42],
  ].entries()) {
    part.position.set(x + dx, y + lift, z);
    part.scale.set(width, height, depth);
    part.rotation.z = tilt;
    part.updateMatrix();
    mesh.setMatrixAt(index, part.matrix);
  }
  scene.add(mesh);
  return { mesh, placement: { x, y, z }, draws: 1, triangles: mesh.count * mesh.geometry.index.count / 3 };
}
