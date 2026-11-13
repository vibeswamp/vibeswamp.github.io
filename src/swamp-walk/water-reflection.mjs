import * as T from "./vendor/three.mjs";

const LAYER = 5;

export function reflectInWater(object) {
  object.layers.enable(LAYER);
  return object;
}

// Groups (the shack, Klyop, the boardwalk): every mesh inside joins the reflection layer.
export function reflectTreeInWater(root) {
  root.traverse(object => { if (object.isMesh) object.layers.enable(LAYER); });
  return root;
}

export function createWaterReflectionCamera() {
  const camera = new T.PerspectiveCamera();
  camera.layers.set(LAYER);
  const aim = new T.Vector3(), forward = new T.Vector3();
  const plane = new T.Plane(new T.Vector3(0, 1, 0));
  const clip = new T.Vector4(), farCorner = new T.Vector4();

  return {
    camera,
    update(view, waterline) {
      view.updateWorldMatrix(true, false);
      camera.position.setFromMatrixPosition(view.matrixWorld);
      if (camera.position.y <= waterline + .012) return false;
      camera.position.y = 2 * waterline - camera.position.y;
      forward.set(0, 0, -1).transformDirection(view.matrixWorld);
      forward.y *= -1;
      camera.up.set(0, 1, 0).transformDirection(view.matrixWorld);
      camera.up.y *= -1;
      camera.lookAt(aim.copy(camera.position).add(forward));
      camera.updateMatrixWorld(true);
      camera.projectionMatrix.copy(view.projectionMatrix);

      // Replace the near plane with the waterline in the reflected camera.
      plane.normal.set(0, 1, 0);
      plane.constant = -waterline;
      plane.applyMatrix4(camera.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const matrix = camera.projectionMatrix.elements;
      farCorner.set((Math.sign(clip.x) + matrix[8]) / matrix[0],
        (Math.sign(clip.y) + matrix[9]) / matrix[5], -1, (1 + matrix[10]) / matrix[14]);
      const span = clip.dot(farCorner);
      if (span <= 1e-5) return false;
      clip.multiplyScalar(2 / span);
      matrix[2] = clip.x;
      matrix[6] = clip.y;
      matrix[10] = clip.z + 1;
      matrix[14] = clip.w;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      return true;
    },
  };
}
