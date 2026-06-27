package com.shwan.mazerunner

import android.graphics.Canvas
import android.view.SurfaceHolder

/**
 * Fixed-effort render/update loop running on its own thread. Each iteration
 * computes a real delta time (clamped to avoid huge jumps after a stall) and
 * asks the [GameView] to step the simulation and draw.
 */
class GameThread(
    private val surfaceHolder: SurfaceHolder,
    private val gameView: GameView,
) : Thread() {

    @Volatile
    var running = false

    private val targetFps = 60
    private val frameTimeNanos = 1_000_000_000L / targetFps

    override fun run() {
        var lastTime = System.nanoTime()
        while (running) {
            val frameStart = System.nanoTime()
            var dt = (frameStart - lastTime) / 1_000_000_000f
            lastTime = frameStart
            // Clamp so a GC pause or backgrounding can't teleport entities.
            if (dt > 0.05f) dt = 0.05f

            var canvas: Canvas? = null
            try {
                canvas = surfaceHolder.lockCanvas()
                if (canvas != null) {
                    synchronized(surfaceHolder) {
                        gameView.update(dt)
                        gameView.render(canvas)
                    }
                }
            } finally {
                if (canvas != null) {
                    try {
                        surfaceHolder.unlockCanvasAndPost(canvas)
                    } catch (_: Exception) {
                        // Surface may have been destroyed mid-frame; ignore.
                    }
                }
            }

            // Sleep the remainder of the frame budget to cap CPU/battery use.
            val elapsed = System.nanoTime() - frameStart
            val sleepNanos = frameTimeNanos - elapsed
            if (sleepNanos > 0) {
                try {
                    sleep(sleepNanos / 1_000_000, (sleepNanos % 1_000_000).toInt())
                } catch (_: InterruptedException) {
                    // Thread is shutting down.
                }
            }
        }
    }
}
