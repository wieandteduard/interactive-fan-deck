/* The deck's sound: paper, synthesised.

   Paper is filtered noise with a fast envelope, so it is cheaper and truer to
   synthesise than to ship. Each card peeling off the one under it is one
   crackle — a handful of broadband noise grains a few milliseconds apart,
   sharp on and quick off. The open is twelve of those laid across the sweep,
   front-loaded where ease-out-quint puts the velocity, and running down in
   brightness and level as the fan slows: the outermost card carries the least
   load and travels fastest, so it goes first and brightest; the card buried
   under ten others goes last, dull and soft. Brightness is a lowpass closing,
   never a pitch falling — there is no bandpass anywhere, because a centre
   frequency is a note, and twelve notes in a row are a glockenspiel.

   Everything is scheduled on the audio clock against a BaseAudioContext, so
   the same code renders into an OfflineAudioContext for measurement. Nothing
   here creates the live context; the component does that on the first real
   gesture, because browsers refuse audio before one. */

export type Gesture = "turn" | "open" | "close" | "hover";

/* Four readings of what a card sliding off a card sounds like. They differ
   in how many grains make one card, how long each lasts and how sharp it
   starts. All of them are dull on purpose: nothing above about 3 kHz and a
   floor low enough to let a little of the sheet's body through. Broadband
   noise with a sharp attack and a ceiling at 7 kHz is a hi-hat, and a hi-hat
   is metal no matter how flat its spectrum is. Card is dark. */
export const VOICINGS = ["tap", "click", "crackle", "brush", "flick", "rustle"] as const;
export type Voicing = (typeof VOICINGS)[number];

export interface SoundParams {
  /* Ms. Open is turn then sweep; close is sweep then turn. */
  turn: number;
  sweep: number;
  /* Cards in the deck — one event per card. */
  blades: number;
  voice: Voicing;
  /* Multipliers on every lowpass ceiling and every grain length. */
  bright: number;
  length: number;
}

interface Grain {
  count: number; // grains per card
  spacing: [number, number]; // seconds between grains
  attack: [number, number];
  decay: [number, number];
  cut: [number, number]; // lowpass ceiling at the first card, last card
  floor: number;
  tail: [number, number]; // level of the grains after the first
  /* Trim so every voicing lands at the same peak with the master at half. */
  level: number;
  /* How much of the sheet's low thup goes under each card. Zero skips it. */
  body: number;
  /* Playback rate range: below 1 darkens the noise itself. */
  rate?: [number, number];
}

const GRAINS: Record<Voicing, Grain> = {
  /* A fingertip on a leather pad: one soft, dull thud, nothing above about
     500 Hz, a couple of milliseconds to land and twenty to be gone. No grain
     on top, no tail. The default. */
  tap: {
    count: 1,
    spacing: [0, 0],
    attack: [0.002, 0.003],
    decay: [0.018, 0.028],
    cut: [520, 380],
    floor: 60,
    tail: [1, 1],
    level: 1.6,
    body: 0,
    rate: [0.5, 0.7],
  },
  /* One tiny dull tick per card, and not much of it. */
  click: {
    count: 1,
    spacing: [0, 0],
    attack: [0.0015, 0.0025],
    decay: [0.006, 0.01],
    cut: [2600, 1600],
    floor: 300,
    tail: [1, 1],
    level: 0.3,
    body: 0.3,
  },
  /* Three or four short grains: a dry crackle. */
  crackle: {
    count: 3.5,
    spacing: [0.005, 0.014],
    attack: [0.004, 0.007],
    decay: [0.025, 0.045],
    cut: [3200, 1800],
    floor: 300,
    tail: [0.25, 0.6],
    level: 1,
    body: 1,
  },
  /* One or two long soft grains: a card sliding, fff. The default. */
  brush: {
    count: 1.5,
    spacing: [0.02, 0.04],
    attack: [0.01, 0.018],
    decay: [0.07, 0.13],
    cut: [2600, 1500],
    floor: 220,
    tail: [0.4, 0.7],
    level: 0.55,
    body: 1,
  },
  /* One short grain: a card slipping past a thumb. Riffling a deck of cards
     is a run of these. */
  flick: {
    count: 1,
    spacing: [0, 0],
    attack: [0.002, 0.0035],
    decay: [0.012, 0.02],
    cut: [4200, 2400],
    floor: 400,
    tail: [1, 1],
    level: 0.5,
    body: 0.8,
  },
  /* Eight to ten tiny grains scattered over sixty milliseconds: a dense,
     stochastic rustle. */
  rustle: {
    count: 9,
    spacing: [0.002, 0.009],
    attack: [0.002, 0.004],
    decay: [0.008, 0.016],
    cut: [3000, 1800],
    floor: 300,
    tail: [0.3, 0.9],
    level: 1.8,
    body: 1,
  },
};

export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  at: number;
}

/* One noise buffer per context, shared by every voice. White noise through a
   one-pole lowpass in the fill loop gives a gentle tilt with a corner near
   5 kHz — enough top to read as paper, not so much that it turns to hiss.
   Normalised to RMS 0.25; every gain below assumes that. */
const buffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext) {
  let buffer = buffers.get(ctx);
  if (buffer) return buffer;
  const length = Math.floor(ctx.sampleRate * 2);
  buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let y = 0;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    y += 0.5 * (white - y);
    data[i] = y;
    sum += y * y;
  }
  const scale = 0.25 / Math.sqrt(sum / length);
  for (let i = 0; i < length; i++) data[i] *= scale;
  buffers.set(ctx, buffer);
  return buffer;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

interface Event {
  at: number; // seconds, absolute on the context clock
  /* Brightness: a lowpass cutoff. No bandpass anywhere — a bandpass gives a
     burst of noise a centre, and a centre is a pitch, and twelve pitches in a
     row are a glockenspiel. Paper has no centre. */
  cut: number;
  /* Floor: a highpass, so no body creeps in underneath. */
  floor: number;
  peak: number; // linear, before the master
  attack: number; // seconds
  decay: number; // seconds
  pan: number;
  rate: number; // playbackRate; tilts the noise a little per grain
}

/* The per-voice peaks are set against a measured render, not arithmetic:
   with the master at 0.5 the open riffle peaks around -31 dBFS, the hover
   around -40. Quiet enough to sit under the motion, loud enough to exist. */
const LEVEL = 5.5;

/* One grain. The gain is constructed at zero and every move on it is a ramp,
   so there is no instant at which it can step — which on a sound this quiet
   is the only thing that would be audible. */
function fire(ctx: BaseAudioContext, bus: AudioNode, e: Event, live: Voice[]) {
  const src = new AudioBufferSourceNode(ctx, {
    buffer: noise(ctx),
    playbackRate: e.rate,
  });
  const high = new BiquadFilterNode(ctx, {
    type: "highpass",
    frequency: e.floor,
    Q: 0.5,
  });
  const low = new BiquadFilterNode(ctx, {
    type: "lowpass",
    frequency: e.cut,
    Q: 0.5,
  });
  const gain = new GainNode(ctx, { gain: 0 });
  const pan = new StereoPannerNode(ctx, { pan: e.pan });
  const end = e.at + e.attack + e.decay;

  gain.gain.setValueAtTime(0, e.at);
  gain.gain.linearRampToValueAtTime(e.peak, e.at + e.attack);
  gain.gain.exponentialRampToValueAtTime(e.peak * 0.0032, end);
  gain.gain.linearRampToValueAtTime(0, end + 0.003);

  src.connect(high).connect(low).connect(gain).connect(pan).connect(bus);

  /* Every grain reads the shared buffer from a different place, which alone
     stops many of them sounding like one sample fired many times. */
  src.start(e.at, rand(0, 1.7), 0.12);
  src.stop(end + 0.006);

  const voice = { src, gain, at: e.at };
  live.push(voice);
  src.onended = () => {
    src.disconnect();
    high.disconnect();
    low.disconnect();
    gain.disconnect();
    pan.disconnect();
    const i = live.indexOf(voice);
    if (i >= 0) live.splice(i, 1);
  };
}

/* Schedule one gesture. `t0` is when the relevant beat starts on the audio
   clock: for "open" that is the start of the sweep (the turn before it is a
   rigid block turning — nothing shears, so it is silent, and that silence is
   what makes a -30 dBFS riffle register at all); for "close" it is the start of
   the close sweep; for "hover" it is now. */
export function schedule(
  ctx: BaseAudioContext,
  bus: AudioNode,
  gesture: Gesture,
  t0: number,
  p: SoundParams,
  live: Voice[]
) {
  if (gesture === "turn") {
    /* The shut stack swinging flat makes no sound of its own — it is one
       rigid block, nothing shears. What you hear is it locking into
       position at the end: one dull, muffled tick, nearly nothing. Quint
       has done 97% of the travel by half the window, so that is when it
       lands. */
    lock(ctx, bus, t0 + (p.turn / 1000) * 0.5, live);
    return;
  }

  if (gesture === "hover") {
    /* One card nudged under the finger: the same fingertip, softer. */
    fire(
      ctx,
      bus,
      {
        at: t0,
        cut: rand(420, 520),
        floor: 70,
        peak: 0.05 * LEVEL,
        attack: 0.002,
        decay: rand(0.016, 0.024),
        pan: rand(-0.1, 0.1),
        rate: rand(0.5, 0.65),
      },
      live
    );
    return;
  }

  const n = Math.max(3, Math.round(p.blades));
  const opening = gesture === "open";
  const sweep = (p.sweep / 1000) * (opening ? 1 : 0.78);
  const G = GRAINS[p.voice] ?? GRAINS.crackle;
  const bright = p.bright || 1;
  const length = p.length || 1;

  /* Ease-out-quint is 97% done by half its window, so the events finish
     around 0.62 of the sweep. Brightness and level run down with the
     velocity: the lowpass closes, the level drops five to one. Nothing
     descends in pitch, because nothing has one. */
  const rg = Math.pow(5, -1 / (n - 1));
  for (let k = 1; k <= n; k++) {
    const seat = k === n;
    const at = t0 + 0.62 * sweep * Math.pow(k / n, 1.55) + rand(-0.004, 0.004);
    const f = (k - 1) / (n - 1);
    const cut = (G.cut[0] + (G.cut[1] - G.cut[0]) * f) * bright * (opening ? 1 : 0.85);
    if (seat) {
      /* The fan arriving at its resting geometry: one soft, longer shh. */
      fire(
        ctx,
        bus,
        {
          at,
          cut: 450,
          floor: 60,
          peak: 0.02 * LEVEL,
          attack: 0.004,
          decay: 0.04,
          pan: -0.18,
          rate: 0.55,
        },
        live
      );
      continue;
    }
    /* The sheet itself, flexing as it lets go: a very low, very short thup
       under each card. It is most of what makes card sound like card rather
       than like sand. */
    if (G.body > 0) fire(
      ctx,
      bus,
      {
        at: at + 0.002,
        cut: rand(280, 380),
        floor: 90,
        peak: 0.02 * LEVEL * G.body * Math.pow(rg, k - 1) * (opening ? 1 : 0.8),
        attack: 0.004,
        decay: rand(0.03, 0.045),
        pan: 0.26 - (0.44 * (k - 1)) / (n - 1),
        rate: rand(0.55, 0.7),
      },
      live
    );
    const grains = Math.max(1, Math.round(G.count + rand(-0.5, 0.5)));
    let offset = 0;
    for (let g = 0; g < grains; g++) {
      if (g > 0) offset += rand(G.spacing[0], G.spacing[1]);
      fire(
        ctx,
        bus,
        {
          at: at + offset,
          cut: cut * rand(0.85, 1.15),
          floor: G.floor,
          /* Fewer grains per card need to carry more level each to land at
             the same peak; the square root keeps the sum roughly even. */
          peak:
            (0.026 * LEVEL * G.level * Math.pow(rg, k - 1) * (opening ? 1 : 0.8) *
              (g === 0 ? 1 : rand(G.tail[0], G.tail[1]))) /
            Math.sqrt(Math.max(1, G.count) / 4.5),
          attack: rand(G.attack[0], G.attack[1]) * length,
          decay: (rand(G.decay[0], G.decay[1]) + 0.001 * (k - 1)) * length,
          pan: 0.26 - (0.44 * (k - 1)) / (n - 1) + rand(-0.05, 0.05),
          rate: rand(...(G.rate ?? [0.8, 1.2])),
        },
        live
      );
    }
  }

  if (!opening) {
    /* And the same lock when the stack comes upright again at the end of
       the close turn. */
    lock(ctx, bus, t0 + sweep + (p.turn / 1000) * 0.78 * 0.5, live);
  }
}

/* The deck locking into position: very low, very short, almost numb. */
function lock(ctx: BaseAudioContext, bus: AudioNode, at: number, live: Voice[]) {
  fire(
    ctx,
    bus,
    {
      at,
      cut: rand(380, 460),
      floor: 60,
      peak: 0.012 * LEVEL,
      attack: 0.003,
      decay: rand(0.02, 0.03),
      pan: 0,
      rate: rand(0.5, 0.6),
    },
    live
  );
}

/* Interrupting a gesture mid-flight. Voices that haven't started yet are
   simply told to stop at their own start time, so they never play; voices in
   flight are held where they are and ramped out over a few milliseconds. No
   instant value assignment anywhere, so no pop. */
export function hush(ctx: BaseAudioContext, live: Voice[]) {
  const now = ctx.currentTime;
  for (const v of live) {
    if (v.at > now) {
      v.src.stop(v.at);
    } else {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.03);
      v.src.stop(now + 0.05);
    }
  }
}
