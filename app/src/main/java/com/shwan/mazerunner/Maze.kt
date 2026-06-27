package com.shwan.mazerunner

import java.util.ArrayDeque

/**
 * A maze stored as a tile grid where [wall] is `true` for solid cells and
 * `false` for walkable passages. The grid dimensions are always odd
 * ([width] = cols*2+1, [height] = rows*2+1) so that cell tiles sit on odd
 * coordinates with wall tiles between them.
 */
class Maze(
    val width: Int,
    val height: Int,
    private val wall: BooleanArray,
    val start: Cell,
    val exit: Cell,
) {
    fun isWall(x: Int, y: Int): Boolean {
        if (x < 0 || y < 0 || x >= width || y >= height) return true
        return wall[y * width + x]
    }

    fun isOpen(x: Int, y: Int): Boolean = !isWall(x, y)

    /** All walkable tiles, useful for placing coins and enemies. */
    fun openTiles(): List<Cell> {
        val result = ArrayList<Cell>()
        for (y in 0 until height) {
            for (x in 0 until width) {
                if (!wall[y * width + x]) result.add(Cell(x, y))
            }
        }
        return result
    }

    /**
     * Breadth-first search returning the next step from [from] toward [to]
     * along a shortest path, or `null` if no path exists or already there.
     * Enemies call this to chase the player.
     */
    fun nextStepToward(from: Cell, to: Cell): Cell? {
        if (from == to) return null
        val prev = HashMap<Cell, Cell>()
        val visited = HashSet<Cell>()
        val queue = ArrayDeque<Cell>()
        queue.add(from)
        visited.add(from)
        while (queue.isNotEmpty()) {
            val cur = queue.poll()
            if (cur == to) break
            for (dir in Direction.entries) {
                val nx = cur.x + dir.dx
                val ny = cur.y + dir.dy
                if (isWall(nx, ny)) continue
                val next = Cell(nx, ny)
                if (next in visited) continue
                visited.add(next)
                prev[next] = cur
                queue.add(next)
            }
        }
        if (to !in prev && to != from) return null
        // Walk back from the target to the tile adjacent to `from`.
        var step = to
        while (prev[step] != null && prev[step] != from) {
            step = prev[step]!!
        }
        return if (prev[step] == from) step else null
    }
}

data class Cell(val x: Int, val y: Int)

enum class Direction(val dx: Int, val dy: Int) {
    UP(0, -1),
    DOWN(0, 1),
    LEFT(-1, 0),
    RIGHT(1, 0),
}
