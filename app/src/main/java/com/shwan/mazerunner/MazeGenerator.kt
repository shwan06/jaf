package com.shwan.mazerunner

import kotlin.random.Random

/**
 * Procedural maze generation using the recursive-backtracker (randomized
 * depth-first search) algorithm. Produces a "perfect" maze: exactly one path
 * between any two passages, no loops.
 */
object MazeGenerator {

    /**
     * @param cols number of cells horizontally
     * @param rows number of cells vertically
     * @param random source of randomness (inject for deterministic tests)
     */
    fun generate(cols: Int, rows: Int, random: Random = Random.Default): Maze {
        val width = cols * 2 + 1
        val height = rows * 2 + 1
        val wall = BooleanArray(width * height) { true }

        fun cellTile(cx: Int, cy: Int) = Pair(cx * 2 + 1, cy * 2 + 1)
        fun openTile(x: Int, y: Int) {
            wall[y * width + x] = false
        }

        val visited = Array(rows) { BooleanArray(cols) }
        // Iterative DFS to avoid blowing the stack on large mazes.
        val stack = ArrayDeque<Pair<Int, Int>>()
        val startCx = 0
        val startCy = 0
        visited[startCy][startCx] = true
        cellTile(startCx, startCy).let { openTile(it.first, it.second) }
        stack.addLast(Pair(startCx, startCy))

        val dirs = listOf(
            Pair(0, -1), Pair(0, 1), Pair(-1, 0), Pair(1, 0)
        )

        while (stack.isNotEmpty()) {
            val (cx, cy) = stack.last()
            val neighbors = dirs
                .map { Pair(cx + it.first, cy + it.second) }
                .filter { (nx, ny) -> nx in 0 until cols && ny in 0 until rows && !visited[ny][nx] }

            if (neighbors.isEmpty()) {
                stack.removeLast()
                continue
            }

            val (nx, ny) = neighbors[random.nextInt(neighbors.size)]
            visited[ny][nx] = true

            // Knock out the wall tile between the current cell and the neighbor.
            val (ctx, cty) = cellTile(cx, cy)
            val (ntx, nty) = cellTile(nx, ny)
            openTile((ctx + ntx) / 2, (cty + nty) / 2)
            openTile(ntx, nty)

            stack.addLast(Pair(nx, ny))
        }

        val start = cellTile(0, 0).let { Cell(it.first, it.second) }
        val exit = cellTile(cols - 1, rows - 1).let { Cell(it.first, it.second) }
        return Maze(width, height, wall, start, exit)
    }
}
