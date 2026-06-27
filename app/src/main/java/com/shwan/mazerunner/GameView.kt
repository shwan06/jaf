package com.shwan.mazerunner

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import kotlin.math.abs

/**
 * The single view that hosts the whole game: it owns the [GameWorld], runs the
 * [GameThread], renders the maze and HUD to its [Canvas], and translates
 * touches into movement and menu actions.
 */
class GameView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {

    private enum class UiState { MENU, PLAYING, PAUSED, LEVEL_COMPLETE, GAME_OVER }

    private val world = GameWorld()
    private var thread: GameThread? = null
    private var uiState = UiState.MENU

    // --- Paints (created once; mutated per draw call) ---
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create(Typeface.DEFAULT_BOLD, Typeface.BOLD)
        textAlign = Paint.Align.LEFT
    }

    // --- Colors ---
    private val colBackground = Color.parseColor("#0F1020")
    private val colFloor = Color.parseColor("#1B1D33")
    private val colWall = Color.parseColor("#3A2E6E")
    private val colWallEdge = Color.parseColor("#5A47A8")
    private val colPlayer = Color.parseColor("#FFD54F")
    private val colEnemy = Color.parseColor("#FF5252")
    private val colCoin = Color.parseColor("#FFC107")
    private val colExit = Color.parseColor("#4CAF50")
    private val colAccent = Color.parseColor("#7C4DFF")
    private val colText = Color.WHITE
    private val colDim = Color.parseColor("#CC000000")

    // --- Maze-to-screen layout, recomputed each frame ---
    private var cell = 0f
    private var originX = 0f
    private var originY = 0f
    private var hudHeight = 0f

    // --- Swipe tracking ---
    private var touchStartX = 0f
    private var touchStartY = 0f
    private var swipeHandled = false
    private val swipeThreshold get() = width * 0.04f

    init {
        holder.addCallback(this)
        isFocusable = true
    }

    // region Lifecycle ----------------------------------------------------

    override fun surfaceCreated(holder: SurfaceHolder) {
        startThread()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        stopThread()
    }

    private fun startThread() {
        if (thread?.running == true) return
        thread = GameThread(holder, this).also {
            it.running = true
            it.start()
        }
    }

    private fun stopThread() {
        val t = thread ?: return
        t.running = false
        var retry = true
        while (retry) {
            try {
                t.join()
                retry = false
            } catch (_: InterruptedException) {
            }
        }
        thread = null
    }

    /** Called from the Activity when the app goes to the background. */
    fun onPause() {
        if (uiState == UiState.PLAYING) uiState = UiState.PAUSED
    }

    // endregion

    // region Update -------------------------------------------------------

    fun update(dt: Float) {
        if (uiState != UiState.PLAYING) return
        when (world.update(dt)) {
            WorldEvent.LEVEL_COMPLETE -> uiState = UiState.LEVEL_COMPLETE
            WorldEvent.GAME_OVER -> uiState = UiState.GAME_OVER
            WorldEvent.LIFE_LOST, WorldEvent.NONE -> {}
        }
    }

    // endregion

    // region Input --------------------------------------------------------

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchStartX = event.x
                touchStartY = event.y
                swipeHandled = false
                handleTap(event.x, event.y)
            }
            MotionEvent.ACTION_MOVE -> if (uiState == UiState.PLAYING) detectSwipe(event)
            MotionEvent.ACTION_UP -> if (uiState == UiState.PLAYING) detectSwipe(event)
        }
        return true
    }

    private fun detectSwipe(event: MotionEvent) {
        if (swipeHandled) return
        val dx = event.x - touchStartX
        val dy = event.y - touchStartY
        if (abs(dx) < swipeThreshold && abs(dy) < swipeThreshold) return
        val dir = if (abs(dx) > abs(dy)) {
            if (dx > 0) Direction.RIGHT else Direction.LEFT
        } else {
            if (dy > 0) Direction.DOWN else Direction.UP
        }
        world.setPlayerDirection(dir)
        swipeHandled = true
    }

    private fun handleTap(x: Float, y: Float) {
        when (uiState) {
            UiState.MENU -> {
                world.startNewGame()
                uiState = UiState.PLAYING
            }
            UiState.LEVEL_COMPLETE -> {
                world.advanceLevel()
                uiState = UiState.PLAYING
            }
            UiState.GAME_OVER -> uiState = UiState.MENU
            UiState.PAUSED -> uiState = UiState.PLAYING
            UiState.PLAYING -> {
                // Top-right corner pauses.
                if (x > width - hudHeight && y < hudHeight) uiState = UiState.PAUSED
            }
        }
    }

    // endregion

    // region Rendering ----------------------------------------------------

    fun render(canvas: Canvas) {
        canvas.drawColor(colBackground)
        when (uiState) {
            UiState.MENU -> drawMenu(canvas)
            UiState.PLAYING, UiState.PAUSED, UiState.LEVEL_COMPLETE, UiState.GAME_OVER -> {
                if (worldReady()) {
                    computeLayout()
                    drawMaze(canvas)
                    drawHud(canvas)
                }
                when (uiState) {
                    UiState.PAUSED -> drawCenterOverlay(canvas, "Paused", "Tap to resume")
                    UiState.LEVEL_COMPLETE -> drawCenterOverlay(
                        canvas,
                        "Level ${world.level} cleared!",
                        "Score ${world.score}  •  Tap for next level"
                    )
                    UiState.GAME_OVER -> drawCenterOverlay(
                        canvas,
                        "Game Over",
                        "Reached level ${world.level}  •  Score ${world.score}\nTap to return to menu"
                    )
                    else -> {}
                }
            }
        }
    }

    /** Has a level been built yet? (world.maze is lateinit.) */
    private fun worldReady(): Boolean = world.run {
        try { maze; true } catch (_: UninitializedPropertyAccessException) { false }
    }

    private fun computeLayout() {
        hudHeight = height * 0.10f
        val maze = world.maze
        val availW = width.toFloat()
        val availH = height - hudHeight
        cell = minOf(availW / maze.width, availH / maze.height)
        originX = (availW - cell * maze.width) / 2f
        originY = hudHeight + (availH - cell * maze.height) / 2f
    }

    private fun drawMaze(canvas: Canvas) {
        val maze = world.maze

        // Floor backdrop for the maze area.
        paint.color = colFloor
        canvas.drawRect(originX, originY, originX + cell * maze.width, originY + cell * maze.height, paint)

        // Walls.
        for (y in 0 until maze.height) {
            for (x in 0 until maze.width) {
                if (maze.isWall(x, y)) {
                    val left = originX + x * cell
                    val top = originY + y * cell
                    paint.color = colWall
                    canvas.drawRect(left, top, left + cell, top + cell, paint)
                    paint.color = colWallEdge
                    paint.style = Paint.Style.STROKE
                    paint.strokeWidth = cell * 0.06f
                    canvas.drawRect(left, top, left + cell, top + cell, paint)
                    paint.style = Paint.Style.FILL
                }
            }
        }

        // Exit.
        drawTileCircle(canvas, maze.exit.x.toFloat(), maze.exit.y.toFloat(), colExit, 0.42f)
        paint.color = Color.parseColor("#A5D6A7")
        canvas.drawCircle(tileCenterX(maze.exit.x.toFloat()), tileCenterY(maze.exit.y.toFloat()), cell * 0.16f, paint)

        // Coins.
        for (coin in world.coins) {
            drawTileCircle(canvas, coin.x.toFloat(), coin.y.toFloat(), colCoin, 0.22f)
        }

        // Enemies.
        for (enemy in world.enemies) {
            drawTileCircle(canvas, enemy.px, enemy.py, colEnemy, 0.38f)
            // Simple eyes.
            paint.color = Color.WHITE
            val ex = tileCenterX(enemy.px)
            val ey = tileCenterY(enemy.py)
            canvas.drawCircle(ex - cell * 0.12f, ey - cell * 0.05f, cell * 0.07f, paint)
            canvas.drawCircle(ex + cell * 0.12f, ey - cell * 0.05f, cell * 0.07f, paint)
        }

        // Player (blinks while invulnerable).
        val blinkOn = !world.isInvulnerable || ((System.nanoTime() / 100_000_000L) % 2L == 0L)
        if (blinkOn) {
            drawTileCircle(canvas, world.player.px, world.player.py, colPlayer, 0.40f)
        }
    }

    private fun drawTileCircle(canvas: Canvas, tx: Float, ty: Float, color: Int, radiusFraction: Float) {
        paint.color = color
        canvas.drawCircle(tileCenterX(tx), tileCenterY(ty), cell * radiusFraction, paint)
    }

    private fun tileCenterX(tx: Float) = originX + (tx + 0.5f) * cell
    private fun tileCenterY(ty: Float) = originY + (ty + 0.5f) * cell

    private fun drawHud(canvas: Canvas) {
        textPaint.color = colText
        textPaint.textSize = hudHeight * 0.32f
        val pad = width * 0.04f
        val baseline = hudHeight * 0.45f
        textPaint.textAlign = Paint.Align.LEFT
        canvas.drawText("Lv ${world.level}", pad, baseline, textPaint)
        canvas.drawText("Coins ${world.coins.size}", pad, baseline + hudHeight * 0.42f, textPaint)

        textPaint.textAlign = Paint.Align.CENTER
        canvas.drawText("Score ${world.score}", width / 2f, baseline, textPaint)

        // Lives as small hearts (circles).
        textPaint.textAlign = Paint.Align.RIGHT
        canvas.drawText("⏸", width - pad, baseline, textPaint) // pause glyph
        paint.color = colEnemy
        for (i in 0 until world.lives) {
            canvas.drawCircle(width - pad - i * (hudHeight * 0.3f), baseline + hudHeight * 0.30f, hudHeight * 0.10f, paint)
        }

        // Time bar.
        val barTop = hudHeight - hudHeight * 0.12f
        val barH = hudHeight * 0.08f
        paint.color = Color.parseColor("#33FFFFFF")
        canvas.drawRect(pad, barTop, width - pad, barTop + barH, paint)
        val frac = (world.timeRemaining / world.levelDuration).coerceIn(0f, 1f)
        paint.color = if (frac < 0.25f) colEnemy else colAccent
        canvas.drawRect(pad, barTop, pad + (width - 2 * pad) * frac, barTop + barH, paint)
    }

    private fun drawMenu(canvas: Canvas) {
        textPaint.color = colAccent
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = width * 0.11f
        canvas.drawText("MAZE RUSH", width / 2f, height * 0.34f, textPaint)
        textPaint.color = colText
        textPaint.textSize = width * 0.09f
        canvas.drawText("RUNNER", width / 2f, height * 0.34f + width * 0.12f, textPaint)

        textPaint.textSize = width * 0.045f
        canvas.drawText("Swipe to run the maze", width / 2f, height * 0.58f, textPaint)
        canvas.drawText("Grab coins • dodge chasers • reach the exit", width / 2f, height * 0.63f, textPaint)

        textPaint.color = colCoin
        textPaint.textSize = width * 0.06f
        canvas.drawText("TAP TO PLAY", width / 2f, height * 0.78f, textPaint)
    }

    private fun drawCenterOverlay(canvas: Canvas, title: String, subtitle: String) {
        paint.color = colDim
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)

        textPaint.color = colText
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = width * 0.085f
        canvas.drawText(title, width / 2f, height * 0.42f, textPaint)

        textPaint.textSize = width * 0.045f
        var y = height * 0.52f
        for (line in subtitle.split("\n")) {
            canvas.drawText(line, width / 2f, y, textPaint)
            y += width * 0.07f
        }
    }

    // endregion
}
