const NOTES = {
  beacon: [290, 435, 0.20, 0.035],
  win: [420, 610, 0.35, 0.040],
  tea: [320, 500, 0.27, 0.025],
  radio: [138, 410, 0.27, 0.040],
  swing: [360, 95, 0.11, 0.022],
  contact: [175, 65, 0.14, 0.050],
  hit: [112, 49, 0.25, 0.045],
  knock: [142, 82, 0.12, 0.030],
};
const SURFACES = { wood: [730, 0.064, 0.062], mud: [340, 0.072, 0.050], water: [1190, 0.125, 0.045] };

export function createFeedback() {
  let context, noise;
  const unlock = () => {
    if (!window.AudioContext) return;
    if (!context) {
      context = new AudioContext();
      noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.14), context.sampleRate);
      const channel = noise.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
    }
    if (context.state !== "running") context.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  return (kind, strength = 1) => {
    if (context?.state !== "running") return;
    const note = NOTES[kind], surface = SURFACES[kind];
    if (!note && !surface) return;
    const now = context.currentTime, gain = context.createGain();
    gain.connect(context.destination);
    const duration = note ? note[2] : surface[1];
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime((note?.[3] ?? surface[2]) * strength, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    let source;
    if (note) {
      source = context.createOscillator();
      source.type = "triangle";
      source.frequency.setValueAtTime(note[0], now);
      source.frequency.exponentialRampToValueAtTime(note[1], now + duration);
      source.connect(gain);
    } else {
      source = context.createBufferSource();
      source.buffer = noise;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = surface[0];
      source.connect(filter).connect(gain);
    }
    source.start();
    source.stop(now + duration);
  };
}
