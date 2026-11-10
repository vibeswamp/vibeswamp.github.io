const SUPPORT = {
  run: [[0.058, 0.250], [0.558, 0.754]],
  sprint: [[0.058, 0.275], [0.600, 0.753]],
};

export function crossedFootContact(state, phase, advance) {
  return advance > 0 && !!SUPPORT[state]?.some(([start]) => {
    const offset = (start - phase + 1) % 1;
    return offset > 1e-8 && offset <= advance + 1e-8;
  });
}

function soleIndices(mesh, side, foot, ball) {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const bones = mesh.skeleton.bones;
  const indices = [];
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > .025 || (position.getX(i) < 0) !== (side === "r")) continue;
    let weight = 0;
    for (let j = 0; j < 4; j++) {
      const bone = bones[skinIndex.getComponent(i, j)];
      if (bone === foot || bone === ball) weight += skinWeight.getComponent(i, j);
    }
    if (weight > .8) indices.push(i);
  }
  return indices;
}

export function createFootPlacement(T, rig, mesh) {
  const pelvis = rig.getObjectByName("pelvis");
  const legs = ["l", "r"].map(side => {
    const thigh = rig.getObjectByName(`thigh_${side}`);
    const calf = rig.getObjectByName(`calf_${side}`);
    const foot = rig.getObjectByName(`foot_${side}`);
    const ball = rig.getObjectByName(`ball_${side}`);
    return { thigh, calf, foot, indices: soleIndices(mesh, side, foot, ball),
      anchor: new T.Vector2(), weight: 0, points: [], target: new T.Vector3() };
  });
  for (const leg of legs) leg.points = leg.indices.map(() => new T.Vector3());
  const pose = legs.flatMap(({ thigh, calf, foot }) => [thigh, calf, foot])
    .map(bone => [bone, new T.Quaternion()]);
  const originalPelvis = new T.Vector3();
  const center = new T.Vector2();
  const hip = new T.Vector3(), knee = new T.Vector3(), ankle = new T.Vector3();
  const axis = new T.Vector3(), pole = new T.Vector3(), targetKnee = new T.Vector3(), targetAnkle = new T.Vector3();
  const currentDirection = new T.Vector3(), desiredDirection = new T.Vector3();
  const worldRotation = new T.Quaternion(), parentInverse = new T.Quaternion(), delta = new T.Quaternion();
  const footRotation = new T.Quaternion();
  let saved = false;
  let stillTime = 0;

  function setWorldRotation(bone, rotation) {
    bone.parent.getWorldQuaternion(parentInverse).invert();
    bone.quaternion.multiplyQuaternions(parentInverse, rotation);
    bone.updateWorldMatrix(false, true);
  }

  function aim(bone, from, to, target) {
    currentDirection.subVectors(to, from).normalize();
    desiredDirection.subVectors(target, from).normalize();
    delta.setFromUnitVectors(currentDirection, desiredDirection);
    bone.getWorldQuaternion(worldRotation).premultiply(delta);
    setWorldRotation(bone, worldRotation);
  }

  function solve(leg) {
    leg.thigh.getWorldPosition(hip);
    leg.calf.getWorldPosition(knee);
    leg.foot.getWorldPosition(ankle);
    leg.foot.getWorldQuaternion(footRotation);
    const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle);
    axis.subVectors(leg.target, hip);
    const reach = T.MathUtils.clamp(axis.length(), Math.abs(upper - lower) + .001, upper + lower - .001);
    axis.normalize();
    pole.subVectors(knee, hip);
    pole.addScaledVector(axis, -pole.dot(axis));
    if (pole.lengthSq() < 1e-8) {
      pole.set(0, 0, 1).applyQuaternion(rig.parent.quaternion);
      pole.addScaledVector(axis, -pole.dot(axis));
    }
    pole.normalize();
    const along = (upper ** 2 - lower ** 2 + reach ** 2) / (2 * reach);
    targetKnee.copy(hip).addScaledVector(axis, along)
      .addScaledVector(pole, Math.sqrt(Math.max(0, upper ** 2 - along ** 2)));
    targetAnkle.copy(hip).addScaledVector(axis, reach);
    aim(leg.thigh, hip, knee, targetKnee);
    leg.calf.getWorldPosition(knee);
    leg.foot.getWorldPosition(ankle);
    aim(leg.calf, knee, ankle, targetAnkle);
    setWorldRotation(leg.foot, footRotation);
  }

  function reset() {
    for (const leg of legs) leg.weight = 0;
    stillTime = 0;
  }

  return {
    reset,
    restore() {
      if (!saved) return;
      pelvis.position.copy(originalPelvis);
      for (const [bone, rotation] of pose) bone.quaternion.copy(rotation);
      saved = false;
    },
    update(state, phase, floorAt, dt, centerFloor) {
      rig.parent.updateMatrixWorld(true);
      originalPelvis.copy(pelvis.position);
      for (const [bone, rotation] of pose) rotation.copy(bone.quaternion);
      saved = true;
      stillTime = state === "idle" ? stillTime + dt : 0;
      // Let the trailing sole finish bearing weight before releasing it into idle.
      const release = state === "idle" && stillTime <= .045 ? 0 : dt / .062;
      let drop = 0, dropLimit = .10;
      for (const [side, leg] of legs.entries()) {
        const support = SUPPORT[state]?.[side];
        let weight = 0;
        if (support) {
          const [start, end] = support;
          weight = T.MathUtils.smoothstep(phase, start - .035, start)
            * (1 - T.MathUtils.smoothstep(phase, end, end + .025));
        }
        const previous = leg.weight;
        leg.weight = Math.max(weight, previous - release);
        center.set(0, 0);
        for (const [i, index] of leg.indices.entries()) {
          const point = mesh.getVertexPosition(index, leg.points[i]).applyMatrix4(mesh.matrixWorld);
          center.x += point.x;
          center.y += point.z;
        }
        center.multiplyScalar(1 / leg.indices.length);
        if (!previous && leg.weight) leg.anchor.copy(center);
        const dx = (leg.anchor.x - center.x) * leg.weight;
        const dz = (leg.anchor.y - center.y) * leg.weight;
        let clearance = Infinity, low = Infinity, high = -Infinity;
        for (const point of leg.points) {
          const surface = floorAt(point.x + dx, point.z + dz);
          clearance = Math.min(clearance, point.y - surface);
          low = Math.min(low, surface);
          high = Math.max(high, surface);
        }
        leg.recheckSurface = leg.weight >= .95 && high - low > .065;
        const stepBelow = centerFloor - low;
        if (leg.weight >= .95 && stepBelow > .065) {
          dropLimit = Math.max(dropLimit, Math.min(.19, stepBelow + .05));
        }
        leg.foot.getWorldPosition(leg.target);
        const lowerLimit = leg.weight >= .95 ? T.MathUtils.clamp(stepBelow + .045, .16, .26) : .16;
        const dy = T.MathUtils.clamp(.005 - clearance, -lowerLimit, .16);
        // In swing, only lift a penetrating sole. In support, follow the surface both ways.
        leg.target.x += dx;
        leg.target.y += dy > 0 || state === "idle" ? dy : dy * leg.weight;
        leg.target.z += dz;
        leg.thigh.getWorldPosition(hip);
        leg.calf.getWorldPosition(knee);
        leg.foot.getWorldPosition(ankle);
        const reach = hip.distanceTo(knee) + knee.distanceTo(ankle) - .003;
        const horizontal = (leg.target.x - hip.x) ** 2 + (leg.target.z - hip.z) ** 2;
        const below = hip.y - leg.target.y - Math.sqrt(Math.max(0, reach ** 2 - horizontal));
        drop = Math.max(drop, below);
      }
      if (drop > 0) {
        pelvis.getWorldPosition(hip);
        hip.y -= Math.min(drop, dropLimit);
        pelvis.position.copy(pelvis.parent.worldToLocal(hip));
        pelvis.updateWorldMatrix(false, true);
      }
      for (const leg of legs) {
        solve(leg);
        if (!leg.recheckSurface) continue;
        let clearance = Infinity;
        for (const [i, index] of leg.indices.entries()) {
          const point = mesh.getVertexPosition(index, leg.points[i]).applyMatrix4(mesh.matrixWorld);
          clearance = Math.min(clearance, point.y - floorAt(point.x, point.z));
        }
        if (Math.abs(clearance - .005) > .010) {
          leg.foot.getWorldPosition(leg.target);
          leg.target.y += .005 - clearance;
          solve(leg);
        }
      }
    },
  };
}
