export function createKlyopVaultStow(T, wrench, belt) {
  const hand = wrench.parent;
  const gripPosition = wrench.position.clone();
  const gripRotation = wrench.quaternion.clone();
  const socket = new T.Group();
  socket.name = "Swamp_Wrench_Vault_Socket";
  socket.position.set(-0.11, 0.02, -0.20).applyQuaternion(belt.quaternion).add(belt.position);
  socket.quaternion.copy(belt.quaternion).multiply(new T.Quaternion(0, 0, -0.585927703, 0.810363330));
  belt.parent.add(socket);

  const steel = new T.MeshStandardMaterial({ color: 0x535d50, roughness: 0.66, metalness: 0.6 });
  const loop = new T.Mesh(new T.TorusGeometry(0.026, 0.004, 6, 16), steel);
  loop.name = "Swamp_Wrench_Vault_Keeper";
  loop.rotation.x = Math.PI / 2;
  socket.add(loop);
  const anchor = new T.Vector3(-0.093338426, 0.019, -0.171436741)
    .applyQuaternion(belt.quaternion).add(belt.position).sub(socket.position)
    .applyQuaternion(socket.quaternion.clone().invert());
  const connector = anchor.clone().setY(0).setLength(0.026);
  const brace = new T.Mesh(new T.CylinderGeometry(0.005, 0.005, anchor.distanceTo(connector) + 0.009, 8), steel);
  brace.name = "Swamp_Wrench_Vault_Brace";
  brace.position.copy(connector).lerp(anchor, 0.5);
  brace.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), anchor.sub(connector).normalize());
  socket.add(brace);
  socket.visible = false;

  return {
    get stowed() { return socket.visible; },
    set(stowed) {
      if (stowed === socket.visible) return;
      socket.visible = stowed;
      if (stowed) {
        socket.add(wrench);
        wrench.position.set(0, 0, 0);
        wrench.quaternion.identity();
      } else {
        hand.add(wrench);
        wrench.position.copy(gripPosition);
        wrench.quaternion.copy(gripRotation);
      }
    },
  };
}
