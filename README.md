# Interactive Fan Deck

Fan color deck in code for a more playful web.

A colour fan deck — the riveted stack of paper cards a paint shop hands you —
rebuilt as a React component. Click the deck and it swings flat, then draws a
half circle; the cards are paper, with grain, a lit cut edge and a rivet, and
they sound like paper when they move.

**Live:** https://eduardwieandt.com/playground/fan-deck

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. In development a [DialKit](https://dialkit.dev)
panel sits top-right with every parameter on a dial — blades, spread, hinge
corner, palette, the motion's timings and curves, the sound, and the copy's
sizes and distances. The panel is development-only; it is not in the
production build.

## How it is built

- **Geometry.** Every dimension hangs off one blade width, which is derived
  from the radius the fan may sweep, so the deck scales off the viewport
  with nothing measured in JavaScript. The pivot is the rivet hole, set into
  the corner of the card rather than its centreline — that off-axis pivot is
  what gives a real deck its spray.
- **Motion.** Opening is three beats: the shut deck slides into position while
  the copy fades, turns flat, then sweeps into the half circle with every gap
  equal at every frame. Closing runs them back, a little quicker. On a phone
  the deck stands upright and turns a quarter as it opens, so the fan lies
  down the long axis of the screen.
- **Paper.** One seamless scan of coated card (ambientCG Paper001, CC0),
  high-passed to keep the tooth and lose the mottling, laid on in two passes
  that cross-fade by how light the stock is. The cut edge is its own layer.
- **Shadow.** The deck casts one shadow, computed from the silhouette of all
  its cards together, so overlap cannot pile twelve shadows up. Each card
  keeps only the contact shade it drops on the card beneath.
- **Sound.** Synthesised with the Web Audio API — no files. Each card peeling
  off the one under it is one burst of bandpassed noise; the open is twelve of
  those laid across the sweep and running down in brightness as the fan slows.
  Nothing plays before a user gesture. See `components/fan-deck/sound.ts`.
- **Colour.** Palettes are ramps of stock. The default drifts: one ramp of
  lightness and chroma in OKLCH whose hue turns a few degrees a second. The
  headline and the button wear the deck's darkest stop, so they drift with it.

## Files

```
components/fan-deck/FanDeck.tsx         the deck, the page copy, the dials
components/fan-deck/FanDeck.module.css  geometry, paper, shadow, motion
components/fan-deck/sound.ts            the paper, synthesised
public/paper.webp, paper-hi.webp        the stock (ambientCG Paper001, CC0)
```

## License

MIT — see [LICENSE](LICENSE). The paper texture is derived from
[ambientCG Paper001](https://ambientcg.com/view?id=Paper001), CC0.
