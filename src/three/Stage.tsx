// الاستوديو ثلاثي الأبعاد: أرضية مضيئة، طاولة دائرية، شاشة كبيرة، أضواء ملونة، شخصيات اللاعبين،
// وكاميرا افتراضية تتحرك بنعومة حسب مرحلة الجولة. وضع خفيف للجوالات الضعيفة.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, Color, DoubleSide, type Group, type Mesh, type MeshStandardMaterial, Vector3 } from "three";
import type { Avatar, RoomView } from "../../shared/types";
import { game } from "../game/client";
import { director, liveLevel, referenceLevel } from "../game/director";
import { translate } from "../lib/lang";
import { prefs } from "../lib/prefs";
import { useStore } from "../lib/store";
import type { I18nKey } from "../lib/i18n";
import { Character, type Mood } from "./Character";
import { drawText, makeTexture, whenFonts } from "./textures";

type Mode = "showcase" | "room";

const DEMO: { name: string; avatar: Avatar }[] = [
  { name: "سارة", avatar: { color: 4, hat: 5, eyes: 0 } },
  { name: "أبو فهد", avatar: { color: 1, hat: 3, eyes: 1 } },
  { name: "نورة", avatar: { color: 2, hat: 7, eyes: 3 } },
  { name: "خالد", avatar: { color: 3, hat: 1, eyes: 0 } },
  { name: "ريم", avatar: { color: 6, hat: 6, eyes: 2 } },
];

const R = 2.55;

function seat(i: number, n: number): { pos: [number, number, number]; rot: number } {
  const spread = Math.min(80, 22 + n * 9);
  const a = ((n === 1 ? 0 : -spread + (2 * spread * i) / (n - 1)) * Math.PI) / 180;
  return { pos: [R * Math.sin(a), 0, -R * Math.cos(a)], rot: -a };
}

function Floor({ low }: { low: boolean }) {
  const ringA = useRef<MeshStandardMaterial>(null);
  const ringB = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ringA.current) ringA.current.emissiveIntensity = 1.2 + Math.sin(t * 2) * 0.4;
    if (ringB.current) ringB.current.emissiveIntensity = 1 + Math.sin(t * 2 + 2) * 0.4;
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow={!low}>
        <circleGeometry args={[9, 64]} />
        <meshStandardMaterial color="#1a1040" roughness={0.35} metalness={0.25} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[3.55, 3.7, 96]} />
        <meshStandardMaterial ref={ringA} color="#fb923c" emissive="#f97316" emissiveIntensity={1.2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[6.4, 6.55, 96]} />
        <meshStandardMaterial ref={ringB} color="#38bdf8" emissive="#3b82f6" emissiveIntensity={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[3.55, 64]} />
        <meshStandardMaterial color="#2a1a63" roughness={0.3} metalness={0.3} />
      </mesh>
    </group>
  );
}

function Table() {
  const orb = useRef<Mesh>(null);
  const orbMat = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const v = game.view;
    const playing = director.get().playingId;
    const l = Math.max(referenceLevel(), playing ? liveLevel(playing) : 0);
    const s = 1 + l * 0.6 + Math.sin(clock.elapsedTime * 2) * 0.03;
    orb.current?.scale.setScalar(s);
    if (orbMat.current) {
      orbMat.current.emissiveIntensity = 0.8 + l * 3;
      orbMat.current.emissive.set(v?.phase === "record" ? "#ef4444" : l > 0.05 ? "#fb923c" : "#8b5cf6");
    }
  });
  return (
    <group>
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.55, 1.45, 0.14, 48]} />
        <meshStandardMaterial color="#3a2480" roughness={0.3} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.55, 0.05, 10, 64]} />
        <meshStandardMaterial color="#fde047" metalness={0.9} roughness={0.2} emissive="#b45309" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.3, 0.55, 0.72, 24]} />
        <meshStandardMaterial color="#29185f" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh ref={orb} position={[0, 1.05, 0]}>
        <sphereGeometry args={[0.22, 24, 16]} />
        <meshStandardMaterial ref={orbMat} color="#1c1146" emissive="#8b5cf6" emissiveIntensity={1} roughness={0.2} />
      </mesh>
    </group>
  );
}

function screenLines(mode: Mode, v: RoomView | null): { text: string; size: number; color?: string; y: number }[] {
  const lang = prefs.get().lang;
  const t = (k: I18nKey, vars?: Record<string, string | number>) => translate(lang, k, vars);
  if (mode === "showcase" || !v) {
    // عرض تشويقي: أصوات من المكتبة تتبدل على الشاشة
    const teasers = lang === "ar" ? ["🐔 دجاجة؟", "🫏 حمار؟", "🚗 سيارة ما تشتغل؟", "🤧 شايب يعطس؟", "🐪 جمل معصب؟"] : ["🐔 Chicken?", "🫏 Donkey?", "🚗 Stalling car?", "🤧 Old man sneeze?", "🐪 Grumpy camel?"];
    return [{ text: teasers[Math.floor(Date.now() / 2600) % teasers.length], size: 120, color: "#fde68a", y: 256 }];
  }
  const name = (id: string) => game.nameOf(id);
  switch (v.phase) {
    case "lobby":
      return [
        { text: v.name, size: 90, color: "#fde68a", y: 170 },
        { text: `${t("lobby.code")}: ${v.code}`, size: 110, color: "#fff", y: 320 },
      ];
    case "intro":
      return [{ text: t("phase.intro", { round: v.round, total: v.totalRounds }), size: 130, color: "#fde047", y: 256 }];
    case "listen":
      return [
        { text: v.sound ? `${v.sound.emoji} ${v.sound.name[lang]}` : "", size: 120, color: "#fff", y: 200 },
        { text: t("phase.listenOnce"), size: 60, color: "#a78bfa", y: 360 },
      ];
    case "countdown":
      return [{ text: "3 … 2 … 1", size: 160, color: "#fde047", y: 256 }];
    case "record":
      return [{ text: t("phase.go"), size: 220, color: "#fb7185", y: 256 }];
    case "collect":
      return [{ text: t("phase.scoring"), size: 100, color: "#fff", y: 256 }];
    case "reveal": {
      const cur = v.reveal?.current;
      if (!cur) return [];
      const res = cur.result;
      return [
        { text: name(cur.playerId), size: 110, color: "#fde68a", y: 170 },
        {
          text: res ? (res.status === "ok" && res.score !== null ? `${res.score}/100` : "—") : cur.sabotage ? t(`sab.${cur.sabotage}` as I18nKey) : "🔊",
          size: res ? 170 : 90,
          color: res && (res.score ?? 0) >= 80 ? "#34d399" : "#fff",
          y: 340,
        },
      ];
    }
    case "vote":
      return [{ text: t("phase.vote"), size: 100, color: "#fde047", y: 256 }];
    case "leaderboard": {
      const top = [...v.players].sort((a, b) => b.score - a.score).slice(0, 3);
      return top.map((p, i) => ({ text: `${["🥇", "🥈", "🥉"][i]} ${p.name} — ${p.score}`, size: 86, color: i === 0 ? "#fde047" : "#fff", y: 130 + i * 125 }));
    }
    case "wheel":
      return [
        { text: t("phase.wheel"), size: 130, color: "#fde047", y: 190 },
        { text: v.wheel ? name(v.wheel.spinnerId) : "", size: 90, color: "#fff", y: 340 },
      ];
    case "final": {
      const w = v.final?.ranking[0];
      return [
        { text: "🏆", size: 150, y: 170 },
        { text: w ? `${w.name} — ${w.score}` : "", size: 110, color: "#fde047", y: 350 },
      ];
    }
  }
}

function BigScreen({ mode }: { mode: Mode }) {
  const g = useStore(game.store);
  const p = useStore(prefs);
  const canvas = useMemo(() => document.createElement("canvas"), []);
  const tex = useMemo(() => makeTexture(canvas), [canvas]);
  const bars = useRef<Group>(null);
  const hist = useRef<number[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (mode !== "showcase") return;
    const id = setInterval(() => setTick((n) => n + 1), 2600);
    return () => clearInterval(id);
  }, [mode]);
  const lines = screenLines(mode, g.view);
  const key = JSON.stringify(lines) + p.lang + tick;
  useEffect(() => {
    const draw = () => {
      drawText(canvas, lines, { width: 1024, height: 512, stroke: "#140c33", strokeWidth: 10, bg: null });
      tex.needsUpdate = true;
    };
    draw();
    void whenFonts().then(draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useFrame(() => {
    const playing = director.get().playingId;
    hist.current.push(Math.max(referenceLevel(), playing ? liveLevel(playing) : 0));
    if (hist.current.length > 24) hist.current.shift();
    const kids = bars.current?.children ?? [];
    kids.forEach((b, i) => (b.scale.y = 0.05 + (hist.current[i] ?? 0) * 1.2));
  });
  return (
    <group position={[0, 2.5, -4.4]}>
      <mesh position={[0, 0, -0.06]}>
        <boxGeometry args={[5.6, 3, 0.1]} />
        <meshStandardMaterial color="#0a061c" metalness={0.6} roughness={0.3} emissive="#3b0f7a" emissiveIntensity={0.25} />
      </mesh>
      <mesh>
        <planeGeometry args={[5.3, 2.65]} />
        <meshBasicMaterial color="#140c33" />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[5.3, 2.65]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
      <group ref={bars} position={[0, -1.15, 0.05]}>
        {Array.from({ length: 24 }, (_, i) => (
          <mesh key={i} position={[-2.3 + i * 0.2, 0, 0]}>
            <boxGeometry args={[0.12, 0.6, 0.04]} />
            <meshBasicMaterial color={new Color().setHSL(0.75 - i / 48, 0.9, 0.6)} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Beams({ calm }: { calm: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (calm || !group.current) return;
    group.current.children.forEach((b, i) => (b.rotation.z = Math.sin(clock.elapsedTime * 0.5 + i * 1.7) * 0.25));
  });
  const colors = ["#8b5cf6", "#3b82f6", "#fb923c", "#ec4899"];
  return (
    <group ref={group}>
      {colors.map((c, i) => (
        <mesh key={c} position={[-4.5 + i * 3, 5.2, -2.5]}>
          <coneGeometry args={[1.1, 7, 24, 1, true]} />
          <meshBasicMaterial color={c} transparent opacity={0.07} blending={AdditiveBlending} side={DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function CameraRig({ mode, seats, calm }: { mode: Mode; seats: Map<string, { pos: [number, number, number] }>; calm: boolean }) {
  const { camera, size } = useThree();
  const g = useStore(game.store);
  const pos = useRef(new Vector3(0, 3.2, 7));
  const look = useRef(new Vector3(0, 1, -1));
  const tmpP = useMemo(() => new Vector3(), []);
  const tmpL = useMemo(() => new Vector3(), []);
  useFrame(({ clock }, dt) => {
    const v = g.view;
    const portrait = size.height > size.width;
    const back = portrait ? 1.35 : 1;
    let p: [number, number, number] = [0, 2.8, 5.5 * back];
    let l: [number, number, number] = [0, 1, -1];
    if (mode === "showcase") {
      const sw = calm ? 0 : Math.sin(clock.elapsedTime * 0.15) * 0.45;
      p = [Math.sin(sw) * 6.8 * back, 3.2, Math.cos(sw) * 6.8 * back];
      l = [0, 1.4, -0.8];
    } else if (v) {
      switch (v.phase) {
        case "intro":
        case "listen":
        case "leaderboard":
        case "vote":
          p = [0, 2.9, 2.6 * back];
          l = [0, 2.3, -4.4];
          break;
        case "countdown":
        case "record":
        case "collect":
          p = [0, 2.5, 4.9 * back];
          l = [0, 0.9, -1.4];
          break;
        case "reveal": {
          const id = v.reveal?.current?.playerId;
          const s = id ? seats.get(id) : undefined;
          if (s) {
            const [x, , z] = s.pos;
            // لقطة «تلفزيونية» من أمام الطاولة باتجاه اللاعب صاحب التسجيل
            p = [x * 0.45, 1.75, portrait ? 3.6 : 2.6];
            l = [x, 1.0, z];
          }
          break;
        }
        case "wheel":
          p = [0, 2.6, 3.6 * back];
          l = [0, 1.9, -3];
          break;
        case "final":
          p = [Math.sin(clock.elapsedTime * 0.3) * (calm ? 0 : 1.2), 2.4, 5.2 * back];
          l = [0, 1, -1.5];
          break;
      }
    }
    tmpP.set(...p);
    tmpL.set(...l);
    const k = 1 - Math.exp(-dt * (calm ? 8 : 2.4));
    pos.current.lerp(tmpP, k);
    look.current.lerp(tmpL, k);
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
  });
  return null;
}

function moodFor(v: RoomView | null, id: string): Mood {
  if (!v) return "idle";
  if (v.phase === "final") return v.final?.ranking[0]?.id === id ? "winner" : "happy";
  if (v.phase === "reveal" && v.reveal?.current?.playerId === id && v.reveal.step === "score") {
    const r = v.reveal.current.result;
    if (!r || r.status !== "ok" || r.score === null) return "sad";
    if (r.score >= 100) return "celebrate";
    if (r.score >= 75) return "happy";
    if (r.score < 35) return "sad";
  }
  if (v.phase === "leaderboard" && v.leaderboard?.[0]?.playerId === id) return "happy";
  return "idle";
}

function Players({ mode, low, calm }: { mode: Mode; low: boolean; calm: boolean }) {
  const g = useStore(game.store);
  const v = g.view;
  const demoT = useRef(0);
  const list = mode === "showcase" || !v ? DEMO.map((d, i) => ({ id: `demo${i}`, ...d, connected: true })) : v.players;
  const seats = useMemo(() => {
    const m = new Map<string, { pos: [number, number, number]; rot: number }>();
    list.forEach((p, i) => m.set(p.id, seat(i, list.length)));
    return m;
  }, [list.map((p) => p.id).join(",")]);
  useFrame((_, dt) => (demoT.current += dt));
  return (
    <>
      <CameraRig mode={mode} seats={seats} calm={calm} />
      {list.map((p, i) => {
        const s = seats.get(p.id)!;
        const demo = mode === "showcase" || !v;
        // في وضع العرض: «دردشة» تجميلية فقط (ليست وظيفة لعب)
        const level = demo ? () => Math.max(0, Math.sin(demoT.current * 3 + i * 2.1) * Math.sin(demoT.current * 1.3 + i)) * 0.7 : () => (p.connected ? liveLevel(p.id) : 0);
        const highlight = !demo && (v!.reveal?.current?.playerId === p.id || v!.wheel?.spinnerId === p.id);
        return (
          <Character
            key={p.id}
            avatar={p.avatar}
            name={p.name}
            position={s.pos}
            rotationY={s.rot}
            level={level}
            mood={demo ? (i === 2 ? "happy" : "idle") : moodFor(v, p.id)}
            dim={!p.connected}
            highlight={highlight}
            low={low}
            calm={calm}
            hideName={demo}
          />
        );
      })}
    </>
  );
}

export default function Stage({ mode }: { mode: Mode }) {
  const p = useStore(prefs);
  const low = p.graphics === "low";
  const calm = p.reduceMotion;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-0 transition-[height,opacity] duration-500"
      style={{ height: mode === "room" ? "var(--stage-h)" : "100dvh", opacity: mode === "room" ? 1 : 0.42 }}
      aria-hidden
    >
      <Canvas
        shadows={!low}
        dpr={low ? [1, 1.25] : [1, 2]}
        gl={{ antialias: !low, alpha: true, powerPreference: low ? "low-power" : "high-performance" }}
        camera={{ fov: 45, near: 0.1, far: 60, position: [0, 3, 7] }}
      >
        <fog attach="fog" args={["#140c33", 9, 22]} />
        <ambientLight intensity={0.45} />
        <hemisphereLight args={["#a78bfa", "#1c1146", 0.6]} />
        <directionalLight position={[3, 8, 5]} intensity={1.4} castShadow={!low} shadow-mapSize={[1024, 1024]} />
        {!low && (
          <>
            <spotLight position={[-5, 6, 2]} angle={0.5} penumbra={0.6} intensity={60} color="#8b5cf6" />
            <spotLight position={[5, 6, 2]} angle={0.5} penumbra={0.6} intensity={60} color="#3b82f6" />
            <spotLight position={[0, 7, 5]} angle={0.45} penumbra={0.7} intensity={50} color="#fb923c" />
          </>
        )}
        <Floor low={low} />
        <Table />
        <BigScreen mode={mode} />
        {!low && <Beams calm={calm} />}
        <Players mode={mode} low={low} calm={calm} />
      </Canvas>
    </div>
  );
}
