// Keep the locally extracted arena references out of both public outputs.
export const privateArena = (path) => /^brand\/klyop\/3d\/arena(?:\/|$)/.test(path.replaceAll("\\", "/"));
