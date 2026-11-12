// One device profile for the whole 3D mode. Phones and tablets get lighter models and textures; computers get
// 1024-pixel textures. walk-build.mjs marks the startup files with the same profile names.
const handheld = typeof matchMedia === "function" && matchMedia("(pointer: coarse), (max-width: 640px)").matches;

export const PROFILE = handheld ? "phone" : "desktop";

const ART = "/swamp-walk/mvp/";
export const MODELS = handheld ? {
  klyop: "/swamp-walk/klyop-walk-phone.glb",
  fly: `${ART}fly-512.glb`,
  beggar: `${ART}beggar-512.glb`,
} : {
  klyop: "/swamp-walk/klyop-walk-1024.glb",
  fly: `${ART}fly-1024.glb`,
  beggar: `${ART}beggar-1024.glb`,
};
