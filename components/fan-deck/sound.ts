/* The deck's sound: paper, synthesised.

   Paper is filtered noise with a fast envelope, so it is cheaper and truer to
   synthesise than to ship. Each card peeling off the one under it is one
   stick-slip event — a burst of bandpassed noise a few tens of milliseconds
   long. The open is twelve of those laid across the sweep, front-loaded where
   ease-out-quint puts the velocity, and running down in brightness and level
   as the fan slows: the outermost card carries the least load and travels
   fastest, so it goes first and brightest; the card buried under ten others
   goes last, low and soft. That descent is what keeps twelve ticks from being
   a machine gun — they are twelve stages of one thing running down, not twelve
   copies of one thing.

   Everything is scheduled on the audio clock against a BaseAudioContext, so
   the same code renders into an OfflineAudioContext for measurement. Nothing
   here creates the live context; the component does that on the first real
   gesture, because browsers refuse audio before one. */

export type Gesture = "turn" | "open" | "close" | "hover";

export interface SoundParams {
  /* Ms. Open is turn then sweep; close is sweep then turn. */
  turn: number;
  sweep: number;
  /* Cards in the deck — one event per card. */
  blades: number;
}

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
  fc: number; // bandpass centre
  q: number;
  peak: number; // linear, before the master
  decay: number; // seconds
  pan: number;
  /* The hover slide gets an extra lowpass: at 3 mm/s nothing generates top
     end, and any 5 kHz content reads as a click rather than a slide. */
  slide?: boolean;
}

/* Paper has no click in it. A card slipping is a brush, not a tap: the burst
   swells over several milliseconds and dies over tens of them, wide-band and
   diffuse — so each card is a small cluster of grains, not one strike. */
const ATTACK = 0.007;

/* The per-voice peaks below were set by ear-of-mind and came out ~18 dB shy
   when rendered — a bandpass at Q 1.1 passes only a sliver of the buffer's
   energy. Measured with the master at 0.5: the open riffle now peaks around
   -31 dBFS, the hover around -42. Quiet enough to sit under the motion, loud
   enough to exist. (Wider bands pass more energy than the narrow ones this
   was first set against, hence lower than it was.) */
const LEVEL = 5.5;

/* One event. The gain is constructed at zero and every move on it is a ramp,
   so there is no instant at which it can step — which on a sound this quiet
   is the only thing that would be audible. */
function fire(ctx: BaseAudioContext, bus: AudioNode, e: Event, live: Voice[]) {
  const src = new AudioBufferSourceNode(ctx, { buffer: noise(ctx) });
  const band = new BiquadFilterNode(ctx, {
    type: "bandpass",
    frequency: e.fc,
    Q: e.q,
  });
  /* Nothing below the low-mids at all: body down there is what makes a burst
     read as wood knocking rather than card slipping. It also keeps the object
     small and near, which is what paper is. */
  const high = new BiquadFilterNode(ctx, {
    type: "highpass",
    frequency: e.slide ? 900 : 1300,
    Q: 0.707,
  });
  /* A rolled top: paper has no glass in it. */
  const low = new BiquadFilterNode(ctx, {
    type: "lowpass",
    frequency: e.slide ? 4200 : 6500,
    Q: 0.707,
  });
  const gain = new GainNode(ctx, { gain: 0 });
  const pan = new StereoPannerNode(ctx, { pan: e.pan });
  const end = e.at + ATTACK + e.decay;

  gain.gain.setValueAtTime(0, e.at);
  gain.gain.linearRampToValueAtTime(e.peak, e.at + ATTACK);
  gain.gain.exponentialRampToValueAtTime(e.peak * 0.0032, end);
  gain.gain.linearRampToValueAtTime(0, end + 0.003);

  src.connect(band).connect(high).connect(low).connect(gain).connect(pan).connect(bus);

  /* Every voice reads the shared buffer from a different place, which alone
     stops twelve of them sounding like one sample fired twelve times. */
  src.start(e.at, rand(0, 1.7), 0.12);
  src.stop(end + 0.006);

  const voice = { src, gain, at: e.at };
  live.push(voice);
  src.onended = () => {
    src.disconnect();
    band.disconnect();
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
    /* The shut stack swinging flat. Nothing shears — it is one rigid block —
       but a block that size moving that fast whisks air and pivots on the
       rivet, and without it the open feels late: the riffle can't start
       until the sweep does, 720 ms after the click. One dark, breathy swish,
       front-loaded like the quint that drives it, well under the riffle. */
    fire(
      ctx,
      bus,
      {
        at: t0,
        fc: rand(1400, 1800),
        q: 0.35,
        peak: 0.0055 * LEVEL,
        decay: rand(0.18, 0.24),
        pan: -0.12,
        slide: true,
      },
      live
    );
    return;
  }

  if (gesture === "hover") {
    /* One card face dragging a millimetre across two neighbours. No impact,
       just static friction letting go: darker, slower and quieter than
       anything in the riffle. */
    fire(
      ctx,
      bus,
      {
        at: t0,
        fc: rand(1800, 2200),
        q: 0.4,
        peak: 0.0075 * LEVEL * 1.25,
        decay: rand(0.05, 0.07),
        pan: rand(-0.1, 0.1),
        slide: true,
      },
      live
    );
    return;
  }

  const n = Math.max(3, Math.round(p.blades));
  const opening = gesture === "open";
  const sweep = (p.sweep / 1000) * (opening ? 1 : 0.78);

  /* Ease-out-quint is 97% done by half its window, so the events finish around
     0.62 of the sweep — the last few percent of travel are invisible and would
     be inaudible. Brightness and level both run down with the velocity. */
  /* Brightness runs 3.6 kHz down to 2 — a paper "shh" sits there; higher
     was glass, lower was wood. Level runs five to one. Each card is a cluster
     of two or three grains a few milliseconds apart with their own levels, so
     the run is a rustle rather than a row of taps. */
  const rf = Math.pow(1.8, -1 / (n - 1));
  const rg = Math.pow(5, -1 / (n - 1));
  for (let k = 1; k <= n; k++) {
    const seat = k === n;
    const at = t0 + 0.62 * sweep * Math.pow(k / n, 1.55) + rand(-0.004, 0.004);
    /* Gathering in, the cards arrive rather than peel: the same run, a shade
       darker and softer. */
    const dark = opening ? 1 : 0.9;
    const grains = seat ? 1 : 2 + Math.round(Math.random());
    for (let g = 0; g < grains; g++) {
      fire(
        ctx,
        bus,
        {
          at: at + g * rand(0.006, 0.016),
          fc: (seat ? 1800 : 3600 * Math.pow(rf, k - 1)) * dark * rand(0.9, 1.1),
          /* Wide. A narrow band rings, and a ring is a pitch; paper has none. */
          q: seat ? 0.35 : 0.4,
          peak:
            0.03 * LEVEL * Math.pow(rg, k - 1) * (opening ? 1 : 0.8) *
            (g === 0 ? 1 : rand(0.35, 0.7)),
          decay: seat ? 0.09 : rand(0.038, 0.06) + 0.0012 * (k - 1),
          pan: 0.26 - (0.44 * (k - 1)) / (n - 1) + rand(-0.04, 0.04),
        },
        live
      );
    }
  }

  if (!opening) {
    /* The stack coming to rest at the end of the close turn. Not a tap — a
       tap is wood — but the cards settling against each other: a soft, bright
       breath. Quint has done most of the travel early, so it sits a third of
       the way into that beat, not at its end. */
    const turn = (p.turn / 1000) * 0.78;
    fire(
      ctx,
      bus,
      {
        at: t0 + sweep + turn * 0.3,
        fc: rand(1600, 2100),
        q: 0.35,
        peak: 0.016 * LEVEL,
        decay: rand(0.09, 0.12),
        pan: 0,
        slide: true,
      },
      live
    );
  }
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
