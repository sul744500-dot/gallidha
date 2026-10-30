// وصفات الأصوات: كل صوت يُبنى بالكامل من الصفر بمحرك التوليف (ملكية أصلية للمشروع).

import type { Category, LocalText, ScoreParts } from "../../shared/types";
import {
  add,
  am,
  applyEnv,
  burst,
  drive,
  envelope,
  filter,
  finish,
  formantFilter,
  noise,
  osc,
  reverb,
  scale,
  timeline,
  voiced,
  voiceSource,
  vowels,
  type Pts,
} from "./engine";

export interface SoundRecipe {
  id: string;
  name: LocalText;
  emoji: string;
  difficulty: 1 | 2 | 3;
  weights?: Partial<ScoreParts>;
  make: () => Float32Array;
}

export interface PackRecipe {
  id: string;
  category: Category;
  name: LocalText;
  description: LocalText;
  emoji: string;
  sounds: SoundRecipe[];
}

const quickEnv = (dur: number, attack = 0.01, release = 0.05): Pts => [
  [0, 0],
  [attack, 1],
  [Math.max(attack, dur - release), 0.8],
  [dur, 0],
];

// ───────────── الحيوانات ─────────────

function chicken(): Float32Array {
  const cluck = (f: number, seed: number) =>
    voiced(0.09, [[0, f * 1.12], [0.03, f], [0.09, f * 0.86]], [[0, "o"], [0.09, "u"]], {
      scale: 1.6,
      rough: 0.3,
      jitter: 0.03,
      tilt: 4200,
      breath: 0.12,
      seed,
      env: quickEnv(0.09, 0.008, 0.04),
    });
  const ba = voiced(0.08, 560, [[0, "schwa"], [0.08, "a"]], { scale: 1.5, rough: 0.2, tilt: 4500, env: quickEnv(0.08, 0.006, 0.02) });
  const gawk = drive(
    voiced(0.44, [[0, 620], [0.07, 960], [0.26, 900], [0.44, 640]], [[0, "ae"], [0.2, "a"], [0.44, "o"]], {
      scale: 1.55,
      rough: [[0, 0.2], [0.2, 0.45], [0.44, 0.3]],
      jitter: 0.04,
      tilt: 5200,
      breath: 0.15,
      env: [[0, 0], [0.015, 1], [0.3, 0.85], [0.44, 0]],
    }),
    1.8,
  );
  return finish(
    timeline(2.1, [
      [0.0, cluck(470, 1)],
      [0.17, cluck(455, 2), 0.9],
      [0.33, cluck(500, 3)],
      [0.5, cluck(470, 4), 0.85],
      [0.74, ba, 0.8],
      [0.84, gawk],
      [1.5, cluck(480, 5), 0.8],
      [1.67, cluck(460, 6), 0.7],
    ]),
  );
}

function cow(): Float32Array {
  const dur = 2.3;
  const moo = voiced(dur, [[0, 112], [0.35, 128], [1.4, 122], [2.0, 104], [2.3, 90]], [[0, "m"], [0.38, "u"], [0.8, "o"], [1.7, "o"], [2.3, "u"]], {
    scale: 0.82,
    rough: 0.18,
    jitter: 0.012,
    vibRate: 4.5,
    vibDepth: 0.15,
    tilt: 1700,
    breath: [[0, 0.05], [2.0, 0.12], [2.3, 0.3]],
    env: [[0, 0], [0.3, 0.55], [0.6, 1], [1.7, 0.9], [2.3, 0]],
  });
  return finish(reverb(filter(moo, "lowpass", 2600, 0.7), 0.12, 0.5, 0.4));
}

function angryCat(): Float32Array {
  const meowDur = 1.3;
  let meow = voiced(meowDur, [[0, 380], [0.16, 420], [0.45, 830], [0.8, 760], [1.3, 520]], [[0, "m"], [0.13, "i"], [0.4, "e"], [0.7, "a"], [1.1, "o"], [1.3, "u"]], {
    scale: 1.5,
    rough: [[0, 0.6], [0.3, 0.25], [1.3, 0.35]],
    jitter: 0.02,
    vibRate: 7,
    vibDepth: [[0, 0], [0.6, 0.35], [1.3, 0.5]],
    tilt: 4800,
    breath: 0.12,
    env: [[0, 0], [0.08, 0.6], [0.4, 1], [1.0, 0.85], [1.3, 0]],
  });
  // «مررر» في البداية: رفرفة سعة سريعة
  meow = am(meow, 26, [[0, 0.7], [0.35, 0.6], [0.45, 0]]);
  const hiss = burst(0.95, "bandpass", [[0, 5200], [0.9, 4600]], 0.9, [[0, 0], [0.04, 1], [0.6, 0.75], [0.95, 0]], 11);
  return finish(timeline(2.45, [[0, drive(meow, 1.5)], [1.45, hiss, 0.55]]));
}

function donkey(): Float32Array {
  const hee = (dur: number, seed: number) =>
    add(
      voiced(dur, [[0, 680], [dur, 900]], [[0, "e"], [dur, "i"]], { scale: 1.15, rough: 0.45, breath: 0.55, jitter: 0.03, tilt: 5000, seed, env: quickEnv(dur, 0.04, 0.06) }),
      scale(burst(dur, "bandpass", 2600, 1.2, quickEnv(dur, 0.04, 0.05), seed + 9), 0.35),
    );
  const haw = (dur: number, seed: number) =>
    drive(
      voiced(dur, [[0, 330], [0.15, 390], [dur, 240]], [[0, "a"], [dur * 0.6, "a"], [dur, "o"]], {
        scale: 1,
        rough: 0.65,
        jitter: 0.045,
        tilt: 5200,
        breath: 0.15,
        seed,
        env: [[0, 0], [0.03, 1], [dur * 0.7, 0.9], [dur, 0]],
      }),
      2.2,
    );
  return finish(
    timeline(3.3, [
      [0.0, hee(0.42, 1)],
      [0.46, haw(0.56, 2)],
      [1.12, hee(0.4, 3)],
      [1.56, haw(0.55, 4)],
      [2.22, hee(0.32, 5)],
      [2.58, haw(0.6, 6)],
    ]),
  );
}

function dog(): Float32Array {
  const bark = (f: number, seed: number, dur = 0.17) =>
    add(
      drive(
        voiced(dur, [[0, f], [0.05, f * 1.15], [dur, f * 0.7]], [[0, "u"], [0.035, "a"], [dur, "o"]], {
          scale: 1.1,
          rough: 0.55,
          breath: 0.3,
          jitter: 0.04,
          tilt: 4200,
          seed,
          env: [[0, 0], [0.006, 1], [0.06, 0.8], [dur, 0]],
        }),
        2.5,
      ),
      scale(burst(0.05, "bandpass", 1800, 1, [[0, 0], [0.004, 1], [0.05, 0]], seed + 3), 0.4),
    );
  return finish(
    timeline(1.45, [
      [0, bark(420, 1)],
      [0.27, bark(440, 2)],
      [0.78, bark(500, 3, 0.22)],
      [1.08, bark(470, 4, 0.2)],
    ]),
  );
}

function rooster(): Float32Array {
  const syl = (dur: number, f: number, v: string, seed: number) =>
    voiced(dur, [[0, f * 0.95], [dur * 0.4, f * 1.04], [dur, f]], [[0, v], [dur, v]], { scale: 1.4, rough: 0.3, jitter: 0.02, tilt: 5000, breath: 0.1, seed, env: quickEnv(dur, 0.012, 0.03) });
  const last = voiced(1.05, [[0, 880], [0.15, 1010], [0.6, 980], [1.05, 700]], [[0, "o"], [0.25, "u"], [1.05, "u"]], {
    scale: 1.4,
    rough: 0.32,
    jitter: 0.02,
    vibRate: 6,
    vibDepth: [[0, 0], [0.4, 0.25], [1.05, 0.6]],
    tilt: 5200,
    breath: 0.1,
    env: [[0, 0], [0.02, 1], [0.8, 0.85], [1.05, 0]],
  });
  return finish(
    drive(
      timeline(1.9, [
        [0.0, syl(0.13, 640, "o", 1)],
        [0.19, syl(0.12, 720, "e", 2)],
        [0.37, syl(0.22, 820, "o", 3)],
        [0.66, last],
      ]),
      1.6,
    ),
  );
}

function sheep(): Float32Array {
  const baa = (dur: number, f: number, seed: number) => {
    const v = voiced(dur, [[0, f * 0.92], [0.1, f], [dur, f * 0.9]], [[0, "u"], [0.05, "e"], [dur * 0.4, "ae"], [dur, "a"]], {
      scale: 1.25,
      rough: 0.22,
      vibRate: 8.5,
      vibDepth: 0.9,
      jitter: 0.02,
      tilt: 3800,
      breath: 0.12,
      seed,
      env: [[0, 0], [0.03, 0.4], [0.08, 1], [dur * 0.75, 0.8], [dur, 0]],
    });
    return am(v, 8.5, 0.5);
  };
  return finish(timeline(2.35, [[0, baa(1.3, 300, 1)], [1.5, baa(0.75, 320, 2)]]));
}

// ───────────── السيارات والآلات ─────────────

function crank(dur: number, seed: number): Float32Array {
  const rate = 5.6;
  const motor = filter(osc(dur, (t) => 150 + 25 * Math.sin(2 * Math.PI * rate * t), "saw"), "lowpass", 900, 0.9);
  const mech = filter(noise(dur, "white", seed), "bandpass", 1300, 0.8);
  const mod = envelope(dur, [[0, 0], [0.05, 1], [dur - 0.05, 1], [dur, 0]]);
  const x = add(scale(motor, 0.6), scale(mech, 0.35));
  return am(applyEnv(x, [[0, 0], [0.04, 1], [dur - 0.04, 1], [dur, 0]]), rate, 0.75).map((v, i) => v * mod[i]);
}

function engineFiring(dur: number, firing: [number, number][], seed: number, cutoffMul = 4, rough = 1): Float32Array {
  const pulse = osc(dur, firing, "pulse", 0.18);
  const body = filter(pulse, "lowpass", firing.map(([t, f]) => [t, Math.min(4000, f * cutoffMul)] as [number, number]), 1.2);
  const exhaust = filter(noise(dur, "pink", seed), "bandpass", firing.map(([t, f]) => [t, f * 6] as [number, number]), 0.8);
  return add(scale(drive(body, 2.5 * rough), 0.8), scale(am(exhaust, firing, 0.8), 0.35 * rough));
}

function carStart(): Float32Array {
  const pop = (seed: number) => burst(0.07, "lowpass", 420, 0.9, [[0, 0], [0.005, 1], [0.07, 0]], seed, "brown");
  const idle = engineFiring(1.0, [[0, 22], [0.25, 55], [0.55, 40], [1.0, 32]], 8, 5);
  return finish(
    timeline(4.1, [
      [0.0, crank(1.0, 1)],
      [1.25, crank(0.9, 2)],
      [2.35, crank(0.6, 3)],
      [2.95, pop(4), 1.4],
      [3.1, pop(5), 1.2],
      [3.13, applyEnv(idle, [[0, 0], [0.05, 1], [0.8, 0.9], [1.0, 0]]), 0.9],
    ]),
  );
}

function oldEngine(): Float32Array {
  const dur = 3.1;
  const out = new Float32Array(Math.round(dur * 22050));
  let t = 0.05;
  let seed = 20;
  const thump = (s: number) =>
    add(
      applyEnv(osc(0.09, [[0, 95], [0.09, 55]], "sine"), [[0, 0], [0.004, 1], [0.09, 0]]),
      scale(burst(0.06, "lowpass", 600, 0.8, [[0, 0], [0.003, 1], [0.06, 0]], s, "brown"), 0.8),
    );
  const click = (s: number) => burst(0.012, "highpass", 3500, 0.7, [[0, 0], [0.001, 1], [0.012, 0]], s);
  while (t < dur - 0.15) {
    const th = thump(seed++);
    const s0 = Math.round(t * 22050);
    for (let i = 0; i < th.length && s0 + i < out.length; i++) out[s0 + i] += th[i];
    if (seed % 3 === 0) {
      const c = click(seed + 100);
      const s1 = s0 + Math.round(0.035 * 22050);
      for (let i = 0; i < c.length && s1 + i < out.length; i++) out[s1 + i] += c[i] * 0.25;
    }
    // توقيت غير منتظم: محرك قديم يتعثر
    const base = t > 2.0 && t < 2.3 ? 0.16 : 0.075;
    t += base * (0.82 + ((seed * 7919) % 100) / 280);
  }
  const backfire = burst(0.12, "lowpass", 900, 0.7, [[0, 0], [0.002, 1], [0.12, 0]], 99, "white");
  const s2 = Math.round(2.35 * 22050);
  for (let i = 0; i < backfire.length && s2 + i < out.length; i++) out[s2 + i] += backfire[i] * 1.6;
  return finish(filter(out, "lowpass", 2200, 0.7));
}

function motorcycle(): Float32Array {
  const firing: [number, number][] = [[0, 38], [0.4, 46], [1.0, 140], [1.35, 152], [1.9, 72], [2.6, 46]];
  const x = engineFiring(2.7, firing, 31, 5, 1.2);
  return finish(applyEnv(x, [[0, 0], [0.05, 0.8], [1.2, 1], [2.4, 0.8], [2.7, 0]]));
}

function train(): Float32Array {
  const items: [number, Float32Array, number?][] = [];
  let t = 0;
  let gap = 0.42;
  let k = 0;
  while (t < 2.5) {
    const ch = burst(0.13, "bandpass", 1500, 0.7, [[0, 0], [0.01, 1], [0.13, 0]], 40 + k, "white");
    items.push([t, ch, k % 2 ? 0.7 : 1]);
    const clack = burst(0.03, "bandpass", 700, 2, [[0, 0], [0.002, 1], [0.03, 0]], 80 + k);
    items.push([t + gap * 0.5, clack, 0.3]);
    t += gap;
    gap = Math.max(0.2, gap * 0.9);
    k++;
  }
  const wDur = 1.3;
  const whistle = add(
    osc(wDur, [[0, 440], [0.08, 466], [wDur, 462]], "tri"),
    scale(osc(wDur, [[0, 560], [0.08, 587], [wDur, 582]], "tri"), 0.8),
    scale(burst(wDur, "bandpass", 2400, 1, [[0, 0], [0.05, 1], [wDur, 0.6]], 77), 0.3),
  );
  items.push([2.65, applyEnv(whistle, [[0, 0], [0.06, 1], [wDur - 0.15, 0.9], [wDur, 0]]), 0.9]);
  return finish(timeline(4.05, items));
}

function carHorn(): Float32Array {
  const beep = (dur: number) => {
    const two = add(osc(dur, 415, "square"), scale(osc(dur, 494, "square"), 0.9));
    const shaped = filter(filter(two, "peak", 1800, 1.5, 9), "lowpass", 3500, 0.7);
    return applyEnv(drive(shaped, 1.6), [[0, 0], [0.01, 1], [dur - 0.02, 1], [dur, 0]]);
  };
  return finish(timeline(1.75, [[0, beep(0.18)], [0.3, beep(0.18)], [0.62, beep(0.78)]]));
}

function vacuum(): Float32Array {
  const dur = 3.6;
  const rot: [number, number][] = [[0, 70], [0.7, 320], [3.0, 335], [3.6, 110]];
  const motor = add(osc(dur, rot, "sine"), scale(osc(dur, rot.map(([t, f]) => [t, f * 2] as [number, number]), "sine"), 0.5));
  const whine = filter(osc(dur, rot.map(([t, f]) => [t, f * 6] as [number, number]), "saw"), "bandpass", rot.map(([t, f]) => [t, f * 6] as [number, number]), 6);
  const air = filter(noise(dur, "pink", 55), "bandpass", [[0, 400], [0.8, 1300], [3.0, 1350], [3.6, 500]], 0.5);
  const x = add(scale(motor, 0.25), scale(whine, 0.5), scale(air, 1.1));
  return finish(applyEnv(x, [[0, 0], [0.6, 0.85], [1.0, 1], [3.0, 1], [3.6, 0]]));
}

// ───────────── أصوات بشرية مضحكة ─────────────

function oldSneeze(): Float32Array {
  const ah = (dur: number, f: [number, number], g: number, seed: number) =>
    scale(
      voiced(dur, [[0, f[0]], [dur, f[1]]], [[0, "a"], [dur, "a"]], { breath: 0.55, vibRate: 5.5, vibDepth: 0.5, jitter: 0.02, tilt: 2400, seed, env: [[0, 0], [dur * 0.6, 1], [dur, 0.3]] }),
      g,
    );
  const ch = burst(0.1, "highpass", 2800, 0.8, [[0, 0], [0.005, 1], [0.1, 0.4]], 66);
  const oo = add(
    voiced(0.55, [[0, 300], [0.55, 175]], [[0, "u"], [0.55, "u"]], { breath: 0.35, rough: 0.2, tilt: 3000, env: [[0, 0], [0.02, 1], [0.55, 0]] }),
    scale(burst(0.4, "bandpass", 1200, 0.8, [[0, 1], [0.4, 0]], 67), 0.35),
  );
  return finish(
    timeline(2.75, [
      [0, ah(0.45, [140, 170], 0.45, 1)],
      [0.7, ah(0.55, [160, 215], 0.65, 2)],
      [1.4, ah(0.33, [205, 260], 0.8, 3)],
      [1.75, ch, 1.3],
      [1.83, oo, 1.1],
    ]),
  );
}

function weirdLaugh(): Float32Array {
  const hee = (f: number, seed: number) =>
    add(
      voiced(0.1, [[0, f], [0.1, f * 0.95]], [[0, "i"], [0.1, "i"]], { scale: 1.1, breath: 0.25, tilt: 4000, seed, env: quickEnv(0.1, 0.008, 0.03) }),
      scale(burst(0.03, "highpass", 2000, 0.7, [[0, 1], [0.03, 0]], seed + 5), 0.3),
    );
  const hoo = (f: number, seed: number) => voiced(0.15, [[0, f], [0.15, f * 0.9]], [[0, "u"], [0.15, "o"]], { breath: 0.2, tilt: 3000, seed, env: quickEnv(0.15, 0.01, 0.04) });
  const snort = add(
    am(burst(0.28, "lowpass", 650, 1, [[0, 0], [0.02, 1], [0.28, 0]], 90, "pink"), 34, 0.85),
    scale(voiced(0.28, 105, [[0, "m"], [0.28, "m"]], { rough: 0.8, breath: 0.3, env: [[0, 0], [0.03, 1], [0.28, 0]] }), 0.6),
  );
  const ha = (f: number, seed: number) => voiced(0.12, [[0, f], [0.12, f * 0.92]], [[0, "a"], [0.12, "a"]], { breath: 0.3, tilt: 3200, seed, env: quickEnv(0.12, 0.01, 0.04) });
  return finish(
    timeline(2.35, [
      [0, hee(540, 1)],
      [0.16, hee(560, 2)],
      [0.32, hee(590, 3)],
      [0.55, hoo(270, 4)],
      [0.77, hoo(250, 5)],
      [1.02, snort, 1.2],
      [1.45, ha(300, 6)],
      [1.62, ha(280, 7)],
      [1.79, ha(260, 8)],
      [1.96, ha(240, 9)],
    ]),
  );
}

function scream(): Float32Array {
  const dur = 1.25;
  const s = voiced(dur, [[0, 480], [0.08, 820], [0.9, 780], [1.25, 610]], [[0, "ae"], [0.3, "a"], [1.25, "a"]], {
    scale: 1.1,
    rough: 0.35,
    breath: 0.2,
    vibRate: 6.5,
    vibDepth: 0.6,
    jitter: 0.03,
    tilt: 6500,
    env: [[0, 0], [0.02, 1], [0.95, 0.9], [1.25, 0]],
  });
  return finish(reverb(drive(s, 2), 0.15, 0.6, 0.5));
}

function snore(): Float32Array {
  const inhale = (dur: number, seed: number) =>
    add(
      am(filter(add(noise(dur, "brown", seed), scale(noise(dur, "pink", seed + 1), 0.5)), "bandpass", 320, 1.1), [[0, 28], [dur, 34]], 0.9),
      scale(voiced(dur, [[0, 68], [dur, 74]], [[0, "o"], [dur, "u"]], { rough: 0.9, breath: 0.5, jitter: 0.08, tilt: 900, seed }), 0.45),
    );
  const exhale = (dur: number) =>
    add(burst(dur, "highpass", 1500, 0.7, [[0, 0], [0.1, 0.5], [dur, 0]], 77), scale(applyEnv(osc(dur, [[0, 1500], [dur, 1350]], "sine"), [[0, 0], [0.15, 0.25], [dur, 0]]), 0.6));
  const env = (dur: number): Pts => [[0, 0], [dur * 0.6, 1], [dur, 0]];
  return finish(
    timeline(3.9, [
      [0, applyEnv(inhale(1.3, 1), env(1.3))],
      [1.45, exhale(1.0), 0.45],
      [2.6, applyEnv(inhale(1.25, 5), env(1.25))],
    ]),
  );
}

function yawn(): Float32Array {
  const dur = 2.45;
  return finish(
    voiced(dur, [[0, 200], [0.4, 310], [1.0, 290], [1.8, 180], [2.45, 120]], [[0, "a"], [0.9, "a"], [1.5, "o"], [2.0, "u"], [2.45, "m"]], {
      breath: 0.45,
      tilt: 2300,
      vibRate: 5,
      vibDepth: 0.2,
      jitter: 0.015,
      env: [[0, 0], [0.3, 0.8], [1.0, 1], [1.8, 0.7], [2.45, 0]],
    }),
  );
}

function evilLaugh(): Float32Array {
  const mwah = voiced(0.36, [[0, 108], [0.15, 142], [0.36, 122]], [[0, "m"], [0.1, "w"], [0.17, "a"], [0.36, "a"]], { rough: 0.35, breath: 0.15, tilt: 2600, env: quickEnv(0.36, 0.03, 0.06) });
  const ha = (f: number, seed: number, dur = 0.18) =>
    add(
      scale(burst(0.035, "bandpass", 1500, 0.6, [[0, 1], [0.035, 0]], seed + 40), 0.5),
      voiced(dur, [[0, f * 1.05], [dur, f * 0.92]], [[0, "a"], [dur, "a"]], { rough: 0.4, breath: 0.2, tilt: 2800, seed, env: [[0, 0], [0.03, 1], [dur * 0.7, 0.7], [dur, 0]] }),
    );
  const finale = voiced(0.95, [[0, 150], [0.3, 205], [0.95, 165]], [[0, "a"], [0.95, "a"]], { rough: 0.45, breath: 0.2, vibRate: 5, vibDepth: 0.5, tilt: 3000, env: [[0, 0], [0.05, 1], [0.7, 0.9], [0.95, 0]] });
  const x = timeline(3.15, [
    [0, mwah],
    [0.5, ha(132, 1)],
    [0.76, ha(127, 2)],
    [1.0, ha(122, 3)],
    [1.22, ha(118, 4)],
    [1.42, ha(115, 5)],
    [1.75, finale, 1.1],
  ]);
  return finish(reverb(x, 0.3, 0.85, 1.0));
}

// ───────────── أصوات صعبة ─────────────

function multiTone(): Float32Array {
  const n = (dur: number, f: [number, number][], v: string, seed: number) => voiced(dur, f, [[0, v], [dur, v]], { breath: 0.1, tilt: 3500, seed, env: quickEnv(dur, 0.015, 0.04) });
  return finish(
    timeline(2.55, [
      [0, n(0.4, [[0, 140], [0.4, 145]], "o", 1)],
      [0.47, n(0.3, [[0, 620], [0.3, 640]], "i", 2)],
      [0.84, n(0.45, [[0, 330], [0.45, 320]], "a", 3)],
      [1.36, n(0.25, [[0, 520], [0.25, 540]], "e", 4)],
      [1.68, n(0.75, [[0, 250], [0.35, 700], [0.75, 400]], "u", 5)],
    ]),
  );
}

function staccato(): Float32Array {
  const items: [number, Float32Array, number?][] = [];
  const pitches = [300, 340, 380, 340, 300, 400, 300, 450, 300, 340, 380, 420, 460, 300, 300, 500];
  const vow = ["a", "a", "i", "a", "a", "i", "a", "o", "a", "a", "i", "a", "i", "o", "a", "i"];
  pitches.forEach((f, i) => {
    const t = i * 0.135;
    const cons = burst(0.018, "highpass", 2500, 0.7, [[0, 1], [0.018, 0]], 200 + i);
    const syl = voiced(0.07, f, [[0, vow[i]], [0.07, vow[i]]], { breath: 0.1, tilt: 3500, seed: i, env: [[0, 0], [0.006, 1], [0.05, 0.7], [0.07, 0]] });
    items.push([t, cons, 0.4], [t + 0.012, syl, i % 4 === 0 ? 1 : 0.7]);
  });
  return finish(timeline(2.3, items));
}

function riseFall(): Float32Array {
  const dur = 3.2;
  return finish(
    voiced(dur, [[0, 180], [1.0, 520], [1.6, 260], [2.4, 600], [3.2, 200]], [[0, "u"], [1.0, "i"], [1.6, "u"], [2.4, "i"], [3.2, "u"]], {
      breath: 0.08,
      tilt: 3200,
      vibRate: 5.5,
      vibDepth: 0.15,
      env: [[0, 0], [0.12, 1], [3.0, 0.9], [3.2, 0]],
    }),
  );
}

function beatPattern(): Float32Array {
  const kick = () => applyEnv(osc(0.14, [[0, 130], [0.14, 45]], "sine"), [[0, 0], [0.003, 1], [0.14, 0]]);
  const snare = (s: number) => add(burst(0.13, "bandpass", 2200, 0.6, [[0, 0], [0.002, 1], [0.13, 0]], s), scale(applyEnv(osc(0.08, 210, "sine"), [[0, 1], [0.08, 0]]), 0.5));
  const hat = (s: number) => burst(0.045, "highpass", 7000, 0.7, [[0, 0], [0.001, 1], [0.045, 0]], s);
  const step = 60 / 128 / 4;
  const pat = "K.h.S.hKK.h.S.h.K.h.S.hKKhh.S.Sh";
  const items: [number, Float32Array, number?][] = [];
  [...pat].forEach((c, i) => {
    const t = i * step;
    if (c === "K") items.push([t, kick(), 1]);
    if (c === "S") items.push([t, snare(300 + i), 0.8]);
    if (c === "h") items.push([t, hat(500 + i), 0.35]);
  });
  return finish(timeline(pat.length * step + 0.3, items));
}

// ───────────── الباقة السعودية ─────────────

function drift(): Float32Array {
  const dur = 3.5;
  const eng = engineFiring(dur, [[0, 32], [0.5, 92], [1.2, 112], [2.4, 104], [3.5, 58]], 61, 4, 1.1);
  const screechSrc = noise(dur, "white", 62);
  const fm = (t: number) => 1100 + 70 * Math.sin(2 * Math.PI * 7.3 * t) + 40 * Math.sin(2 * Math.PI * 13.1 * t);
  const screech = add(filter(screechSrc, "bandpass", fm, 22), scale(filter(screechSrc, "bandpass", (t) => fm(t) * 2, 25), 0.5));
  const tires = applyEnv(scale(screech, 2.2), [[0, 0], [0.8, 0], [1.0, 1], [2.9, 0.9], [3.2, 0]]);
  return finish(add(applyEnv(eng, [[0, 0], [0.05, 0.7], [1.0, 1], [3.5, 0.6]]), drive(tires, 1.4)));
}

function pickupHorn(): Float32Array {
  const blast = (dur: number) => {
    const two = add(osc(dur, [[0, 335], [dur, 326]], "square"), scale(osc(dur, [[0, 398], [dur, 390]], "square"), 0.8));
    return applyEnv(drive(filter(filter(two, "peak", 1050, 1.3, 10), "lowpass", 2800, 0.8), 2), [[0, 0], [0.012, 1], [dur - 0.03, 1], [dur, 0]]);
  };
  return finish(timeline(1.75, [[0, blast(0.15)], [0.24, blast(0.15)], [0.5, blast(0.85)]]));
}

function windowAC(): Float32Array {
  const dur = 3.6;
  const hum = add(osc(dur, 120, "sine"), scale(osc(dur, 240, "sine"), 0.45), scale(osc(dur, 360, "sine"), 0.2));
  const humEnv = applyEnv(hum, [[0, 0], [0.8, 0], [0.95, 1.1], [1.2, 0.85], [dur, 0.85]]);
  const fan = filter(noise(dur, "pink", 70), "lowpass", 1500, 0.6);
  const rattle = applyEnv(am(burst(dur, "bandpass", 2300, 3, [[0, 1], [dur, 1]], 71), 18, 1, "pulse"), [[0, 0], [0.9, 0], [1.1, 0.5], [dur, 0.45]]);
  const clunk = burst(0.12, "lowpass", 300, 1.2, [[0, 0], [0.003, 1], [0.12, 0]], 72, "brown");
  return finish(add(scale(humEnv, 0.35), scale(applyEnv(fan, [[0, 0.6], [dur, 0.7]]), 0.9), scale(rattle, 0.12), timeline(dur, [[0.8, clunk, 2]])));
}

function mihbash(): Float32Array {
  const hit = (pitch: number, accent: number, seed: number) => {
    const wood = add(
      applyEnv(osc(0.07, [[0, pitch * 1.1], [0.07, pitch]], "sine"), [[0, 0], [0.002, 1], [0.07, 0]]),
      scale(burst(0.04, "bandpass", pitch * 2.2, 2, [[0, 0], [0.001, 1], [0.04, 0]], seed), 0.6),
    );
    const ring = add(
      ...[1310, 2120, 3010, 3870].map((f, k) => scale(applyEnv(osc(0.4, f * (pitch / 420), "sine"), [[0, 0], [0.002, 1], [0.4, 0]]), 0.18 / (k + 1))),
    );
    return scale(add(wood, scale(ring, 0.7)), accent);
  };
  // إيقاع المهباش: دُم (ضربة القاع) وتَك (ضربة الجانب)
  const pattern: [number, "D" | "T"][] = [
    [0, "D"], [0.28, "T"], [0.42, "T"], [0.7, "D"], [0.98, "T"], [1.12, "D"], [1.26, "D"], [1.54, "T"],
    [1.82, "D"], [2.1, "T"], [2.24, "T"], [2.52, "D"], [2.8, "T"], [2.94, "D"], [3.08, "D"],
  ];
  return finish(timeline(3.45, pattern.map(([t, k], i) => [t, k === "D" ? hit(380, 1, i) : hit(560, 0.65, i + 50)] as [number, Float32Array])));
}

function camel(): Float32Array {
  const dur = 2.3;
  const g = voiced(dur, [[0, 88], [0.4, 122], [1.4, 102], [2.3, 70]], [[0, "o"], [0.5, "a"], [1.6, "o"], [2.3, "u"]], {
    scale: 0.75,
    rough: 0.85,
    jitter: 0.08,
    shimmer: 0.2,
    breath: 0.4,
    tilt: 2200,
    env: [[0, 0], [0.15, 0.8], [0.5, 1], [1.8, 0.85], [2.3, 0]],
  });
  const gurgle = am(g, (t) => 11 + 4 * Math.sin(2 * Math.PI * 1.3 * t), 0.55);
  return finish(drive(gurgle, 2.8));
}

function atv(): Float32Array {
  const firing: [number, number][] = [[0, 70], [0.3, 140], [0.8, 185], [1.2, 120], [1.6, 195], [2.4, 165], [2.95, 90]];
  const x = engineFiring(3.0, firing, 81, 7, 1.3);
  const buzz = filter(osc(3.0, firing.map(([t, f]) => [t, f * 2] as [number, number]), "saw"), "bandpass", firing.map(([t, f]) => [t, f * 8] as [number, number]), 2);
  const wind = filter(noise(3.0, "pink", 82), "bandpass", 700, 0.5);
  return finish(applyEnv(add(x, scale(buzz, 0.4), scale(wind, 0.25)), [[0, 0], [0.08, 0.8], [0.8, 1], [2.6, 0.9], [3.0, 0]]));
}

function robotHala(): Float32Array {
  // «هلا والله» بصوت روبوت: مصدر مربع بطبقة متدرجة + انتقالات الحروف
  const dur = 1.55;
  const steps: [number, number][] = [[0, 120], [0.3, 132], [0.62, 126], [0.95, 118], [1.25, 100], [1.55, 96]];
  const quant = (t: number) => {
    let f = steps[0][1];
    for (const [ts, fs] of steps) if (t >= ts) f = fs;
    return f;
  };
  const src = add(voiceSource(dur, quant, { breath: 0.04, tilt: 4500, seed: 9 }), scale(osc(dur, quant, "square"), 0.25));
  const seq: [number, string][] = [
    [0, "a"], [0.07, "a"], [0.22, "l"], [0.3, "a"], [0.5, "a"], [0.56, "w"], [0.64, "a"], [0.8, "l"], [0.95, "l"], [1.0, "a"], [1.35, "a"],
  ];
  let speech = formantFilter(src, vowels(seq, 1.05));
  speech = applyEnv(speech, [[0, 0], [0.06, 0], [0.08, 1], [0.48, 1], [0.52, 0.15], [0.57, 0.8], [0.62, 1], [1.35, 0.9], [1.45, 0]]);
  const h1 = burst(0.07, "bandpass", 1600, 0.6, [[0, 0], [0.01, 0.6], [0.07, 0]], 91);
  const h2 = burst(0.1, "bandpass", 1400, 0.6, [[0, 0.5], [0.1, 0]], 92);
  const ring = am(add(speech, timeline(dur, [[0, h1, 0.5], [1.42, h2, 0.4]])), 55, 0.35);
  const beep = applyEnv(osc(0.16, [[0, 880], [0.16, 1320]], "square"), [[0, 0], [0.01, 0.3], [0.16, 0]]);
  return finish(timeline(1.95, [[0, ring], [1.7, beep, 0.5]]));
}

export const PACKS: PackRecipe[] = [
  {
    id: "animals",
    category: "animals",
    emoji: "🐾",
    name: { ar: "أصوات الحيوانات", en: "Animal Sounds" },
    description: { ar: "دجاجة وبقرة وقطة معصبة وحمار وأكثر", en: "Chicken, cow, angry cat, donkey and more" },
    sounds: [
      { id: "chicken", emoji: "🐔", difficulty: 1, name: { ar: "دجاجة", en: "Chicken" }, make: chicken },
      { id: "cow", emoji: "🐄", difficulty: 1, name: { ar: "بقرة", en: "Cow" }, make: cow, weights: { pitch: 0.3 } },
      { id: "angry-cat", emoji: "😾", difficulty: 2, name: { ar: "قطة معصبة", en: "Angry cat" }, make: angryCat },
      { id: "donkey", emoji: "🫏", difficulty: 2, name: { ar: "حمار", en: "Donkey" }, make: donkey, weights: { rhythm: 0.25 } },
      { id: "dog", emoji: "🐕", difficulty: 1, name: { ar: "كلب", en: "Dog" }, make: dog, weights: { rhythm: 0.25, timing: 0.18 } },
      { id: "rooster", emoji: "🐓", difficulty: 2, name: { ar: "ديك", en: "Rooster" }, make: rooster, weights: { pitch: 0.3 } },
      { id: "sheep", emoji: "🐑", difficulty: 1, name: { ar: "خروف", en: "Sheep" }, make: sheep },
    ],
  },
  {
    id: "machines",
    category: "machines",
    emoji: "🚗",
    name: { ar: "سيارات وآلات", en: "Cars & Machines" },
    description: { ar: "سيارة ما تبي تشتغل، محرك قديم، قطار، مكنسة", en: "A car that won't start, old engine, train, vacuum" },
    sounds: [
      { id: "car-start", emoji: "🚙", difficulty: 2, name: { ar: "سيارة تحاول تشتغل", en: "Car trying to start" }, make: carStart, weights: { rhythm: 0.25 } },
      { id: "old-engine", emoji: "🛻", difficulty: 2, name: { ar: "محرك قديم", en: "Old engine" }, make: oldEngine, weights: { rhythm: 0.28, pitch: 0.12 } },
      { id: "motorcycle", emoji: "🏍️", difficulty: 1, name: { ar: "دراجة نارية", en: "Motorcycle" }, make: motorcycle, weights: { energy: 0.22 } },
      { id: "train", emoji: "🚂", difficulty: 2, name: { ar: "قطار", en: "Train" }, make: train, weights: { rhythm: 0.26 } },
      { id: "car-horn", emoji: "📯", difficulty: 1, name: { ar: "بوق سيارة", en: "Car horn" }, make: carHorn, weights: { timing: 0.2 } },
      { id: "vacuum", emoji: "🧹", difficulty: 1, name: { ar: "مكنسة كهربائية", en: "Vacuum cleaner" }, make: vacuum, weights: { energy: 0.22 } },
    ],
  },
  {
    id: "human",
    category: "human",
    emoji: "😂",
    name: { ar: "أصوات بشرية مضحكة", en: "Funny Human Sounds" },
    description: { ar: "شايب يعطس، ضحكة غريبة، شخير، تثاؤب", en: "Old man sneeze, weird laugh, snoring, yawning" },
    sounds: [
      { id: "old-sneeze", emoji: "🤧", difficulty: 1, name: { ar: "شايب يعطس", en: "Old man sneezing" }, make: oldSneeze, weights: { timing: 0.18 } },
      { id: "weird-laugh", emoji: "🤪", difficulty: 2, name: { ar: "ضحكة غريبة", en: "Weird laugh" }, make: weirdLaugh, weights: { rhythm: 0.25 } },
      { id: "scream", emoji: "😱", difficulty: 1, name: { ar: "صرخة مفاجئة", en: "Sudden scream" }, make: scream },
      { id: "snore", emoji: "😴", difficulty: 1, name: { ar: "شخص يشخر", en: "Snoring" }, make: snore, weights: { rhythm: 0.24 } },
      { id: "yawn", emoji: "🥱", difficulty: 1, name: { ar: "شخص يتثاوب", en: "Yawning" }, make: yawn, weights: { pitch: 0.3 } },
      { id: "evil-laugh", emoji: "😈", difficulty: 2, name: { ar: "ضحكة شريرة", en: "Evil laugh" }, make: evilLaugh, weights: { rhythm: 0.24 } },
    ],
  },
  {
    id: "hard",
    category: "hard",
    emoji: "🔥",
    name: { ar: "أصوات صعبة", en: "Hard Sounds" },
    description: { ar: "نبرات مركبة، تقطيع سريع، صعود وهبوط، إيقاع", en: "Compound tones, rapid staccato, rise & fall, rhythm" },
    sounds: [
      { id: "multi-tone", emoji: "🎼", difficulty: 3, name: { ar: "صوت مركب من عدة نبرات", en: "Multi-tone combo" }, make: multiTone, weights: { pitch: 0.34 } },
      { id: "staccato", emoji: "⚡", difficulty: 3, name: { ar: "صوت متقطع سريع", en: "Rapid staccato" }, make: staccato, weights: { rhythm: 0.3, timing: 0.18 } },
      { id: "rise-fall", emoji: "🎢", difficulty: 3, name: { ar: "صوت يصعد ويهبط", en: "Rise and fall" }, make: riseFall, weights: { pitch: 0.4 } },
      { id: "beat", emoji: "🥁", difficulty: 3, name: { ar: "تكرار إيقاعي صعب", en: "Tricky rhythm" }, make: beatPattern, weights: { rhythm: 0.32, timing: 0.2, pitch: 0.08 } },
    ],
  },
  {
    id: "saudi",
    category: "saudi",
    emoji: "🇸🇦",
    name: { ar: "الباقة السعودية", en: "Saudi Pack" },
    description: { ar: "تفحيط، بوري ونيت، مكيف شباك، مهباش، جمل، دباب", en: "Drifting, pickup horn, window AC, mihbash, camel, ATV" },
    sounds: [
      { id: "drift", emoji: "🏎️", difficulty: 2, name: { ar: "تفحيط", en: "Drifting" }, make: drift, weights: { energy: 0.22 } },
      { id: "pickup-horn", emoji: "🛻", difficulty: 1, name: { ar: "بوري الونيت", en: "Pickup truck horn" }, make: pickupHorn, weights: { timing: 0.2 } },
      { id: "window-ac", emoji: "🥵", difficulty: 2, name: { ar: "مكيف شباك يشتغل", en: "Window AC starting" }, make: windowAC },
      { id: "mihbash", emoji: "☕", difficulty: 3, name: { ar: "إيقاع المهباش", en: "Mihbash coffee rhythm" }, make: mihbash, weights: { rhythm: 0.32, timing: 0.2, pitch: 0.08 } },
      { id: "camel", emoji: "🐪", difficulty: 2, name: { ar: "جمل معصب", en: "Grumpy camel" }, make: camel },
      { id: "atv", emoji: "🏜️", difficulty: 1, name: { ar: "دباب في البر", en: "ATV in the desert" }, make: atv, weights: { energy: 0.22 } },
      { id: "robot-hala", emoji: "🤖", difficulty: 2, name: { ar: "روبوت الاستراحة: «هلا والله»", en: "Istiraha robot: “Hala wallah”" }, make: robotHala },
    ],
  },
];
