const applied = new WeakMap();

/**
 * Local finish for the dusk walk. Reuses the skinned body and existing gear meshes.
 */
export function applyKlyopPresentation(T, rig) {
  if (applied.has(rig)) return applied.get(rig);
  const body = rig.getObjectByName("Klyop_Body");
  const belt = rig.getObjectByName("Electrician_Rig_T2");
  const lantern = rig.getObjectByName("Darkwater_Lantern_T2");
  if (!body?.isSkinnedMesh || !belt || !lantern) throw new Error("Missing Klyop v002 meshes");

  const { position, skinIndex, skinWeight } = body.geometry.attributes;
  const mask = new Float32Array(position.count * 4);
  const handNames = new Set(["hand_r", "hand_l"]);
  const forearmNames = new Set(["lowerarm_r", "lowerarm_l"]);
  const boneNames = body.skeleton.bones.map(bone => bone.name);
  const smooth = T.MathUtils.smoothstep;
  for (let i = 0; i < position.count; i++) {
    const x = Math.abs(position.getX(i)), y = position.getY(i), z = position.getZ(i);
    let wrist = 0, arm = 0;
    for (let slot = 0; slot < 4; slot++) {
      const bone = boneNames[skinIndex.getComponent(i, slot)];
      const weight = skinWeight.getComponent(i, slot);
      if (handNames.has(bone)) wrist += weight;
      if (forearmNames.has(bone)) arm += weight;
    }
    mask[4 * i] = smooth(y, .875, .96) * (1 - smooth(y, 1.087, 1.18)) * smooth(z, .025, .12);
    mask[4 * i + 1] = smooth(wrist + .62 * arm * smooth(x, .28, .41), .25, .86);
    mask[4 * i + 2] = 1 - smooth(y, .065, .128);
    mask[4 * i + 3] = y;
  }
  body.geometry.setAttribute("walkSkinFinish", new T.BufferAttribute(mask, 4));
  const clothWetness = { value: 0 };
  const setClothWetness = value => { clothWetness.value = T.MathUtils.clamp(value, 0, 1); };
  applied.set(rig, setClothWetness);
  const finish = body.material.clone();
  finish.roughness = .98;
  finish.onBeforeCompile = shader => {
    shader.uniforms.klyopClothWetness = clothWetness;
    shader.vertexShader = "attribute vec4 walkSkinFinish; varying vec4 vWalkSkinFinish;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vWalkSkinFinish = walkSkinFinish;
      `);
    shader.fragmentShader = "uniform float klyopClothWetness; varying vec4 vWalkSkinFinish;\n" + shader.fragmentShader
      .replace("#include <color_fragment>", `
        #include <color_fragment>
        float skinCoverage = clamp(max(vWalkSkinFinish.x, max(vWalkSkinFinish.y, vWalkSkinFinish.z)), 0.0, 1.0);
        float warmTexel = smoothstep(.012, .065, diffuseColor.r - diffuseColor.b);
        vec3 skinBalance = vec3(-.14, .28, .15) * vWalkSkinFinish.x
          + vec3(-.17, .43, .11) * vWalkSkinFinish.y
          + vec3(-.20, .27, -.03) * vWalkSkinFinish.z;
        diffuseColor.rgb *= 1.0 + skinBalance * warmTexel;
        float lowerCloth = (1.0 - skinCoverage) * (1.0 - smoothstep(.29, .46, vWalkSkinFinish.w));
        diffuseColor.rgb *= 1.0 - (1.0 - skinCoverage) * klyopClothWetness * .16 - lowerCloth * .13;
      `)
      .replace("#include <roughnessmap_fragment>", `
        #include <roughnessmap_fragment>
        roughnessFactor *= mix(1.0 - .37 * klyopClothWetness, .67, skinCoverage);
      `)
      .replace("#include <normal_fragment_maps>", `
        #include <normal_fragment_maps>
        float textureRelief = mix(.42 + .43 * klyopClothWetness, .88, skinCoverage);
        normal = normalize(mix(nonPerturbedNormal, normal, textureRelief));
      `)
      .replace("#include <lights_physical_fragment>", `
        #include <lights_physical_fragment>
        float gloss = mix(.18 + .56 * klyopClothWetness, .74, skinCoverage);
        material.specularColor *= gloss;
        material.specularColorBlended *= gloss;
        material.specularF90 *= mix(.32 + .40 * klyopClothWetness, .84, skinCoverage);
      `)
      .replace("#include <opaque_fragment>", `
        float duskEdge = pow(1.0 - clamp(abs(dot(nonPerturbedNormal, normalize(vViewPosition))), 0.0, 1.0), 3.8);
        float skinLift = dot(vWalkSkinFinish.xyz, vec3(.08, .13, .18));
        float hoodEdge = smoothstep(.70, .98, vWalkSkinFinish.w) * (1.0 - skinCoverage);
        outgoingLight += (vec3(.030, .042, .049) + hoodEdge * vec3(.038, .039, .040)) * duskEdge;
        outgoingLight += diffuseColor.rgb * (.061 + skinLift);
        #include <opaque_fragment>
      `);
  };
  finish.customProgramCacheKey = () => "vibeswamp-klyop-dusk-v4";
  body.material = finish;

  belt.traverse(object => {
    if (!object.isMesh || !/GearPilot-Wire$/.test(object.material.name)) return;
    object.material = object.material.clone();
    object.material.color.multiplyScalar(.55);
  });
  lantern.traverse(object => {
    if (!object.isMesh || !/GearPilot-Amber/.test(object.material.name)) return;
    object.material = object.material.clone();
    object.material.emissiveIntensity *= 1.62;
  });
  return setClothWetness;
}
