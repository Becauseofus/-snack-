# -*- coding: utf-8 -*-
import os
import tempfile
import unittest

import snake_gui as sg


class WorldTests(unittest.TestCase):
    def make(self, cols=16, rows=12, mode="classic"):
        world = sg.SnakeWorld(cols, rows, mode=mode, allow_special=False)
        world.berry = (0, 0)
        world.special = None
        world.pending_grow = 0
        return world

    def test_no_reverse_and_buffer_limit(self):
        world = self.make()
        self.assertEqual(world.direction, (1, 0))
        self.assertFalse(world.turn(-1, 0))
        self.assertEqual(world.queue, [])
        self.assertTrue(world.turn(0, -1))
        self.assertFalse(world.turn(0, 1))
        self.assertTrue(world.turn(-1, 0))
        self.assertFalse(world.turn(1, 0))
        self.assertEqual(world.queue, [(0, -1), (-1, 0)])

    def test_turn_applies_after_the_current_cell(self):
        world = self.make()
        start = world.snake[0]
        world.turn(0, -1)
        world.turn(-1, 0)
        world.step()
        self.assertEqual(world.snake[0], (start[0] + 1, start[1]))
        self.assertEqual(world.direction, (0, -1))
        self.assertEqual(world.queue, [(-1, 0)])
        landed = world.snake[0]
        world.step()
        self.assertEqual(world.snake[0], (landed[0], landed[1] - 1))
        self.assertEqual(world.direction, (-1, 0))
        self.assertEqual(world.queue, [])

    def test_tail_cell_is_safe_when_not_growing(self):
        world = self.make()
        world.snake = [(0, 0), (0, 1), (1, 1), (1, 0)]
        world.direction = (1, 0)
        world.step()
        self.assertTrue(world.alive)
        self.assertEqual(world.snake[0], (1, 0))
        self.assertEqual(len(world.snake), 4)
        self.assertEqual(len(set(world.snake)), 4)

    def test_self_collision(self):
        world = self.make()
        world.snake = [(2, 0), (1, 0), (1, 1), (2, 1), (3, 1), (3, 0)]
        world.direction = (0, 1)
        events = world.step()
        self.assertFalse(world.alive)
        self.assertEqual(events[0]["type"], "die")

    def test_wall_and_wrap(self):
        classic = self.make(mode="classic")
        classic.snake = [(0, 3), (1, 3), (2, 3), (3, 3)]
        classic.direction = (-1, 0)
        events = classic.step()
        self.assertFalse(classic.alive)
        self.assertEqual(events[0]["type"], "die")

        zen = self.make(mode="zen")
        zen.snake = [(0, 3), (1, 3), (2, 3), (3, 3)]
        zen.direction = (-1, 0)
        zen.step()
        self.assertTrue(zen.alive)
        self.assertEqual(zen.snake[0], (zen.cols - 1, 3))

    def test_berry_grows_once(self):
        world = self.make()
        hx, hy = world.snake[0]
        world.berry = (hx + 1, hy)
        before = len(world.snake)
        events = world.step()
        self.assertEqual(events[0]["type"], "eat")
        self.assertEqual(events[0]["amount"], 10)
        self.assertEqual(len(world.snake), before + 1)
        self.assertEqual(world.pending_grow, 0)
        world.berry = (0, 0)
        world.step()
        self.assertEqual(len(world.snake), before + 1)

    def test_star_score_and_extra_segment(self):
        world = self.make()
        hx, hy = world.snake[0]
        world.special = (hx + 1, hy, "star", 9)
        before = len(world.snake)
        events = world.step()
        self.assertEqual(events[0]["amount"], 30)
        self.assertEqual(len(world.snake), before + 1)
        self.assertEqual(world.pending_grow, 1)
        world.step()
        self.assertEqual(len(world.snake), before + 2)
        self.assertEqual(world.pending_grow, 0)
        world.step()
        self.assertEqual(len(world.snake), before + 2)

    def test_multiplier_charges(self):
        world = self.make()
        hx, hy = world.snake[0]
        world.special = (hx + 1, hy, "mult", 9)
        world.step()
        self.assertEqual(world.score, 5)
        self.assertEqual(world.mult, 2)
        self.assertEqual(world.mult_left, 3)
        for expected_left in (2, 1, 0):
            hx, hy = world.snake[0]
            dx, dy = world.direction
            world.berry = (hx + dx, hy + dy)
            world.special = None
            before = world.score
            world.step()
            self.assertEqual(world.score - before, 20)
            self.assertEqual(world.mult_left, expected_left)
        self.assertEqual(world.mult, 1)
        hx, hy = world.snake[0]
        dx, dy = world.direction
        world.berry = (hx + dx, hy + dy)
        before = world.score
        world.step()
        self.assertEqual(world.score - before, 10)

    def test_slow_and_special_expiry(self):
        world = self.make()
        hx, hy = world.snake[0]
        world.special = (hx + 1, hy, "slow", 9)
        world.step()
        self.assertAlmostEqual(world.slow_left, 4.5)
        world.tick_time(1.0)
        self.assertAlmostEqual(world.slow_left, 3.5)
        world.tick_time(10)
        self.assertEqual(world.slow_left, 0)
        world.special = (1, 1, "star", 1.0)
        world.tick_time(1.2)
        self.assertIsNone(world.special)

    def test_clearing_the_board_wins(self):
        world = self.make(cols=3, rows=3)
        world.snake = [(2, 1), (2, 0), (1, 0), (1, 1), (1, 2), (0, 2), (0, 1), (0, 0)]
        world.direction = (0, 1)
        world.berry = (2, 2)
        world.special = None
        world.won = False
        world.alive = True
        events = world.step()
        self.assertTrue(world.won)
        self.assertTrue(world.alive)
        self.assertTrue(any(ev["type"] == "win" for ev in events))

    def test_round_path_softens_a_corner(self):
        pts = [(0, 0), (40, 0), (40, 40)]
        out = sg.round_path(pts, 12)
        self.assertEqual(out[0], (0, 0))
        self.assertEqual(out[-1], (40, 40))
        self.assertGreater(len(out), 3)
        self.assertTrue(all(0 <= p[0] <= 40 and 0 <= p[1] <= 40 for p in out))
        straight = sg.round_path([(0, 0), (10, 0), (30, 0)], 6)
        self.assertEqual(len(straight), 3)

    def test_speed_and_grid(self):
        speeds = [sg.speed_to_ms(level) for level in range(1, 11)]
        self.assertEqual(speeds, sorted(speeds, reverse=True))
        self.assertGreater(speeds[0], speeds[-1])
        for avail_w, avail_h in ((1280, 720), (1920, 1080), (2560, 1440), (800, 500)):
            cols, rows, cell = sg.fit_grid(avail_w, avail_h)
            self.assertLessEqual(cols * cell, avail_w)
            self.assertLessEqual(rows * cell, avail_h)
            self.assertGreaterEqual(cols, 8)
            self.assertGreaterEqual(rows, 8)

    def test_sanitize_keeps_old_scores(self):
        cfg = sg.sanitize_cfg({"best": 80, "speed": 99, "mode": "nope", "history": [{}, "bad", {"score": 1}]})
        self.assertEqual(cfg["best"], 80)
        self.assertEqual(cfg["speed"], 10)
        self.assertEqual(cfg["mode"], "classic")
        self.assertEqual(cfg["history"], [{}, {"score": 1}])
        self.assertEqual(cfg["best_by_mode"]["zen"], 0)


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._old_dir = sg.CONFIG_DIR
        self._old_path = sg.CONFIG_PATH
        sg.CONFIG_DIR = self.tmp.name
        sg.CONFIG_PATH = os.path.join(self.tmp.name, "settings.json")

    def tearDown(self):
        sg.CONFIG_DIR = self._old_dir
        sg.CONFIG_PATH = self._old_path
        self.tmp.cleanup()

    def _assert_fitted(self, app):
        app.root.update_idletasks()
        app.root.update()
        foot_bottom = app.footer.winfo_rooty() + app.footer.winfo_height()
        win_bottom = app.root.winfo_rooty() + app.root.winfo_height()
        self.assertLessEqual(foot_bottom, win_bottom + 2)
        self.assertGreaterEqual(app.canvas.winfo_rooty(), app.hud.winfo_rooty() + app.hud.winfo_height() - 2)
        self.assertLessEqual(
            app.canvas.winfo_rooty() + app.canvas.winfo_height(),
            app.footer.winfo_rooty() + 2,
        )
        self.assertGreaterEqual(app.canvas.winfo_width() + 1, app.cols * app.cell)
        self.assertGreaterEqual(app.canvas.winfo_height() + 1, app.rows * app.cell)
        self.assertGreaterEqual(app.footer.winfo_width() + 8, app.btn_start.winfo_width())

    def test_window_controls_stay_inside(self):
        root = sg.tk.Tk()
        try:
            app = sg.SnakeApp(root)
            app._running = False
            self._assert_fitted(app)
            app.cfg.update({"preset": "1280×720 (720p)", "width": 1280, "height": 720, "display": "window"})
            app.display_mode = "window"
            app.apply_display()
            root.update()
            self._assert_fitted(app)
            app.display_mode = "borderless"
            app.apply_display()
            root.update()
            self._assert_fitted(app)
        finally:
            root.destroy()

    def test_modes_change_the_pace(self):
        root = sg.tk.Tk()
        try:
            app = sg.SnakeApp(root)
            app._running = False
            app.speed_level = 5
            app.mode = "classic"
            app.state = "menu"
            app.world = None
            classic = app.interval_ms()
            app.mode = "zen"
            self.assertGreater(app.interval_ms(), classic)
            app.start_game()
            app.world.mode = "challenge"
            app.world.eaten = 0
            app.world.slow_left = 0
            base = app.interval_ms()
            app.world.eaten = 20
            faster = app.interval_ms()
            self.assertLess(faster, base)
            app.world.slow_left = 3
            self.assertGreater(app.interval_ms(), faster)
        finally:
            root.destroy()

    def test_play_updates_score_label(self):
        root = sg.tk.Tk()
        try:
            app = sg.SnakeApp(root)
            app._running = False
            root.update()
            app.start_game()
            world = app.world
            world.allow_special = False
            hx, hy = world.snake[0]
            world.berry = (hx + 1, hy)
            world.special = None
            events = world.step()
            app._on_events(events)
            app._sync_hud()
            self.assertIn("10", app.score_lbl.cget("text"))
            self.assertEqual(app.state, "playing")
        finally:
            root.destroy()


if __name__ == "__main__":
    unittest.main()
