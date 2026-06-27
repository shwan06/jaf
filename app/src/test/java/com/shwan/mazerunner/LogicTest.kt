package com.shwan.mazerunner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.ArrayDeque
import kotlin.random.Random

class LogicTest {

    private fun reachableCount(maze: Maze): Int {
        val visited = HashSet<Cell>()
        val q = ArrayDeque<Cell>()
        q.add(maze.start); visited.add(maze.start)
        while (q.isNotEmpty()) {
            val c = q.poll()
            for (d in Direction.entries) {
                val n = Cell(c.x + d.dx, c.y + d.dy)
                if (maze.isOpen(n.x, n.y) && visited.add(n)) q.add(n)
            }
        }
        return visited.size
    }

    @Test
    fun generatorProducesPerfectConnectedMaze() {
        repeat(20) { seed ->
            val maze = MazeGenerator.generate(8, 10, Random(seed.toLong()))
            assertEquals(8 * 2 + 1, maze.width)
            assertEquals(10 * 2 + 1, maze.height)
            assertTrue("start must be open", maze.isOpen(maze.start.x, maze.start.y))
            assertTrue("exit must be open", maze.isOpen(maze.exit.x, maze.exit.y))
            // A perfect maze: every open tile is reachable from the start.
            assertEquals(maze.openTiles().size, reachableCount(maze))
        }
    }

    @Test
    fun nextStepTowardMovesCloser() {
        val maze = MazeGenerator.generate(6, 6, Random(42))
        val step = maze.nextStepToward(maze.start, maze.exit)
        assertNotNull("a path to the exit must exist", step)
        assertTrue("step must be an open tile", maze.isOpen(step!!.x, step.y))
        assertTrue(
            "step must be adjacent to start",
            kotlin.math.abs(step.x - maze.start.x) + kotlin.math.abs(step.y - maze.start.y) == 1
        )
        // Standing on the target yields no step.
        assertNull(maze.nextStepToward(maze.exit, maze.exit))
    }

    @Test
    fun playerSlidesTowardOpenDirection() {
        val maze = MazeGenerator.generate(6, 6, Random(7))
        val player = Player(maze.start, speed = 6f)
        // The tile to the right of (1,1) is the wall between cells; find an open neighbor instead.
        val open = Direction.entries.first { maze.isOpen(maze.start.x + it.dx, maze.start.y + it.dy) }
        player.desiredDir = open
        repeat(20) { player.update(1f / 60f, maze) }
        assertTrue(
            "player should have advanced from the start tile",
            player.px != maze.start.x.toFloat() || player.py != maze.start.y.toFloat()
        )
    }

    @Test
    fun playerCanTraverseToExitCompletingLevel() {
        val world = GameWorld(Random(123))
        world.startNewGame() // level 1 has no enemies
        assertEquals(1, world.level)
        assertTrue(world.coins.isNotEmpty())

        var event = WorldEvent.NONE
        val dt = 1f / 60f
        var frames = 0
        while (frames < 60 * 60) { // 60s sim cap
            // Steer toward the exit along the shortest path at each junction.
            val tile = Cell(Math.round(world.player.px), Math.round(world.player.py))
            world.maze.nextStepToward(tile, world.maze.exit)?.let { next ->
                val dir = Direction.entries.first { it.dx == next.x - tile.x && it.dy == next.y - tile.y }
                world.setPlayerDirection(dir)
            }
            event = world.update(dt)
            if (event == WorldEvent.LEVEL_COMPLETE || event == WorldEvent.GAME_OVER) break
            frames++
        }
        assertEquals(WorldEvent.LEVEL_COMPLETE, event)
        assertTrue("score should be awarded on completion", world.score > 0)
    }

    @Test
    fun runningOutOfTimeEndsTheGame() {
        val world = GameWorld(Random(1))
        world.startNewGame()
        var event = WorldEvent.NONE
        // Sit still; the clock should eventually run out.
        repeat(100_000) {
            event = world.update(0.05f)
            if (event == WorldEvent.GAME_OVER) return@repeat
        }
        assertEquals(WorldEvent.GAME_OVER, event)
        assertEquals(0, world.lives)
    }
}
