// [start Hz, end Hz, seconds, gain, crack]: `crack` adds a short burst of noise under the tone, cut at that
// frequency - the dull knock of the wrench on a body.
const NOTES = {
  beacon: [290, 435, 0.20, 0.035],
  win: [420, 610, 0.35, 0.040],
  tea: [320, 500, 0.27, 0.025],
  radio: [138, 410, 0.27, 0.040],
  swing: [360, 95, 0.11, 0.022],
  contact: [175, 58, 0.16, 0.052, 1500],
  hit: [112, 49, 0.25, 0.045, 700],
  knock: [142, 82, 0.12, 0.030],
  tell: [196, 262, 0.2, 0.014],
  evade: [540, 820, 0.12, 0.012, 2600],
  focus: [610, 760, 0.05, 0.012],
  rage: [96, 150, 0.45, 0.05, 420],
};
const CRACK_SECONDS = 0.07;
const SURFACES = { wood: [730, 0.064, 0.062], mud: [340, 0.072, 0.050], water: [1190, 0.125, 0.045],
  roll: [880, 0.14, 0.05] };

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
  function crack(frequency, level) {
    const now = context.currentTime, gain = context.createGain(), filter = context.createBiquadFilter();
    gain.connect(context.destination);
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + CRACK_SECONDS);
    filter.type = "lowpass";
    filter.frequency.value = frequency;
    const source = context.createBufferSource();
    source.buffer = noise;
    source.connect(filter).connect(gain);
    source.start();
    source.stop(now + CRACK_SECONDS);
  }
  return (kind, strength = 1) => {
    if (context?.state !== "running") return;
    const note = NOTES[kind], surface = SURFACES[kind];
    if (!note && !surface) return;
    if (note?.[4]) crack(note[4], note[3] * 1.4 * strength);
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
