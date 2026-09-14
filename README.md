# Interactive Fan Deck

Fan color deck in code for a more playful web.

I rebuilt a color fan deck in code. Used to play with them a lot as a kid.
Click it and it swings open into a half circle. The cards have paper grain,
a light cut edge and a rivet, and they sound like paper when they move.

Live: https://eduardwieandt.com/playground/fan-deck

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. In dev there is a [DialKit](https://dialkit.dev)
panel top right. Every value is on a dial: blades, spread, hinge corner,
palette, timings, easing, sound, and the sizes and spacing of the copy. The
panel is dev only. It is not part of the production build.

## How it works

**Geometry.** Everything is based on one blade width. That width comes from
how far the fan is allowed to sweep, so the whole deck scales with the
viewport. Nothing is measured in JavaScript. The pivot is the rivet hole in
the corner of the card, not the center line. That is what gives a real deck
its spread.

**Motion.** Opening happens in three steps. The closed deck slides into
position while the copy fades out. Then it turns flat. Then it sweeps into
the half circle, with all gaps equal in every frame. Closing is the same in
reverse, a bit faster. On mobile the deck stands upright and turns 90 degrees
while it opens, so the fan fits the tall screen.

**Paper.** One seamless scan of coated card (ambientCG Paper001, CC0). High
passed to keep the grain and lose the blotches. Applied in two layers that
cross fade depending on how light the card is. The cut edge is its own layer.

**Shadow.** The deck casts one shadow from the outline of all cards together,
so overlapping cards do not stack twelve shadows. Each card only keeps the
small contact shadow it drops on the card below.

**Sound.** Made with the Web Audio API, no audio files. Every card that peels
off the one below is a small crackle of broadband noise. The open is twelve of
those spread across the sweep, getting darker as the fan slows down. There is
no bandpass anywhere, so nothing rings. Nothing plays before you interact.
See `components/fan-deck/sound.ts`.

**Color.** Palettes are ramps. The default one drifts: lightness and chroma
stay the same, the hue turns a few degrees per second. The headline and the
button use the darkest card, so they drift with it.

## Files

```
components/fan-deck/FanDeck.tsx         the deck, the page copy, the dials
components/fan-deck/FanDeck.module.css  geometry, paper, shadow, motion
components/fan-deck/sound.ts            the paper sound
public/paper.webp, paper-hi.webp        the paper texture (ambientCG Paper001, CC0)
```

## License

MIT, see [LICENSE](LICENSE). The paper texture is based on
[ambientCG Paper001](https://ambientcg.com/view?id=Paper001), CC0.
