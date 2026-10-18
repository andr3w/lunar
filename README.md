# Lunar Lander

A browser lunar lander game with numbered levels, including cargo runs where the craft carries a load on a line.

Repository: https://github.com/andr3w/lunar

## Playing

Open `index.html` in a browser. There is no build step and nothing to install.

| Key | Action |
|---|---|
| Left / Right, or A / D | Rotate |
| Up, W or Space | Thrust |
| Space or Enter | Start, or continue after a level |
| Number, then Enter | Jump to that level |
| R | Restart from level 1 |

On touch screens, on-screen buttons appear below the game.

A safe landing needs both feet on the pad, with descent under 40, drift under 25 and tilt under 20°.

## Editing levels

Levels are defined by number in the `LEVELS` table at the top of `levels.js`. Each level's terrain is generated from its number, so it is the same on every attempt.

For testing cargo levels, add `?above` to the URL (`index.html?above`) to start with the craft hovering directly over the first load.
