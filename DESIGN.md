# Maze Rush Runner — Game Design Doc

A short, living design doc for the maze-runner game. Keep it to a couple of
pages; update it as the game evolves.

## 1. Concept

A fast, pick-up-and-play **maze runner**. Swipe to send your runner sprinting
through procedurally generated mazes. Grab coins, dodge chasing enemies, and
reach the exit before the clock runs out. Every level is a freshly generated
maze, so it never plays the same twice.

- **Platform:** Android (phones & tablets), portrait orientation.
- **Session length:** 30–90 seconds per level — ideal for short sessions.
- **Tone:** bright, arcade, neon-on-dark.

## 2. Core loop

```
Run → navigate maze → grab coins → dodge enemies → reach exit → next level (harder)
```

Lose a life on enemy contact (with a brief invulnerability flash on respawn).
Run out of lives or time → Game Over → see your score → play again.

## 3. Mechanics

| System | Decision |
|--------|----------|
| **Camera** | Top-down, whole maze fits on screen |
| **Maze** | Procedural — recursive-backtracker (perfect maze, one solution path) |
| **Controls** | Swipe in any of 4 directions; runner slides tile-to-tile, Pac-Man style |
| **Win condition** | Reach the exit tile |
| **Lose conditions** | Lives reach 0 (enemy contact) **or** the level timer hits 0 |
| **Enemies** | Chasers that pathfind toward the player via BFS; slower than the player so escape is always possible |
| **Pickups** | Coins (bonus score). Optional to collect — risk vs. reward |
| **Progression** | Each level grows the maze, speeds up & adds enemies, up to caps |
| **Economy** | Score from coins (+10), level clear (+level×100), and leftover time (×2) |

### Difficulty curve (per level `L`)

- Maze size: `min(6 + L, 16)` cells square.
- Enemies: `clamp(L - 1, 0..6)` — level 1 is enemy-free to teach controls.
- Enemy speed: `min(2.5 + 0.2·L, 4.5)` tiles/s (player is a constant 6 tiles/s).
- Coins: `min(5 + 2·L, available)`.
- Timer: `openTiles × 0.9 + 20` seconds.

## 4. Screens

- **Main menu** — title + "Tap to play".
- **HUD** — level, coins remaining, score, lives, time bar, pause (top-right).
- **Pause** — tap to resume.
- **Level complete** — score so far, tap for next level.
- **Game over** — level reached + final score, tap to return to menu.

## 5. Art & audio direction

- **Palette:** deep indigo background, purple walls, gold runner, red chasers,
  green exit, amber coins. (All currently drawn as vector primitives — no
  binary art assets required to ship.)
- **Audio (future):** light background loop; SFX for coin, hit, level-clear.
  Hooks are easy to add in `GameWorld.update` event points.

## 6. Roadmap beyond v1

- Audio (music + SFX) and haptics on coin/hit.
- Power-ups: speed boost, freeze, extra life, coin magnet.
- Persistent high score (SharedPreferences) and daily challenge seed.
- Skins/themes unlocked with coins.
- Monetization: rewarded ad for "continue", one-time "remove ads" IAP.
- Analytics: level reached, deaths, session length.
