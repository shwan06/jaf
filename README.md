# Maze Rush Runner 🏃‍♂️🌀

A fast, arcade-style **maze runner for Android**. Swipe to sprint your runner
through procedurally generated mazes — grab coins, dodge chasing enemies, and
reach the exit before the timer runs out. Every level is a fresh maze that
gets bigger and meaner.

Built **native** in Kotlin with a `SurfaceView` Canvas game loop — no game
engine required. It builds to a standard `.apk` / `.aab` and is ready to be
signed and published to Google Play.

> Looking for the design rationale and difficulty curve? See **[DESIGN.md](DESIGN.md)**.
> Ready to ship? See **[docs/PUBLISHING.md](docs/PUBLISHING.md)**.

---

## Gameplay

- **Controls:** swipe up / down / left / right. The runner slides tile-to-tile
  and keeps going in your chosen direction until it hits a wall (Pac-Man style).
- **Goal:** reach the green exit.
- **Coins:** amber pickups worth +10 each — optional bonus, plan your route.
- **Enemies:** red chasers pathfind toward you (but move slower than you do).
  Contact costs a life; you respawn at the start with a brief invulnerability.
- **Timer:** the bar at the top. Empty it and the run ends.
- **Score:** coins + `level × 100` on clear + leftover-time bonus.

Level 1 has no enemies so you can learn the swipe controls; difficulty ramps
from there.

---

## Project layout

```
.
├── app/
│   ├── build.gradle.kts            # App module: SDK levels, signing, build types
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/shwan/mazerunner/
│       │   ├── MainActivity.kt     # Activity host + immersive fullscreen
│       │   ├── GameView.kt         # SurfaceView: rendering, input, UI states
│       │   ├── GameThread.kt       # 60 FPS update/render loop
│       │   ├── GameWorld.kt        # Pure game logic (state, scoring, rules)
│       │   ├── Entities.kt         # Player / Enemy smooth tile movement
│       │   ├── Maze.kt             # Maze model + BFS pathfinding
│       │   └── MazeGenerator.kt    # Recursive-backtracker maze generation
│       └── res/                    # Theme, colors, adaptive launcher icon
├── build.gradle.kts                # Root build (plugin versions)
├── settings.gradle.kts
├── gradle/ + gradlew + gradlew.bat # Gradle wrapper (8.9)
└── DESIGN.md / docs/               # Design doc, publishing & privacy
```

The game logic in `GameWorld`, `Maze`, `MazeGenerator`, and `Entities` is
**pure Kotlin with no Android dependencies**, so it's unit-testable on the JVM
(see *Testing* below).

---

## Building

### Prerequisites

- **JDK 17+**
- **Android SDK** (via Android Studio, or `sdkmanager`) with:
  - Platform `android-34`
  - Build-Tools `34.x`
- Point the build at your SDK by creating `local.properties` in the repo root:

  ```properties
  sdk.dir=/path/to/your/Android/sdk
  ```

  (Android Studio writes this for you automatically when you open the project.)

### Easiest path

Open the folder in **Android Studio** (Giraffe or newer), let it sync, then
**Run** on an emulator or a USB-connected device.

### Command line

```bash
# Debug APK → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleDebug

# Install onto a connected device/emulator
./gradlew installDebug

# Release App Bundle for Play (requires signing config, see below)
./gradlew bundleRelease
```

---

## Signing & release

Release builds are signed from a keystore supplied via Gradle properties, so
**no secrets live in source control**. Create a keystore once:

```bash
keytool -genkey -v -keystore maze-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias maze
```

Then provide these properties at build time — e.g. in your **user-level**
`~/.gradle/gradle.properties` (recommended, never committed):

```properties
MAZE_KEYSTORE=/absolute/path/to/maze-release.jks
MAZE_KEYSTORE_PASSWORD=********
MAZE_KEY_ALIAS=maze
MAZE_KEY_PASSWORD=********
```

Now `./gradlew bundleRelease` produces a signed
`app/build/outputs/bundle/release/app-release.aab` ready for the Play Console.
If those properties are absent, the release build is simply left unsigned (so
debug builds still work out of the box).

See **[docs/PUBLISHING.md](docs/PUBLISHING.md)** for the full Google Play
checklist (store listing, content rating, privacy policy, testing tracks).

---

## Testing

The pure game logic has JVM unit tests
(`app/src/test/java/com/shwan/mazerunner/LogicTest.kt`) covering maze
connectivity, enemy pathfinding, player movement, full level traversal, and
the lose-on-timeout rule:

```bash
./gradlew testDebugUnitTest
```

> These five cases were validated during development in an isolated Kotlin/JVM
> Gradle project (the build container here has no Android SDK, only the JDK and
> Gradle) and all pass. They run on the JVM and need no device or emulator.

---

## Tech notes

- **Maze generation:** randomized depth-first search (recursive backtracker),
  iterative to avoid stack overflow on large grids. Produces a *perfect* maze.
- **Pathfinding:** breadth-first search from each enemy to the player's tile,
  recomputed when an enemy reaches a tile center.
- **Game loop:** fixed ~60 FPS with a clamped delta-time so a GC pause or
  backgrounding can't teleport entities.
- **Rendering:** everything is drawn with `Canvas` primitives and vector
  drawables — no bitmap assets, so the APK stays tiny.

## License

Add a license of your choice (e.g. MIT) before publishing the source.
