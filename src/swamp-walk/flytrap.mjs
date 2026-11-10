import * as T from "./vendor/three.mjs";
import { FLYTRAP, smooth } from "./land.mjs";

const WINDUP = 0.52;
const SNAP = 0.16;
const HOLD = 0.48;
const REOPEN = 0.43;
const END = WINDUP + SNAP + HOLD + REOPEN;
const IMPACT = WINDUP + 0.085;

function addClosure(mesh) {
  mesh.updateMatrix();
  const inverse = mesh.matrix.clone().invert();
  const positions = mesh.geometry.attributes.position;
  const closed = new Float32Array(positions.count * 3);
  const point = new T.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix);
    if (point.y >= .65 && point.z >= -.22) {
      const y = point.y - 1.14, z = point.z + .18;
      const angle = .78 * Math.sign(y) * smooth(-.22, -.14, point.z);
      point.y = 1.14 + Math.cos(angle) * y - Math.sin(angle) * z;
      point.z = -.18 + Math.sin(angle) * y + Math.cos(angle) * z;
    }
    point.applyMatrix4(inverse).toArray(closed, i * 3);
  }
  mesh.geometry = mesh.geometry.clone();
  mesh.geometry.morphAttributes.position = [new T.BufferAttribute(closed, 3)];
  mesh.updateMorphTargets();
}

export function addFlytrap(scene, land, meshes) {
  meshes.forEach(addClosure);
  const { x, z, warningRadius, hitRadius } = FLYTRAP;
  const geometry = new T.RingGeometry(.92, 1.04, 32).rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const px = x + positions.getX(i), pz = z + positions.getZ(i);
    positions.setXYZ(i, px, land.heightAt(px, pz) + .033, pz);
  }
  const warning = new T.Mesh(geometry, new T.MeshBasicMaterial({
    color: 0xffb75c, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide,
  }));
  warning.name = "FlytrapWarning";
  warning.visible = false;
  scene.add(warning);
  let age = -1, ready = true;

  return {
    warning,
    get stage() {
      return age < 0 ? "open" : age < WINDUP ? "warning" : age < WINDUP + SNAP + HOLD ? "closed" : "recovering";
    },
    step(player, dt) {
      const distance = Math.hypot(player.x - x, player.z - z);
      const onBank = player.grounded && !player.swimming && Math.abs(player.y - land.heightAt(x, z)) < .70;
      if (distance > warningRadius + .18) ready = true;
      if (age < 0 && ready && onBank && distance < warningRadius) {
        age = 0;
        ready = false;
      }
      if (age < 0) return false;
      const previous = age;
      age += dt;
      const closure = smooth(WINDUP, WINDUP + SNAP, age) * (1 - smooth(END - REOPEN, END, age));
      for (const mesh of meshes) mesh.morphTargetInfluences[0] = closure;
      warning.visible = age < WINDUP;
      warning.material.opacity = smooth(0, WINDUP * .8, age) * (.50 + .24 * Math.sin(age * 30));
      const hit = previous < IMPACT && age >= IMPACT && onBank && distance < hitRadius;
      if (age >= END) age = -1;
      return hit;
    },
  };
}
