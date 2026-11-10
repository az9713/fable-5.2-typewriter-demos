# Typewriter desks: 1897, 1927, 1962

Three writing desks in the browser. Each desk has a typewriter that you type on, a record player of the same period, and a room. The 3D scenes use three.js. The code makes all sounds and all music at run time. The repository holds no audio file and no image file.

**[Run the live demo](https://az9713.github.io/fable-5.2-typewriter-demos/)** — [1897](https://az9713.github.io/fable-5.2-typewriter-demos/?setting=a) · [1927](https://az9713.github.io/fable-5.2-typewriter-demos/?setting=b) · [1962](https://az9713.github.io/fable-5.2-typewriter-demos/?setting=c)

Written by Claude Fable 5.2.

## The three settings

| Setting | Address | Typewriter | Record player |
| --- | --- | --- | --- |
| 1897, a news office | `index.html?setting=a` | Remington Standard No. 2 | Edison cylinder phonograph |
| 1927, a writer's room | `index.html?setting=b` | Remington Portable No. 2 | Victor Orthophonic Victrola |
| 1962, an office | `index.html?setting=c` | IBM Selectric | AR XA turntable |

A control in the top row changes the setting. Three views are available: Machine, Line and Room.

## How to run it

Use the live demo above, or run the files from your disk:

1. Download or clone the repository.
2. Open `index.html` in a desktop browser. A double-click on the file is sufficient; a web server is not necessary.
3. Press a key or click the picture. This first key starts the machine and its sound. This first key does not print.

The page needs an internet connection: it loads three.js 0.186.1 from the jsDelivr network. No other library is used.

## Keys

| Key | Function |
| --- | --- |
| Letter, number and punctuation keys | Type. The page reads the position of the key, not the letter on the key. |
| Escape | Release a jam (1897 and 1927). |
| Backquote | Lift the carriage to see the line (1897). Motor switch (1962). |
| Arrow down | Index key: move the paper up one line (1962). |

Fast typing jams the type bars of the 1897 and the 1927 machines. The real machines do the same.

## Other functions

- New sheet, with a paper motion.
- The browser keeps the sheets in its local storage (IndexedDB). A "Pages" reader shows the sheets and exports a sheet as an image or as text.
- A touch keyboard control.
- A switch "Machine sound: 1 / 2" selects one of two versions of the machine sounds.
- `listen.html` is a test page with one button for each sound.

## Files

| File | Content |
| --- | --- |
| `index.html` | The page: setting choice, sound worklet, input, storage, reader, controls |
| `synth.js` | All sounds and music, as pure functions `(sampleRate, seed, params) → Float32Array` |
| `engine.js`, `engine-a.js`, `engine-c.js` | The mechanisms of the 1927, the 1897 and the 1962 machine |
| `scene-b.js`, `scene-a.js`, `scene-c.js` | The 3D scenes of the 1927, the 1897 and the 1962 setting |
| `listen.html` | Listening test page |
| `check.mjs`, `check-engine*.mjs` | Check scripts |
| `reference.md` | Research on the machines, the record players and the rooms, with sources |

## Checks

The check scripts need Node.js and no package.

```
node check.mjs
node check-engine.mjs
node check-engine-a.mjs
node check-engine-c.mjs
```

The scripts check the sounds and the mechanisms as numbers. The scripts do not check the pictures.

## Limits

- Many numeric values of the mechanisms and of the sounds are estimates. `reference.md` and the parameter block of `synth.js` mark each estimate.
- On some music seeds, the first note of a bass or chord instrument is missing.
- In the Line view of the 1927 setting, the ribbon guide hides the start of the second line.
- Touch input was not tested on a real device.
- The frame rate was measured on one laptop with a discrete GPU only.
