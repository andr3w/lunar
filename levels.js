(() => {
	const W = 1000, H = 650;
	const GROUND_MIN = 360, GROUND_MAX = 600;

	// Edit a level by number here. Levels above 10 repeat the well, pillar and tunnel layouts with new seeds.
	const LEVELS = {
		1: { name: 'Lowlands', layout: 'open', peaks: 110 },
		2: { name: 'Rolling Hills', layout: 'open', peaks: 110 },
		3: { name: 'Roofed Cave', layout: 'roofed', room: 140 },
		4: { name: 'Roofed Cave', layout: 'roofed', room: 125 },
		5: { name: 'The Well', layout: 'well' },
		6: { name: 'Pillar Run', layout: 'pillars' },
		7: { name: 'The N Tunnel', layout: 'nshape' },
		8: { name: 'Cargo Run', layout: 'transport', peaks: 90, thrustMul: 1.6 },
		9: { name: 'Cargo Haul', layout: 'transport', peaks: 90, thrustMul: 1.6, loads: 3 },
		10: { name: 'Zero-G Launch', layout: 'launch', peaks: 90, thrustMul: 0.8, loads: 3 },
	};

	function configFor(n) {
		return LEVELS[n] || LEVELS[5 + ((n - 5) % 3)];
	}

	function mulberry32(seed) {
		return () => {
			seed = (seed + 0x6D2B79F5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function makeNShape(rnd) {
		const N = 128, step = W / N;
		const RX = 640, LX = 300, HALF = 46;
		const BLOCK_TOP = 200, RIGHT_TOP = 150, LEFT_TOP = 300, RIGHT_BOTTOM = 520, LEFT_BOTTOM = 560;
		return {
			name: 'The N Tunnel',
			pts: new Array(N + 1).fill(H + 1),
			step,
			pad: { x0: LX - 35, x1: LX + 35, y: LEFT_BOTTOM },
			obstacles: [],
			winds: [],
			underground: {
				block: { x: 120, y: BLOCK_TOP, w: 760, h: H - BLOCK_TOP },
				rects: [
					{ x: RX - HALF, y: RIGHT_TOP, w: 2 * HALF, h: RIGHT_BOTTOM - RIGHT_TOP },
					{ x: LX - HALF, y: LEFT_TOP, w: 2 * HALF, h: LEFT_BOTTOM - LEFT_TOP },
				],
				diagonal: { x1: RX, y1: RIGHT_BOTTOM, x2: LX, y2: LEFT_TOP, hw: HALF },
			},
			rnd,
		};
	}

	function makeLevel(n) {
		const cfg = configFor(n);
		const rnd = mulberry32(n * 7919 + 12345);
		const range = (a, b) => a + rnd() * (b - a);
		if (cfg.layout === 'nshape') return makeNShape(rnd);

		const N = 128, step = W / N;
		const pts = new Array(N + 1);
		pts[0] = range(430, 520);
		pts[N] = range(430, 520);
		let disp = cfg.peaks ?? 110;
		for (let s = N; s > 1; s >>= 1) {
			const half = s >> 1;
			for (let i = half; i < N; i += s) pts[i] = (pts[i - half] + pts[i + half]) / 2 + range(-disp, disp);
			disp *= 0.55;
		}
		for (let i = 0; i <= N; i++) pts[i] = Math.min(GROUND_MAX, Math.max(GROUND_MIN, pts[i]));

		const padSegs = cfg.layout === 'transport' ? 11 : Math.max(5, 9 - Math.floor((n - 1) / 2));
		const startX = {
			open: () => range(4 * step, (N - 4 - padSegs) * step),
			roofed: () => range(260, 520),
			well: () => range(350, 600),
			pillars: () => range(120, 220),
			transport: () => 760,
			launch: () => 760,
			gust: () => range(380, 600),
		}[cfg.layout]();
		const p = Math.floor(startX / step);
		let sum = 0;
		for (let i = p; i <= p + padSegs; i++) sum += pts[i];
		const padY = sum / (padSegs + 1);
		for (let i = p; i <= p + padSegs; i++) pts[i] = padY;
		const pad = { x0: p * step, x1: (p + padSegs) * step, y: padY };

		const obstacles = [], winds = [];
		let transport = null;
		const floorTop = padY + 40;
		const rect = (kind, msg, x, y, w, h, stroke) => {
			if (h > 0) obstacles.push({ kind, msg, x, y, w, h, stroke: !!stroke });
		};
		const flatten = (a, b) => {
			for (let i = Math.floor(a / step); i <= Math.ceil(b / step); i++) {
				pts[i] = Math.min(padY + 30, Math.max(padY - 30, pts[i]));
			}
		};

		switch (cfg.layout) {
			case 'transport': {
				flatten(pad.x0 - 20, pad.x1 + 20);
				const count = cfg.loads ?? 1;
				const loads = Array.from({ length: count }, (_, i) => ({ x: 190 + (i - (count - 1) / 2) * 60 }));
				transport = { thrustMul: cfg.thrustMul, loads, zone: { x: pad.x0, y: padY - 90, w: pad.x1 - pad.x0, h: 90 } };
				break;
			}
			case 'launch': {
				// Zero gravity: loads float on the left; once released in the strip they coast until they hit the wall target or miss.
				const count = cfg.loads ?? 1;
				const loads = Array.from({ length: count }, (_, i) => ({ x: 200 + i * 70, y: 240 + i * 60 }));
				const TH = 70, ty = range(60, pts[N] - TH - 60);
				// Open space: drop the ground out of sight (after placing the target, so it keeps its height).
				pts.fill(H + 1);
				transport = {
					thrustMul: cfg.thrustMul, gravity: 0, noGround: true, loads, start: { x: 80, y: 240 },
					zone: { x: 760, y: 0, w: 40, h: H },
					target: { x: W - 14, y: ty, w: 14, h: TH },
				};
				break;
			}
			case 'roofed': {
				const roofBottom = padY - cfg.room;
				const x0 = pad.x0 - 110, x1 = pad.x1 + 230, WALL = 16, ROOF = 26;
				flatten(x0, x1);
				rect('roof', 'Hit the cave roof', x0 - WALL, roofBottom - ROOF, x1 - x0 + WALL, ROOF, true);
				rect('wall', 'Hit the cave wall', x0 - WALL, roofBottom - ROOF, WALL, floorTop - (roofBottom - ROOF));
				break;
			}
			case 'well': {
				const sx0 = pad.x0 - 60, sx1 = pad.x1 + 60, WALL = 20, TOP = 170;
				flatten(sx0 - WALL, sx1 + WALL);
				rect('wall', 'Hit the shaft wall', sx0 - WALL, TOP, WALL, floorTop - TOP);
				rect('wall', 'Hit the shaft wall', sx1, TOP, WALL, floorTop - TOP);
				rect('ledge', 'Hit the ledge', sx0, 300, 80, 22, true);
				break;
			}
			case 'pillars': {
				const CEIL = padY - 175, ROOF = 26, x0 = pad.x0 - 30, x1 = W - 120, GAP = 120, WALL = 16;
				flatten(x0 - WALL, x1);
				rect('roof', 'Hit the tunnel roof', x0 - WALL, CEIL - ROOF, x1 - x0 + WALL, ROOF, true);
				rect('wall', 'Hit the tunnel wall', x0 - WALL, CEIL - ROOF, WALL, floorTop - (CEIL - ROOF));
				for (let i = 0; i < 3; i++) {
					const px = pad.x1 + 150 + i * 170, PW = 24;
					const holeTop = i % 2 === 0 ? CEIL + ROOF : floorTop - GAP;
					const holeBottom = holeTop + GAP;
					rect('pillar', 'Hit a pillar', px, CEIL, PW, holeTop - CEIL);
					rect('pillar', 'Hit a pillar', px, holeBottom, PW, floorTop - holeBottom);
				}
				break;
			}
		}

		return { name: cfg.name, pts, step, pad, obstacles, winds, rnd, transport };
	}

	window.LunarLevels = { makeLevel };
})();
