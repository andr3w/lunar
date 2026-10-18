(() => {
	const W = 1000, H = 650;
	const LEG_X = 14, LEG_Y = 16, BODY_HALF = 10, BODY_BOTTOM = 8;
	const THRUST = 95, TURN = 2.2;
	const MAX_DESCENT = 40, MAX_DRIFT = 25, MAX_TILT = 0.35, MAX_TILT_DEG = 20;
	const ROD = 85, TIP_MASS = 0.25, LOAD_MASS = 0.75, MAG_R = 24, MAG_F = 100, LOAD_R = 10, STEP = 1 / 240, ROD_ITER = 8;

	const canvas = document.getElementById('game');
	const ctx = canvas.getContext('2d');
	const touchBar = document.getElementById('touch');
	const keys = { left: false, right: false, thrust: false };
	const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'thrust', KeyW: 'thrust', Space: 'thrust' };
	const makeLevel = window.LunarLevels.makeLevel;
	// Testing aid: ?above starts the cargo level hovering directly over the load.
	const TEST_ABOVE = new URLSearchParams(location.search).has('above');
	if (TEST_ABOVE) window.__state = () => state;

	let scale = 1, level = 1, score = 0, state, terrain, particles = [], typed = '';
	const stars = Array.from({ length: 160 }, () => ({ x: rand(0, W), y: rand(0, H * 0.75), r: rand(0.5, 1.8), b: rand(0.3, 1) }));

	function rand(a, b) { return a + Math.random() * (b - a); }
	function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
	function clamp01(v) { return Math.min(1, Math.max(0, v)); }
	function inside(p, o) { return p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h; }
	function boxTouches(p, r, o) { return p.x + r >= o.x && p.x - r <= o.x + o.w && p.y + r >= o.y && p.y - r <= o.y + o.h; }

	function groundY(x) {
		const t = Math.min(W, Math.max(0, x)) / terrain.step;
		const i = Math.min(Math.floor(t), terrain.pts.length - 2);
		const f = t - i;
		return terrain.pts[i] * (1 - f) + terrain.pts[i + 1] * f;
	}

	function newAttempt() {
		terrain = makeLevel(level);
		const r = terrain.rnd;
		state = {
			status: 'playing', x: 120 + r() * (W - 240), y: 80,
			vx: -25 + r() * 50, vy: 0, a: -0.2 + r() * 0.4,
			gravity: Math.min(60, 40 + level * 2),
			thrusting: false, reason: '', gain: 0, base: 0, rating: '', parts: null,
		};
		particles = [];
		if (terrain.transport) {
			const T = terrain.transport;
			const homes = T.loads.map(p => ({ x: p.x, y: p.y ?? groundY(p.x) - LOAD_R }));
			if (T.gravity !== undefined) state.gravity = T.gravity;
			if (T.start) Object.assign(state, { x: T.start.x, y: T.start.y, vx: 0, a: 0 });
			if (TEST_ABOVE) Object.assign(state, { x: homes[0].x, y: homes[0].y - ROD - 60, vx: 0, a: 0 });
			state.cp = { x: state.x, y: state.y, ox: state.x - state.vx / 240, oy: state.y, w: 1 };
			state.tip = { x: state.x, y: state.y + ROD, ox: state.x, oy: state.y + ROD, w: 1 / TIP_MASS };
			state.loads = homes.map(({ x, y }) => ({ x, y, ox: x, oy: y, hx: x, hy: y, w: 1 / LOAD_MASS, done: false, flying: false }));
			state.hook = -1;
			state.delivered = 0;
			state.acc = 0;
		}
	}

	function newGame() {
		level = 1;
		score = 0;
		newAttempt();
		state.status = 'ready';
	}

	function action() {
		if (state.status === 'playing') return;
		if (state.status === 'ready') { state.status = 'playing'; return; }
		if (state.status === 'landed' || state.status === 'delivered') level++;
		newAttempt();
	}

	function jumpTo(n) {
		if (!(n >= 1)) return;
		level = n;
		newAttempt();
		state.status = 'ready';
	}

	function verlet(p, ax, ay, h) {
		const vx = p.x - p.ox, vy = p.y - p.oy;
		p.ox = p.x;
		p.oy = p.y;
		p.x += vx + ax * h * h;
		p.y += vy + ay * h * h;
	}

	function solveRod(a, b) {
		const dx = b.x - a.x, dy = b.y - a.y;
		const d = Math.hypot(dx, dy) || 1e-6;
		// Tension only: a rigid pole would prop the craft up and topple it around the load.
		if (d <= ROD) return;
		const k = (d - ROD) / d;
		const sum = a.w + b.w;
		a.x += dx * k * (a.w / sum);
		a.y += dy * k * (a.w / sum);
		b.x -= dx * k * (b.w / sum);
		b.y -= dy * k * (b.w / sum);
	}

	function stayOnGround(p, r) {
		if (p.x < r || p.x > W - r) {
			p.x = Math.min(W - r, Math.max(r, p.x));
			p.ox = p.x;
		}
		const g = groundY(p.x) - r;
		if (p.y > g) {
			p.y = g;
			p.oy = g;
			p.ox = p.x - (p.x - p.ox) * 0.97;
		}
	}

	function updateTransport(dt) {
		if (dt <= 0) return;
		const s = state, T = terrain.transport, { cp } = s;
		if (keys.left) s.a -= TURN * dt;
		if (keys.right) s.a += TURN * dt;
		s.a = wrap(s.a);

		s.thrusting = keys.thrust;
		let tax = 0, tay = 0;
		if (s.thrusting) {
			tax = THRUST * T.thrustMul * Math.sin(s.a);
			tay = -THRUST * T.thrustMul * Math.cos(s.a);
			emitExhaust();
		}

		// Verlet needs a constant step: a varying frame dt changes the implied velocity every frame.
		s.acc += dt;
		while (s.acc >= STEP) {
			s.acc -= STEP;
			stepTransport(tax, tay);
		}

		s.x = cp.x;
		s.y = cp.y;
		s.vx = (cp.x - cp.ox) / STEP;
		s.vy = (cp.y - cp.oy) / STEP;
		checkContact();
		if (s.status === 'playing' && s.hook >= 0 && boxTouches(s.loads[s.hook], LOAD_R, T.zone)) release();
	}

	function stepTransport(tax, tay) {
		const s = state, { cp, tip, loads } = s, h = STEP, hooked = loads[s.hook];
		let target = null, mx = 0, my = 0;
		if (!hooked) {
			// Magnet: equal and opposite pull on the nearest waiting load, so it is drawn in rather than snapped onto the pole.
			let best = MAG_R;
			for (const l of loads) {
				const d = Math.hypot(l.x - tip.x, l.y - tip.y);
				if (!l.done && !l.flying && d < best) { best = d; target = l; }
			}
			if (target) {
				const d = best || 1e-6, f = MAG_F * (1 - d / MAG_R) + MAG_F * 0.5;
				mx = (target.x - tip.x) / d * f;
				my = (target.y - tip.y) / d * f;
			}
		}
		verlet(cp, tax, tay + s.gravity, h);
		if (!hooked) verlet(tip, mx * tip.w, s.gravity + my * tip.w, h);
		for (const l of loads) {
			const pull = l === target ? l.w : 0;
			verlet(l, -mx * pull, s.gravity - my * pull, h);
			if (l.flying) checkFlight(l);
			else if (terrain.transport.target && !l.done && l !== hooked) checkLoose(l);
		}
		const end = hooked || tip;
		for (let it = 0; it < ROD_ITER; it++) {
			solveRod(cp, end);
			if (!hooked) stayOnGround(tip, 1);
			separateLoads(loads);
			for (const l of loads) stayOnGround(l, LOAD_R);
		}
		if (target && Math.hypot(tip.x - target.x, tip.y - target.y) < 3) attach(loads.indexOf(target));

		if (cp.y < 20) { cp.y = 20; cp.oy = 20; }
		if (terrain.transport.noGround && cp.y > H - 20) { cp.y = H - 20; cp.oy = cp.y; }
		if (cp.x < 0 || cp.x > W) { cp.x = Math.min(W, Math.max(0, cp.x)); cp.ox = cp.x; }
	}

	function separateLoads(loads) {
		// Push overlapping crates apart along the shallower axis, split by mass, so they can stack.
		for (let i = 0; i < loads.length; i++) {
			for (let j = i + 1; j < loads.length; j++) {
				const a = loads[i], b = loads[j], dx = b.x - a.x, dy = b.y - a.y;
				if (a.gone || b.gone) continue;
				const px = 2 * LOAD_R - Math.abs(dx), py = 2 * LOAD_R - Math.abs(dy);
				if (px <= 0 || py <= 0) continue;
				const ka = a.w / (a.w + b.w), kb = b.w / (a.w + b.w);
				if (px < py) {
					const sx = Math.sign(dx) || 1;
					a.x -= sx * px * ka;
					b.x += sx * px * kb;
				} else {
					const sy = Math.sign(dy) || 1;
					a.y -= sy * py * ka;
					b.y += sy * py * kb;
				}
			}
		}
	}

	function attach(i) {
		// Merge tip and load into one body, conserving momentum, so the pole end never jumps.
		const { tip } = state, load = state.loads[i], mt = 1 / tip.w, ml = 1 / load.w, m = mt + ml;
		// Sit the merged body exactly at the tip: any overshoot past ROD would be snapped back as a huge velocity.
		const vx = ((tip.x - tip.ox) * mt + (load.x - load.ox) * ml) / m;
		const vy = ((tip.y - tip.oy) * mt + (load.y - load.oy) * ml) / m;
		load.x = tip.x;
		load.y = tip.y;
		load.ox = tip.x - vx;
		load.oy = tip.y - vy;
		load.w = 1 / m;
		state.hook = i;
	}

	function checkFlight(l) {
		if (boxTouches(l, LOAD_R, terrain.transport.target)) {
			// Hit: the load is absorbed by the target so it can't block later shots.
			l.flying = false;
			l.done = l.gone = true;
			if (score1(l)) deliver();
		} else if (atEdge(l)) {
			respawn(l);
		}
	}

	// A loose load knocked off screen or into the release strip would be lost, so send it home.
	function checkLoose(l) {
		if (atEdge(l) || boxTouches(l, LOAD_R, terrain.transport.zone)) respawn(l);
	}

	function atEdge(l) {
		return l.x < LOAD_R || l.x > W - LOAD_R || l.y < LOAD_R || l.y > groundY(l.x) - LOAD_R;
	}

	function respawn(l) {
		// Puff where it struck and put it back where it started.
		for (let i = 0; i < 16; i++) {
			const life = rand(0.3, 0.6);
			particles.push({ x: l.x, y: l.y, vx: rand(-90, 90), vy: rand(-90, 90), life, max: life, color: '#9aa3b5', size: 2 });
		}
		l.flying = false;
		l.x = l.ox = l.hx;
		l.y = l.oy = l.hy;
	}

	// Count one delivered load and celebrate it; true once every load is in.
	function score1(load) {
		const s = state;
		s.delivered++;
		for (let i = 0; i < 40; i++) {
			const life = rand(0.6, 1.2);
			particles.push({ x: load.x, y: load.y, vx: rand(-140, 140), vy: rand(-180, -30), life, max: life, color: i % 2 ? '#3ddc84' : '#ffc247', size: rand(2, 3.5) });
		}
		return s.delivered === s.loads.length;
	}

	function release() {
		const s = state, load = s.loads[s.hook], tip = s.tip;
		if (terrain.transport.target) load.flying = true;
		else if (score1(load)) return deliver();
		else load.done = true;
		// Split the merged body: tip and load both keep its position and velocity, so the load falls on with its momentum.
		tip.x = load.x;
		tip.y = load.y;
		tip.ox = load.ox;
		tip.oy = load.oy;
		load.w = 1 / LOAD_MASS;
		s.hook = -1;
	}

	function deliver() {
		const s = state;
		s.status = 'delivered';
		s.thrusting = false;
		s.gain = 200 * level;
		score += s.gain;
	}

	function update(dt) {
		updateParticles(dt);
		const s = state;
		if (s.status !== 'playing') return;
		if (terrain.transport) return updateTransport(dt);
		if (keys.left) s.a -= TURN * dt;
		if (keys.right) s.a += TURN * dt;
		s.a = wrap(s.a);

		s.thrusting = keys.thrust;
		let ax = 0, ay = s.gravity;
		for (const w of terrain.winds) if (inside({ x: s.x, y: s.y }, w)) ax += w.ax;
		if (s.thrusting) {
			ax += THRUST * Math.sin(s.a);
			ay -= THRUST * Math.cos(s.a);
			emitExhaust();
		}
		s.vx += ax * dt;
		s.vy += ay * dt;
		s.x += s.vx * dt;
		s.y += s.vy * dt;

		if (s.x < 0 || s.x > W) {
			s.x = Math.min(W, Math.max(0, s.x));
			s.vx = -s.vx * 0.5;
		}
		if (s.y < 20) {
			s.y = 20;
			s.vy = Math.max(0, s.vy);
		}
		checkContact();
	}

	function inAir(p, u) {
		if (u.rects.some(r => inside(p, r))) return true;
		const d = u.diagonal;
		const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
		const t = Math.max(0, Math.min(1, ((p.x - d.x1) * dx + (p.y - d.y1) * dy) / (dx * dx + dy * dy)));
		const ex = d.x1 + t * dx - p.x, ey = d.y1 + t * dy - p.y;
		return ex * ex + ey * ey <= d.hw * d.hw;
	}

	function inRock(p) {
		const u = terrain.underground;
		return !!u && inside(p, u.block) && !inAir(p, u);
	}

	function checkContact() {
		const s = state, c = Math.cos(s.a), sn = Math.sin(s.a);
		const at = (lx, ly) => ({ x: s.x + lx * c - ly * sn, y: s.y + lx * sn + ly * c });
		const touching = p => p.y >= groundY(p.x) || inRock(p);
		if (s.y > H) return crash('Lost in the dark');

		const shell = [[-BODY_HALF, -BODY_HALF], [BODY_HALF, -BODY_HALF], [-BODY_HALF, BODY_BOTTOM], [BODY_HALF, BODY_BOTTOM], [0, -BODY_HALF - 6], [-LEG_X, LEG_Y], [LEG_X, LEG_Y]].map(([lx, ly]) => at(lx, ly));
		if (terrain.transport) {
			if (shell.some(touching)) return crash('The craft hit the ground');
			return;
		}
		const blocker = terrain.obstacles.find(o => shell.some(p => inside(p, o)));
		if (blocker) return crash(blocker.msg);

		if (shell.slice(0, 5).some(touching)) return crash('The hull hit the surface');
		const feet = [-LEG_X, LEG_X].map(lx => at(lx, LEG_Y)).filter(touching);
		if (feet.length === 0) return;

		const pad = terrain.pad;
		if (!feet.every(p => p.x >= pad.x0 && p.x <= pad.x1)) return crash('Missed the landing pad');
		if (Math.abs(s.vy) > MAX_DESCENT) return crash('Landed too hard');
		if (Math.abs(s.vx) > MAX_DRIFT) return crash('Sliding too fast');
		if (Math.abs(s.a) > MAX_TILT) return crash('Landed at too steep an angle');
		touchdown();
	}

	function crash(reason) {
		const s = state;
		s.status = 'crashed';
		s.reason = reason;
		s.thrusting = false;
		const colors = ['#ffb347', '#ff5a3c', '#9aa3b5', '#ffffff'];
		for (let i = 0; i < 60; i++) {
			const life = rand(0.6, 1.4);
			particles.push({ x: s.x, y: s.y, vx: rand(-220, 220), vy: rand(-260, 40), life, max: life, color: colors[i % colors.length], size: rand(1.5, 3.5) });
		}
	}

	function touchdown() {
		const s = state, pad = terrain.pad;
		const half = (pad.x1 - pad.x0) / 2;
		const parts = {
			descent: Math.round(200 * clamp01(1 - Math.abs(s.vy) / MAX_DESCENT)),
			drift: Math.round(150 * clamp01(1 - Math.abs(s.vx) / MAX_DRIFT)),
			tilt: Math.round(150 * clamp01(1 - Math.abs(s.a) / MAX_TILT)),
			centre: Math.round(100 * clamp01(1 - Math.abs(s.x - (pad.x0 + pad.x1) / 2) / half)),
		};
		const skill = parts.descent + parts.drift + parts.tilt + parts.centre;
		const ratio = skill / 600;
		s.rating = ratio >= 0.85 ? 'PERFECT' : ratio >= 0.65 ? 'GREAT' : ratio >= 0.45 ? 'GOOD' : 'ROUGH';
		s.parts = parts;
		s.base = 100 * level;
		s.gain = s.base + skill;
		s.status = 'landed';
		s.thrusting = false;
		score += s.gain;

		for (let i = 0; i < 25; i++) {
			const life = rand(0.4, 0.9);
			particles.push({ x: s.x, y: s.y + LEG_Y, vx: rand(-90, 90), vy: rand(-60, -10), life, max: life, color: '#c9d1e0', size: 2 });
		}
	}

	function emitExhaust() {
		const s = state, c = Math.cos(s.a), sn = Math.sin(s.a);
		const ox = s.x - BODY_BOTTOM * sn, oy = s.y + BODY_BOTTOM * c;
		for (let i = 0; i < 3; i++) {
			const v = rand(120, 200);
			particles.push({
				x: ox, y: oy,
				vx: s.vx * 0.3 - sn * v + rand(-25, 25),
				vy: s.vy * 0.3 + c * v + rand(-25, 25),
				life: 0.35, max: 0.35,
				color: Math.random() < 0.5 ? '#ffb347' : '#ff6a2a',
				size: rand(1.5, 3),
			});
		}
	}

	function updateParticles(dt) {
		for (const p of particles) {
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.vy += 30 * dt;
			p.life -= dt;
		}
		particles = particles.filter(p => p.life > 0);
	}

	function draw() {
		const s = state;
		ctx.setTransform(scale, 0, 0, scale, 0, 0);

		const bg = ctx.createLinearGradient(0, 0, 0, H);
		bg.addColorStop(0, '#04050c');
		bg.addColorStop(1, '#161d33');
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, W, H);

		ctx.fillStyle = '#131a2b';
		ctx.beginPath();
		ctx.arc(850, 110, 70, 0, Math.PI * 2);
		ctx.fill();

		ctx.fillStyle = '#ffffff';
		for (const st of stars) {
			ctx.globalAlpha = st.b;
			ctx.fillRect(st.x, st.y, st.r, st.r);
		}
		ctx.globalAlpha = 1;

		const { pts, step, pad, obstacles, winds } = terrain;
		ctx.beginPath();
		ctx.moveTo(0, H);
		pts.forEach((y, i) => ctx.lineTo(i * step, y));
		ctx.lineTo(W, H);
		ctx.closePath();
		ctx.fillStyle = '#1d2230';
		ctx.fill();

		ctx.beginPath();
		pts.forEach((y, i) => (i ? ctx.lineTo(i * step, y) : ctx.moveTo(0, y)));
		ctx.strokeStyle = '#8c95aa';
		ctx.lineWidth = 2;
		ctx.stroke();

		if (terrain.underground) drawUnderground(terrain.underground);
		ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
		ctx.textAlign = 'center';
		if (!terrain.transport?.target) {
			ctx.fillStyle = '#3ddc84';
			ctx.fillRect(pad.x0, pad.y - 3, pad.x1 - pad.x0, 3);
			ctx.fillText(terrain.transport ? 'DROP ZONE' : 'PAD', (pad.x0 + pad.x1) / 2, pad.y - 10);
		}

		for (const o of obstacles) {
			ctx.fillStyle = o.kind === 'wall' ? '#1d2230' : '#262d3f';
			ctx.fillRect(o.x, o.y, o.w, o.h);
			if (o.stroke) {
				ctx.strokeStyle = '#8c95aa';
				ctx.lineWidth = 2;
				ctx.strokeRect(o.x, o.y, o.w, o.h);
			}
		}

		for (const w of winds) {
			ctx.fillStyle = 'rgba(120, 200, 255, 0.07)';
			ctx.fillRect(w.x, w.y, w.w, w.h);
			ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
			ctx.fillStyle = 'rgba(150, 210, 255, 0.55)';
			ctx.fillText(w.ax > 0 ? 'WIND >>>' : '<<< WIND', w.x + w.w / 2, w.y + w.h / 2 + 4);
		}

		if (terrain.transport) drawTransport(s);
		if (s.status !== 'crashed') drawLander(s);

		for (const p of particles) {
			ctx.globalAlpha = Math.max(0, p.life / p.max);
			ctx.fillStyle = p.color;
			ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
		}
		ctx.globalAlpha = 1;

		drawHUD(s);
		drawOverlay(s);
	}

	function drawUnderground(u) {
		ctx.fillStyle = '#1d2230';
		ctx.fillRect(u.block.x, u.block.y, u.block.w, u.block.h);
		ctx.fillStyle = '#07090f';
		for (const r of u.rects) ctx.fillRect(r.x, r.y, r.w, r.h);
		const d = u.diagonal;
		ctx.strokeStyle = '#07090f';
		ctx.lineWidth = 2 * d.hw;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(d.x1, d.y1);
		ctx.lineTo(d.x2, d.y2);
		ctx.stroke();
		ctx.lineCap = 'butt';
	}

	function drawTransport(s) {
		const { zone: z, target: t } = terrain.transport;
		if (t) {
			ctx.fillStyle = 'rgba(255, 194, 71, 0.08)';
			ctx.fillRect(z.x, z.y, z.w, z.h);
			ctx.strokeStyle = 'rgba(255, 194, 71, 0.6)';
			ctx.lineWidth = 1.5;
			ctx.setLineDash([6, 4]);
			ctx.beginPath();
			ctx.moveTo(z.x, z.y);
			ctx.lineTo(z.x, z.y + z.h);
			ctx.moveTo(z.x + z.w, z.y);
			ctx.lineTo(z.x + z.w, z.y + z.h);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = 'rgba(255, 194, 71, 0.8)';
			ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
			ctx.textAlign = 'center';
			ctx.fillText('RELEASE', z.x + z.w / 2, 40);
			ctx.fillStyle = '#3ddc84';
			ctx.fillRect(t.x, t.y, t.w, t.h);
			ctx.textAlign = 'right';
			ctx.fillText('TARGET', t.x - 6, t.y + t.h / 2 + 4);
		} else {
			ctx.fillStyle = 'rgba(61, 220, 132, 0.12)';
			ctx.fillRect(z.x, z.y, z.w, z.h);
			ctx.strokeStyle = '#3ddc84';
			ctx.lineWidth = 1.5;
			ctx.setLineDash([6, 4]);
			ctx.strokeRect(z.x, z.y, z.w, z.h);
			ctx.setLineDash([]);
		}

		const hooked = s.loads[s.hook], end = hooked || s.tip;
		ctx.strokeStyle = '#c9d1e0';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(s.cp.x, s.cp.y);
		const dx = end.x - s.cp.x, dy = end.y - s.cp.y, d = Math.hypot(dx, dy);
		if (d < ROD - 0.5) {
			// Slack: bow the line so its drawn length stays close to ROD.
			const sag = Math.max(Math.sqrt(3 * d * (ROD - d) / 8), (ROD - d) / 2);
			let nx = -dy / (d || 1), ny = dx / (d || 1);
			if (ny < 0) { nx = -nx; ny = -ny; }
			ctx.quadraticCurveTo((s.cp.x + end.x) / 2 + nx * sag * 2, (s.cp.y + end.y) / 2 + ny * sag * 2, end.x, end.y);
		} else {
			ctx.lineTo(end.x, end.y);
		}
		ctx.stroke();

		if (!hooked) {
			ctx.fillStyle = '#ffc247';
			ctx.beginPath();
			ctx.arc(s.tip.x, s.tip.y, 3, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = 'rgba(255, 194, 71, 0.35)';
			ctx.setLineDash([3, 4]);
			for (const l of s.loads) {
				if (l.done || l.flying) continue;
				ctx.beginPath();
				ctx.arc(l.x, l.y, MAG_R, 0, Math.PI * 2);
				ctx.stroke();
			}
			ctx.setLineDash([]);
		}
		for (const l of s.loads) {
			if (l.gone) continue;
			ctx.fillStyle = l === hooked || l.flying ? '#ffb347' : l.done ? '#3ddc84' : '#ffc247';
			ctx.fillRect(l.x - LOAD_R, l.y - LOAD_R, LOAD_R * 2, LOAD_R * 2);
		}
	}

	function drawLander(s) {
		ctx.save();
		ctx.translate(s.x, s.y);
		ctx.rotate(s.a);

		if (s.thrusting) {
			ctx.fillStyle = '#ff9a2e';
			ctx.beginPath();
			ctx.moveTo(-5, BODY_BOTTOM);
			ctx.lineTo(5, BODY_BOTTOM);
			ctx.lineTo(0, BODY_BOTTOM + 14 + Math.random() * 10);
			ctx.closePath();
			ctx.fill();
		}

		ctx.strokeStyle = '#c9d1e0';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(-8, 4); ctx.lineTo(-LEG_X, LEG_Y);
		ctx.moveTo(8, 4); ctx.lineTo(LEG_X, LEG_Y);
		ctx.moveTo(-LEG_X - 5, LEG_Y); ctx.lineTo(-LEG_X + 5, LEG_Y);
		ctx.moveTo(LEG_X - 5, LEG_Y); ctx.lineTo(LEG_X + 5, LEG_Y);
		ctx.stroke();

		ctx.fillStyle = '#d9dee9';
		ctx.fillRect(-BODY_HALF, -BODY_HALF, BODY_HALF * 2, BODY_HALF + BODY_BOTTOM);
		ctx.fillStyle = '#3a7bd5';
		ctx.fillRect(-5, -6, 10, 6);

		ctx.strokeStyle = '#c9d1e0';
		ctx.beginPath();
		ctx.moveTo(0, -BODY_HALF);
		ctx.lineTo(0, -BODY_HALF - 6);
		ctx.stroke();
		ctx.fillStyle = '#ff5a5a';
		ctx.beginPath();
		ctx.arc(0, -BODY_HALF - 6, 2, 0, Math.PI * 2);
		ctx.fill();

		ctx.restore();
	}

	function tierColor(ratio) {
		if (ratio <= 0.5) return '#2bd96b';
		if (ratio <= 1) return '#b4ec6b';
		return '#ff5a5a';
	}

	function drawHUD(s) {
		const floorY = terrain.underground ? terrain.pad.y : groundY(s.x);
		const alt = Math.max(0, Math.round(floorY - (s.y + LEG_Y)));
		const rows = [
			{ label: 'LEVEL', value: `${level}  ${terrain.name}` },
			{ label: 'SCORE', value: `${score}` },
			{ label: 'ALT', value: `${alt}` },
			{ label: 'DESCENT', value: s.vy.toFixed(1), ratio: Math.abs(s.vy) / MAX_DESCENT, limit: `/ ${MAX_DESCENT}` },
			{ label: 'DRIFT', value: s.vx.toFixed(1), ratio: Math.abs(s.vx) / MAX_DRIFT, limit: `/ ${MAX_DRIFT}` },
			{ label: 'TILT', value: `${(Math.abs(s.a) * 180 / Math.PI).toFixed(0)}°`, ratio: Math.abs(s.a) / MAX_TILT, limit: `/ ${MAX_TILT_DEG}°` },
		];
		ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
		ctx.textAlign = 'left';
		if (terrain.transport) {
			rows.push({ label: 'LOAD', value: s.hook >= 0 ? 'HOOKED' : 'FREE' });
			if (s.loads.length > 1) rows.push({ label: 'CARGO', value: `${s.delivered} / ${s.loads.length}` });
		}
		rows.forEach((row, i) => {
			const y = 28 + i * 20;
			ctx.fillStyle = '#8c95aa';
			ctx.fillText(row.label, 16, y);
			ctx.fillStyle = row.ratio === undefined ? '#cfd7e6' : tierColor(row.ratio);
			ctx.fillText(row.value, 120, y);
			if (row.limit) {
				ctx.fillStyle = '#8c95aa';
				ctx.fillText(row.limit, 120 + ctx.measureText(row.value + '  ').width, y);
			}
		});
	}

	function drawOverlay(s) {
		let title = '', lines = [];
		if (s.status === 'ready') {
			title = 'LUNAR LANDER';
			lines = ['Press Space or tap to begin'];
		} else if (s.status === 'landed') {
			const p = s.parts;
			title = 'TOUCHDOWN';
			lines = [
				`${s.rating}  +${s.gain} points`,
				`Base ${s.base}  Descent ${p.descent}  Drift ${p.drift}  Tilt ${p.tilt}`,
				`Centre ${p.centre}`,
				'Press Space for the next level',
			];
		} else if (s.status === 'delivered') {
			title = 'DELIVERED';
			lines = [`+${s.gain} points`, 'Press Space for the next level'];
		} else if (s.status === 'crashed') {
			title = 'CRASHED';
			lines = [s.reason, 'Press Space to try this level again'];
		}
		if (!title) return;

		ctx.fillStyle = 'rgba(4, 5, 12, 0.82)';
		ctx.fillRect(W / 2 - 300, H / 2 - 110, 600, 220);
		ctx.strokeStyle = '#ffffff30';
		ctx.lineWidth = 1;
		ctx.strokeRect(W / 2 - 300, H / 2 - 110, 600, 220);
		ctx.textAlign = 'center';
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 34px ui-monospace, Menlo, Consolas, monospace';
		ctx.fillText(title, W / 2, H / 2 - 55);
		ctx.font = '18px ui-monospace, Menlo, Consolas, monospace';
		ctx.fillStyle = '#cfd7e6';
		lines.forEach((line, i) => ctx.fillText(line, W / 2, H / 2 - 10 + i * 28));
	}

	function resize() {
		const dpr = window.devicePixelRatio || 1;
		const cssW = canvas.getBoundingClientRect().width || W;
		canvas.width = Math.round(cssW * dpr);
		canvas.height = Math.round(canvas.width * H / W);
		scale = canvas.width / W;
	}

	addEventListener('resize', resize);
	resize();

	addEventListener('keydown', e => {
		const k = KEYMAP[e.code];
		if (k) {
			e.preventDefault();
			keys[k] = true;
		}
		if (/^[0-9]$/.test(e.key) && !e.repeat) typed = (typed + e.key).slice(-2);
		if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
			if (typed) jumpTo(parseInt(typed, 10));
			else action();
			typed = '';
		} else if (e.code === 'Space' && !e.repeat) {
			action();
		}
		if (e.code === 'KeyR' && !e.repeat) newGame();
	});
	addEventListener('keyup', e => {
		const k = KEYMAP[e.code];
		if (k) keys[k] = false;
	});
	addEventListener('blur', () => { keys.left = keys.right = keys.thrust = false; });

	if (matchMedia('(pointer: coarse)').matches) touchBar.hidden = false;
	touchBar.querySelectorAll('button').forEach(btn => {
		const k = btn.dataset.key;
		btn.addEventListener('pointerdown', e => {
			e.preventDefault();
			keys[k] = true;
			action();
		});
		for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
			btn.addEventListener(type, () => { keys[k] = false; });
		}
	});
	canvas.addEventListener('pointerdown', action);

	let last = performance.now();
	function frame(now) {
		const dt = Math.min(0.033, (now - last) / 1000);
		last = now;
		update(dt);
		draw();
		requestAnimationFrame(frame);
	}

	newGame();
	requestAnimationFrame(frame);
})();
