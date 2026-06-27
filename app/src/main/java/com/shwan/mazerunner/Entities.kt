package com.shwan.mazerunner

/**
 * Base class for anything that slides smoothly from tile to tile on the maze
 * grid. [px]/[py] are the rendered position in tile units; [cx]/[cy] are the
 * last tile fully occupied; [tx]/[ty] are the tile being moved into.
 */
abstract class Mover(start: Cell) {
    var cx = start.x
    var cy = start.y
    var tx = start.x
    var ty = start.y
    var px = start.x.toFloat()
    var py = start.y.toFloat()
    var dir: Direction? = null

    val atTarget: Boolean get() = px == tx.toFloat() && py == ty.toFloat()

    fun resetTo(cell: Cell) {
        cx = cell.x; cy = cell.y
        tx = cell.x; ty = cell.y
        px = cell.x.toFloat(); py = cell.y.toFloat()
        dir = null
    }

    /** Linear move of [px]/[py] toward the current target tile. */
    protected fun advance(distance: Float) {
        px = approach(px, tx.toFloat(), distance)
        py = approach(py, ty.toFloat(), distance)
    }

    private fun approach(value: Float, target: Float, maxDelta: Float): Float {
        val diff = target - value
        if (kotlin.math.abs(diff) <= maxDelta) return target
        return value + maxDelta * (if (diff > 0) 1f else -1f)
    }
}

/**
 * Player-controlled runner. Movement is "junction based": a queued
 * [desiredDir] is applied the moment the runner lines up with a tile and the
 * chosen direction is open — giving a responsive Pac-Man-style feel.
 */
class Player(start: Cell, var speed: Float) : Mover(start) {
    var desiredDir: Direction? = null

    fun update(dtSeconds: Float, maze: Maze) {
        if (atTarget) {
            cx = tx; cy = ty
            val d = desiredDir
            if (d != null && maze.isOpen(cx + d.dx, cy + d.dy)) {
                dir = d
            } else if (dir != null && !maze.isOpen(cx + dir!!.dx, cy + dir!!.dy)) {
                dir = null
            }
            dir?.let {
                tx = cx + it.dx
                ty = cy + it.dy
            }
        }
        advance(speed * dtSeconds)
    }
}

/**
 * Chasing enemy. On reaching a tile it recomputes a shortest path toward the
 * player via BFS and steps along it. Slower than the player so the maze stays
 * fair.
 */
class Enemy(start: Cell, var speed: Float) : Mover(start) {

    fun update(dtSeconds: Float, maze: Maze, playerTile: Cell) {
        if (atTarget) {
            cx = tx; cy = ty
            val next = maze.nextStepToward(Cell(cx, cy), playerTile)
            if (next != null) {
                tx = next.x
                ty = next.y
            }
        }
        advance(speed * dtSeconds)
    }
}
