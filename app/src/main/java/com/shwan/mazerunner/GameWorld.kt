package com.shwan.mazerunner

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.random.Random

/** Outcome of a single [GameWorld.update] tick, consumed by the view layer. */
enum class WorldEvent { NONE, LIFE_LOST, GAME_OVER, LEVEL_COMPLETE }

/**
 * Holds all mutable gameplay state for the current level and advances the
 * simulation. Rendering and input live in [GameView]; this class is pure
 * game logic so it can be reasoned about (and unit tested) on its own.
 */
class GameWorld(private val random: Random = Random.Default) {

    lateinit var maze: Maze
        private set
    lateinit var player: Player
        private set
    val enemies = ArrayList<Enemy>()
    val coins = ArrayList<Cell>()

    var level = 1
        private set
    var lives = 3
        private set
    var score = 0
        private set
    var timeRemaining = 0f
        private set
    var levelDuration = 0f
        private set

    private var invulnerability = 0f
    val isInvulnerable: Boolean get() = invulnerability > 0f

    /** (Re)build everything for the start of a fresh run. */
    fun startNewGame() {
        level = 1
        lives = 3
        score = 0
        buildLevel()
    }

    fun advanceLevel() {
        level++
        buildLevel()
    }

    private fun buildLevel() {
        val cells = (6 + level).coerceAtMost(16)
        maze = MazeGenerator.generate(cells, cells, random)

        val playerSpeed = 6f
        player = Player(maze.start, playerSpeed)

        // Candidate tiles for spawning, excluding tiles near the start.
        val open = maze.openTiles().filter {
            it != maze.start && it != maze.exit &&
                manhattan(it, maze.start) > 4
        }.toMutableList()
        open.shuffle(random)

        // Coins: a bonus to chase, scaling with level.
        coins.clear()
        val coinCount = (5 + level * 2).coerceAtMost(open.size)
        repeat(coinCount) { coins.add(open.removeAt(open.size - 1)) }

        // Enemies: none on level 1 (a gentle intro), then ramping up.
        enemies.clear()
        val enemyCount = (level - 1).coerceIn(0, 6)
        val enemySpeed = (2.5f + level * 0.2f).coerceAtMost(4.5f)
        repeat(enemyCount.coerceAtMost(open.size)) {
            enemies.add(Enemy(open.removeAt(open.size - 1), enemySpeed))
        }

        // Time budget scales with maze size; running out ends the run.
        levelDuration = maze.openTiles().size * 0.9f + 20f
        timeRemaining = levelDuration
        invulnerability = 1.5f
    }

    fun setPlayerDirection(dir: Direction) {
        player.desiredDir = dir
    }

    fun update(dt: Float): WorldEvent {
        if (invulnerability > 0f) invulnerability -= dt

        timeRemaining -= dt
        if (timeRemaining <= 0f) {
            timeRemaining = 0f
            lives = 0
            return WorldEvent.GAME_OVER
        }

        player.update(dt, maze)
        val playerTile = Cell(Math.round(player.px), Math.round(player.py))
        enemies.forEach { it.update(dt, maze, playerTile) }

        collectCoins(playerTile)

        // Reaching the exit completes the level.
        if (playerTile == maze.exit) {
            score += level * 100 + timeRemaining.toInt() * 2
            return WorldEvent.LEVEL_COMPLETE
        }

        // Enemy contact (unless briefly invulnerable after a respawn).
        if (!isInvulnerable && hitByEnemy()) {
            lives--
            if (lives <= 0) return WorldEvent.GAME_OVER
            player.resetTo(maze.start)
            invulnerability = 1.5f
            return WorldEvent.LIFE_LOST
        }

        return WorldEvent.NONE
    }

    private fun collectCoins(playerTile: Cell) {
        val it = coins.iterator()
        while (it.hasNext()) {
            if (it.next() == playerTile) {
                it.remove()
                score += 10
            }
        }
    }

    private fun hitByEnemy(): Boolean = enemies.any {
        hypot(it.px - player.px, it.py - player.py) < 0.6f
    }

    private fun manhattan(a: Cell, b: Cell): Int = abs(a.x - b.x) + abs(a.y - b.y)
}
