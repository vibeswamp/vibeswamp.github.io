export function calibratePalms(T, rig, body) {
  const grip = body.morphTargetDictionary.OpenGrip;
  const previous = body.morphTargetInfluences[grip];
  body.morphTargetInfluences[grip] = 1;
  rig.updateWorldMatrix(true, false);
  rig.updateMatrixWorld(true);
  const palms = ["l", "r"].map(side => {
    const joint = name => rig.getObjectByName(`${name}_${side}`);
    const wrist = joint("hand");
    const upper = joint("upperarm"), lower = joint("lowerarm");
    if (!wrist || !upper || !lower || !["middle_01", "index_01", "pinky_01"].every(joint)) return null;
    const local = name => wrist.worldToLocal(joint(name).getWorldPosition(new T.Vector3()));
    const forward = local("middle_01").normalize();
    const across = local("index_01").sub(local("pinky_01")).normalize();
    const up = new T.Vector3().crossVectors(across, forward).normalize();
    if (side === "r") up.negate();
    const sideAxis = new T.Vector3().crossVectors(up, forward);
    const align = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(sideAxis, up, forward)).invert();
    const skin = body.geometry.attributes;
    const middle = [];
    const handBones = new Set();
    wrist.traverse(node => handBones.add(node));
    for (let i = 0; i < skin.skinIndex.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++) {
        if (handBones.has(body.skeleton.bones[skin.skinIndex.getComponent(i, j)])) weight += skin.skinWeight.getComponent(i, j);
      }
      if (weight < .5) continue;
      const point = wrist.worldToLocal(body.getVertexPosition(i, new T.Vector3()).applyMatrix4(body.matrixWorld));
      if (point.dot(forward) > .024 && point.dot(forward) < .062 && Math.abs(point.dot(sideAxis)) < .017) {
        middle.push({ point, i });
      }
    }
    if (!middle.length) return null;
    const marker = middle.reduce((a, b) => a.point.dot(up) < b.point.dot(up) ? a : b);
    return { upper, lower, wrist, marker: marker.point, index: marker.i, align };
  });
  body.morphTargetInfluences[grip] = previous;
  return palms.every(Boolean) ? palms : null;
}

function setWorldRotation(T, bone, rotation) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}

function aim(T, bone, from, to, target) {
  const old = to.clone().sub(from).normalize();
  const next = target.clone().sub(from).normalize();
  setWorldRotation(T, bone, new T.Quaternion().setFromUnitVectors(old, next).multiply(bone.getWorldQuaternion(new T.Quaternion())));
}

export function wristOffset(T, { wrist, marker, align }, yaw = 0) {
  const rotation = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw).multiply(align);
  const offset = marker.clone().multiply(wrist.getWorldScale(new T.Vector3())).applyQuaternion(rotation);
  return { rotation, offset };
}

function plantPalm(T, palm, point, weight, yaw) {
  if (weight <= 0) return;
  const { upper, lower, wrist } = palm;
  const start = upper.getWorldPosition(new T.Vector3());
  const elbow = lower.getWorldPosition(new T.Vector3());
  const current = wrist.getWorldPosition(new T.Vector3());
  const { rotation, offset } = wristOffset(T, palm, yaw);
  const target = current.clone().lerp(point.clone().sub(offset), weight);
  const axis = target.clone().sub(start);
  const a = start.distanceTo(elbow), b = elbow.distanceTo(current);
  const reach = T.MathUtils.clamp(axis.length(), Math.abs(a - b) + .001, a + b - .001);
  axis.normalize();
  const pole = elbow.clone().sub(start);
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0).addScaledVector(axis, axis.y);
  pole.normalize();
  const along = (a * a - b * b + reach * reach) / (2 * reach);
  const nextElbow = start.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
  const nextWrist = start.clone().addScaledVector(axis, reach);
  const wristRotation = wrist.getWorldQuaternion(new T.Quaternion()).slerp(rotation, weight);
  aim(T, upper, start, elbow, nextElbow);
  aim(T, lower, lower.getWorldPosition(elbow), wrist.getWorldPosition(current), nextWrist);
  setWorldRotation(T, wrist, wristRotation);
}

export function createMantlePlacement(T, rig, body) {
  const palms = calibratePalms(T, rig, body);
  const head = rig.getObjectByName("Head");
  const thighs = ["l", "r"].map(side => rig.getObjectByName(`thigh_${side}`));
  if (!palms || !head || !thighs.every(Boolean)) return null;
  const poses = [head, ...thighs, ...palms.flatMap(({ upper, lower, wrist }) => [upper, lower, wrist])]
    .map(bone => ({ bone, rotation: new T.Quaternion() }));
  const axis = new T.Vector3();
  const parentInverse = new T.Quaternion();
  const pitch = new T.Quaternion();
  let saved = false;
  const smooth = T.MathUtils.smoothstep;
  function rotate(bone, yaw, angle) {
    axis.set(Math.cos(yaw), 0, -Math.sin(yaw));
    axis.applyQuaternion(bone.parent.getWorldQuaternion(parentInverse).invert());
    bone.quaternion.premultiply(pitch.setFromAxisAngle(axis, T.MathUtils.degToRad(angle)));
    bone.updateWorldMatrix(false, true);
  }
  return {
    restore() {
      if (!saved) return;
      for (const { bone, rotation } of poses) bone.quaternion.copy(rotation);
      saved = false;
    },
    update(path, clipTime, blend = 1) {
      const { fit } = path.program;
      if (!fit || !path.lip) return;
      const raw = fit.sourceFrom + clipTime * fit.sourceRate;
      const duck = smooth(raw, 3.57, 3.93) * (1 - smooth(raw, 4.50, 4.88)) * blend;
      const weights = [6.31, 5.86].map(end => smooth(raw, 4.08, 4.36) * (1 - smooth(raw, end - .18, end)) * blend);
      const waterEntry = path.deckExit ? (1 - smooth(raw, 1.06, 1.20)) * (.6 + .4 * blend) : 0;
      if (!duck && !waterEntry && !weights.some(Boolean)) return;
      for (const { bone, rotation } of poses) rotation.copy(bone.quaternion);
      saved = true;
      rotate(head, path.yaw, -55 * duck - 42 * waterEntry);
      for (const thigh of thighs) rotate(thigh, path.yaw, 32 * duck);
      const { x, y, z } = path.lip;
      for (const [i, palm] of palms.entries()) {
        const side = i ? -.30 : .30;
        const point = new T.Vector3(x + side * path.cos + .004 * path.sin, y + .006 + .065 * (1 - weights[i]),
          z - side * path.sin + .004 * path.cos);
        const hand = path.handTargets?.[i];
        if (hand) point.set(hand.x, hand.y + .006 + .065 * (1 - weights[i]), hand.z);
        plantPalm(T, palm, point, weights[i], path.yaw);
      }
    },
  };
}
