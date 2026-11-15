// Customizable 3D look presets for Klyop (coat, headwear, gear, skin), encoded into a short slug (`c0-h0-g0-s0`)
// that passes the multiplayer room protocol (`hat`: /^[a-z0-9-]{1,24}$/) so peers see every detail across phones.

export const LOOK_KEY = "vibeswamp-klyop-look:v1";

export const COATS = Object.freeze([
  { id: "storm", rgb: [1, 1, 1], swatch: "#324468" },
  { id: "moss", rgb: [0.36, 0.72, 0.24], swatch: "#628b4d" },
  { id: "amber", rgb: [0.92, 0.42, 0.14], swatch: "#cf6d38" },
  { id: "plum", rgb: [0.62, 0.24, 0.78], swatch: "#8b54a3" },
  { id: "slate", rgb: [0.44, 0.48, 0.56], swatch: "#4b525e" },
  { id: "teal", rgb: [0.16, 0.68, 0.64], swatch: "#43a198" },
]);

export const HATS = Object.freeze([
  { id: "none", swatch: "#5a4232" },
  { id: "bucket", swatch: "#6d7648" },
  { id: "cap", swatch: "#33465a" },
  { id: "beanie", swatch: "#b95c39" },
  { id: "band", swatch: "#cf8e41" },
]);

export const GEARS = Object.freeze([
  { id: "specs", glasses: "default", lantern: 0xff9f38, swatch: "#e8a852" },
  { id: "clear", glasses: "none", lantern: 0xffb347, swatch: "#9fb57a" },
  { id: "shades", glasses: "dark", lantern: 0x6ce3d4, swatch: "#58c9ba" },
  { id: "gold", glasses: "gold", lantern: 0xff7738, swatch: "#f0864b" },
]);

export const SKINS = Object.freeze([
  { id: "bog", rgb: [1, 1, 1], swatch: "#6e8b43" },
  { id: "emerald", rgb: [0.78, 1.22, 0.88], swatch: "#49a165" },
  { id: "sand", rgb: [1.26, 1.06, 0.76], swatch: "#b89658" },
  { id: "mist", rgb: [1.14, 1.18, 1.24], swatch: "#9cb5a8" },
]);

export const DEFAULT_LOOK = Object.freeze({ coat: 0, hat: 0, gear: 0, skin: 0 });

const clampIndex = (val, list) => {
  const n = Math.floor(Number(val));
  return Number.isFinite(n) && n >= 0 && n < list.length ? n : 0;
};

export function normalizeLook(raw) {
  return {
    coat: clampIndex(raw?.coat, COATS),
    hat: clampIndex(raw?.hat, HATS),
    gear: clampIndex(raw?.gear, GEARS),
    skin: clampIndex(raw?.skin, SKINS),
  };
}

export function encodeLook(look) {
  const n = normalizeLook(look);
  return `c${n.coat}-h${n.hat}-g${n.gear}-s${n.skin}`;
}

export function decodeLook(slug) {
  if (typeof slug !== "string") return { ...DEFAULT_LOOK };
  const m = slug.match(/^c(\d+)-h(\d+)-g(\d+)-s(\d+)$/);
  if (!m) return { ...DEFAULT_LOOK };
  return normalizeLook({ coat: m[1], hat: m[2], gear: m[3], skin: m[4] });
}

export function readLook(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(LOOK_KEY) ?? "null");
    return normalizeLook(raw);
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function writeLook(storage, look) {
  const clean = normalizeLook(look);
  try { storage?.setItem(LOOK_KEY, JSON.stringify(clean)); } catch {}
  return clean;
}

/**
 * Builds modular headwear geometry attached directly under Klyop's `Head` bone.
 */
export function buildHatGroup(T, hatIndex) {
  const group = new T.Group();
  group.name = "Klyop_CustomHat";
  const mat = (color, roughness = 0.88, metalness = 0.05) =>
    new T.MeshStandardMaterial({ color, roughness, metalness });

  if (hatIndex === 1) {
    // Olive fisherman's bucket hat sitting neatly over his tousled hair crown.
    const olive = mat(0x5b663b);
    const band = mat(0x3f2e1f, 0.92);
    const brim = new T.Mesh(new T.CylinderGeometry(0.305, 0.365, 0.022, 18), olive);
    brim.position.set(0, 0.235, -0.005);
    const crown = new T.Mesh(new T.CylinderGeometry(0.21, 0.26, 0.155, 16), olive);
    crown.position.set(0, 0.316, -0.005);
    const ribbon = new T.Mesh(new T.CylinderGeometry(0.258, 0.264, 0.032, 16), band);
    ribbon.position.set(0, 0.258, -0.005);
    group.add(brim, crown, ribbon);
    group.position.y = 0.045;
    group.rotation.x = -0.08;
  } else if (hatIndex === 2) {
    // Keeper's peaked skipper cap with brass badge.
    const navy = mat(0x273545);
    const visorMat = mat(0x1b2129, 0.72);
    const brass = mat(0xd8a84e, 0.35, 0.65);
    const crown = new T.Mesh(new T.CylinderGeometry(0.246, 0.228, 0.112, 16), navy);
    crown.position.set(0, 0.298, -0.01);
    const band = new T.Mesh(new T.CylinderGeometry(0.230, 0.232, 0.04, 16), visorMat);
    band.position.set(0, 0.245, -0.008);
    const visor = new T.Mesh(new T.CylinderGeometry(0.235, 0.245, 0.018, 12, 1, false, -0.95, 1.9), visorMat);
    visor.position.set(0, 0.224, 0.125);
    visor.rotation.x = 0.12;
    const badge = new T.Mesh(new T.CylinderGeometry(0.024, 0.024, 0.014, 8), brass);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, 0.292, 0.22);
    group.add(crown, band, visor, badge);
    group.position.y = 0.045;
    group.rotation.x = -0.06;
  } else if (hatIndex === 3) {
    // Warm autumn knit beanie with folded cuff & pom-pom.
    const brick = mat(0xa84c2b, 0.94);
    const cuffMat = mat(0x7c361d, 0.95);
    const dome = new T.Mesh(new T.SphereGeometry(0.248, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), brick);
    dome.position.set(0, 0.228, -0.018);
    dome.scale.set(1.02, 0.96, 1.05);
    const cuff = new T.Mesh(new T.TorusGeometry(0.234, 0.038, 8, 18), cuffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0.238, -0.014);
    const pom = new T.Mesh(new T.SphereGeometry(0.048, 10, 8), mat(0xe3b874, 0.95));
    pom.position.set(0, 0.452, -0.032);
    group.add(dome, cuff, pom);
    group.position.y = 0.042;
    group.rotation.x = -0.10;
  } else if (hatIndex === 4) {
    // Explorer headband / bandana wrapping above his brow with two tails at the back.
    const cloth = mat(0xb8472e, 0.90);
    const band = new T.Mesh(new T.TorusGeometry(0.228, 0.028, 8, 18), cloth);
    band.rotation.x = Math.PI / 2 - 0.14;
    band.position.set(0, 0.205, -0.01);
    const knot = new T.Mesh(new T.SphereGeometry(0.032, 8, 6), cloth);
    knot.position.set(0, 0.175, -0.238);
    const tailL = new T.Mesh(new T.BoxGeometry(0.028, 0.11, 0.012), cloth);
    tailL.position.set(-0.028, 0.125, -0.258);
    tailL.rotation.set(0.35, 0, -0.28);
    const tailR = new T.Mesh(new T.BoxGeometry(0.028, 0.10, 0.012), cloth);
    tailR.position.set(0.026, 0.128, -0.258);
    tailR.rotation.set(0.32, 0, 0.26);
    group.add(band, knot, tailL, tailR);
    group.position.y = 0.028;
  }
  return group;
}
