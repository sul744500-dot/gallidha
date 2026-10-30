// شخصية كرتونية أصلية (تصميم إجرائي): جسم «حبة فول»، عيون ترمش، فم يتحرك مع الصوت، قبعات، وردود فعل
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, type Group, type Mesh, type MeshStandardMaterial } from "three";
import { AVATAR_COLORS } from "../../shared/constants";
import type { Avatar } from "../../shared/types";
import { drawText, makeTexture, whenFonts } from "./textures";

export type Mood = "idle" | "happy" | "sad" | "celebrate" | "winner" | "focus";

export interface CharacterProps {
  avatar: Avatar;
  name: string;
  position: [number, number, number];
  rotationY: number;
  level: () => number;
  mood: Mood;
  dim?: boolean;
  highlight?: boolean;
  low?: boolean;
  calm?: boolean;
  hideName?: boolean;
}

function Hat({ hat, color }: { hat: number; color: string }) {
  const dark = useMemo(() => new Color(color).multiplyScalar(0.45), [color]);
  switch (hat) {
    case 1:
      return (
        <group position={[0, 0.5, 0]}>
          <mesh>
            <sphereGeometry args={[0.36, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#1e293b" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.02, 0.36]} rotation={[0.25, 0, 0]}>
            <boxGeometry args={[0.42, 0.04, 0.3]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        </group>
      );
    case 2:
      return (
        <group position={[0, 0.58, 0]}>
          <mesh>
            <cylinderGeometry args={[0.28, 0.3, 0.16, 16, 1, true]} />
            <meshStandardMaterial color="#facc15" metalness={0.8} roughness={0.25} side={2} />
          </mesh>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[Math.sin((i / 5) * Math.PI * 2) * 0.28, 0.14, Math.cos((i / 5) * Math.PI * 2) * 0.28]}>
              <coneGeometry args={[0.06, 0.14, 6]} />
              <meshStandardMaterial color="#facc15" metalness={0.8} roughness={0.25} />
            </mesh>
          ))}
        </group>
      );
    case 3: // شماغ وعقال
      return (
        <group position={[0, 0.36, -0.02]}>
          <mesh scale={[1.08, 1, 1.12]}>
            <sphereGeometry args={[0.44, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
            <meshStandardMaterial color="#ffffff" roughness={0.8} side={2} />
          </mesh>
          <mesh position={[0, 0.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.3, 0.04, 8, 24]} />
            <meshStandardMaterial color="#111111" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.4, -0.3, -0.08]} rotation={[0.1, 0, s * 0.15]}>
              <boxGeometry args={[0.12, 0.5, 0.2]} />
              <meshStandardMaterial color="#ffffff" roughness={0.8} />
            </mesh>
          ))}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <mesh key={`d${i}`} position={[Math.sin(i * 0.9 - 2.7) * 0.42, 0.12, Math.cos(i * 0.9 - 2.7) * 0.42]}>
              <sphereGeometry args={[0.035, 6, 6]} />
              <meshStandardMaterial color="#dc2626" />
            </mesh>
          ))}
        </group>
      );
    case 4:
      return (
        <group position={[0, 0.3, 0]}>
          <mesh rotation={[0, 0, 0]}>
            <torusGeometry args={[0.44, 0.04, 8, 24, Math.PI]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.44, -0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.14, 0.14, 0.12, 16]} />
              <meshStandardMaterial color={dark} />
            </mesh>
          ))}
        </group>
      );
    case 5:
      return (
        <group position={[0.22, 0.56, 0.08]} rotation={[0, 0, 0.3]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.1, 0, 0]} rotation={[0, 0, (s * Math.PI) / 2]}>
              <coneGeometry args={[0.08, 0.18, 8]} />
              <meshStandardMaterial color="#ec4899" />
            </mesh>
          ))}
          <mesh>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color="#f9a8d4" />
          </mesh>
        </group>
      );
    case 6:
      return (
        <group position={[0, 0.46, 0]}>
          <mesh>
            <sphereGeometry args={[0.38, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#22d3ee" roughness={0.9} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <torusGeometry args={[0.37, 0.06, 8, 24]} />
            <meshStandardMaterial color="#0e7490" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.4, 0]}>
            <sphereGeometry args={[0.09, 10, 10]} />
            <meshStandardMaterial color="#ffffff" roughness={1} />
          </mesh>
        </group>
      );
    case 7:
      return (
        <group position={[0.08, 0.72, 0]} rotation={[0, 0, -0.15]}>
          <mesh>
            <coneGeometry args={[0.18, 0.46, 16]} />
            <meshStandardMaterial color="#a855f7" />
          </mesh>
          <mesh position={[0, 0.25, 0]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color="#fde047" emissive="#fde047" emissiveIntensity={0.4} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

function Eyes({ eyes, blink }: { eyes: number; blink: React.RefObject<Group | null> }) {
  if (eyes === 1)
    return (
      <group position={[0, 0.16, 0.39]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.13, 0, 0]} rotation={[0, 0, Math.PI]}>
            <torusGeometry args={[0.06, 0.018, 6, 12, Math.PI]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        ))}
      </group>
    );
  if (eyes === 3)
    return (
      <group position={[0, 0.16, 0.39]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.13, 0, 0]} rotation={[0, 0, Math.PI / 4]}>
            <octahedronGeometry args={[0.08]} />
            <meshStandardMaterial color="#fde047" emissive="#facc15" emissiveIntensity={0.5} />
          </mesh>
        ))}
      </group>
    );
  return (
    <group position={[0, 0.16, 0.36]} ref={blink}>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.13, 0, 0]}>
          <mesh scale={[1, eyes === 2 ? 0.55 : 1, 0.6]}>
            <sphereGeometry args={[0.09, 14, 10]} />
            <meshStandardMaterial color="#fff" roughness={0.3} />
          </mesh>
          <mesh position={[0, eyes === 2 ? -0.015 : 0, 0.055]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshStandardMaterial color="#111" roughness={0.2} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Character({ avatar, name, position, rotationY, level, mood, dim, highlight, low, calm, hideName }: CharacterProps) {
  const color = AVATAR_COLORS[avatar.color % AVATAR_COLORS.length];
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const mouth = useRef<Mesh>(null);
  const blink = useRef<Group>(null);
  const handL = useRef<Mesh>(null);
  const handR = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const smooth = useRef(0);
  const seed = useMemo(() => Math.random() * 100, []);
  const nextBlink = useRef(2 + Math.random() * 3);

  const tag = useMemo(() => {
    const c = document.createElement("canvas");
    const draw = () => drawText(c, [{ text: name, size: 64, y: 64 }], { width: 512, height: 128, stroke: "#140c33", strokeWidth: 12, color: "#fff" });
    draw();
    const tex = makeTexture(c);
    void whenFonts().then(() => {
      draw();
      tex.needsUpdate = true;
    });
    return tex;
  }, [name]);
  useEffect(() => () => tag.dispose(), [tag]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime + seed;
    const l = level();
    smooth.current += (l - smooth.current) * Math.min(1, dt * 18);
    const s = smooth.current;
    if (mouth.current) mouth.current.scale.set(1 + s * 0.3, 0.18 + s * 1.3, 1);
    if (!body.current || !root.current) return;
    let y = Math.sin(t * 2) * 0.03;
    let rz = 0;
    let rx = 0;
    let ry = 0;
    let hands = 0;
    if (!calm) {
      if (mood === "happy") y += Math.abs(Math.sin(t * 7)) * 0.18;
      if (mood === "celebrate" || mood === "winner") {
        y += Math.abs(Math.sin(t * 6)) * 0.35;
        ry = mood === "celebrate" ? t * 4 : Math.sin(t * 3) * 0.3;
        hands = 1;
      }
      if (mood === "sad") {
        rx = 0.35;
        y -= 0.06;
      }
      // يتمايل لما يتكلم/يضحك
      rz = Math.sin(t * 9) * s * 0.12;
      y += s * 0.05;
    }
    body.current.position.y += (y - body.current.position.y) * Math.min(1, dt * 12);
    body.current.rotation.z = rz;
    body.current.rotation.x += (rx - body.current.rotation.x) * Math.min(1, dt * 6);
    body.current.rotation.y = ry;
    const handY = hands ? 0.35 + Math.sin(t * 10) * 0.08 : -0.18 + s * 0.15;
    if (handL.current) handL.current.position.y += (handY - handL.current.position.y) * Math.min(1, dt * 10);
    if (handR.current) handR.current.position.y += (handY - handR.current.position.y) * Math.min(1, dt * 10);
    // رمش
    if (blink.current) {
      nextBlink.current -= dt;
      const closing = nextBlink.current < 0.12 && nextBlink.current > 0;
      blink.current.scale.y = closing ? 0.1 : 1;
      if (nextBlink.current <= 0) nextBlink.current = 2 + Math.random() * 4;
    }
    if (ring.current) {
      const m = ring.current.material as MeshStandardMaterial;
      m.emissiveIntensity = highlight ? 1.5 + Math.sin(t * 6) * 0.5 : 0.2 + s * 2;
    }
    if (mat.current) mat.current.opacity = dim ? 0.35 : 1;
  });

  const seg = low ? 14 : 28;
  const light = useMemo(() => new Color(color).lerp(new Color("#ffffff"), 0.45), [color]);
  return (
    <group ref={root} position={position} rotation={[0, rotationY, 0]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.45, 0.6, 32]} />
        <meshStandardMaterial color={highlight ? "#fb923c" : "#38bdf8"} emissive={highlight ? "#fb923c" : "#38bdf8"} emissiveIntensity={0.3} transparent opacity={0.85} />
      </mesh>
      <group ref={body}>
        <group position={[0, 0.62, 0]}>
          <mesh castShadow={!low} scale={[1, 1.18, 0.95]}>
            <sphereGeometry args={[0.45, seg, seg]} />
            <meshStandardMaterial ref={mat} color={dim ? "#64748b" : color} roughness={0.45} transparent />
          </mesh>
          <mesh position={[0, -0.16, 0.27]} scale={[0.75, 0.7, 0.4]}>
            <sphereGeometry args={[0.36, 16, 12]} />
            <meshStandardMaterial color={light} roughness={0.6} />
          </mesh>
          <Eyes eyes={avatar.eyes} blink={blink} />
          <mesh ref={mouth} position={[0, -0.03, 0.42]} scale={[1, 0.2, 1]}>
            <sphereGeometry args={[0.07, 12, 8]} />
            <meshStandardMaterial color="#3b0a1a" roughness={0.8} />
          </mesh>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * 0.25, 0.02, 0.36]} scale={[1, 0.6, 0.4]}>
              <sphereGeometry args={[0.06, 8, 8]} />
              <meshStandardMaterial color="#fb7185" transparent opacity={0.7} />
            </mesh>
          ))}
          <mesh ref={handL} position={[-0.5, -0.18, 0.05]}>
            <sphereGeometry args={[0.1, 10, 10]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          <mesh ref={handR} position={[0.5, -0.18, 0.05]}>
            <sphereGeometry args={[0.1, 10, 10]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          <Hat hat={avatar.hat} color={color} />
        </group>
        {[-1, 1].map((sx) => (
          <mesh key={sx} position={[sx * 0.18, 0.06, 0.08]} scale={[1, 0.5, 1.4]}>
            <sphereGeometry args={[0.11, 10, 8]} />
            <meshStandardMaterial color={new Color(color).multiplyScalar(0.7)} />
          </mesh>
        ))}
      </group>
      {!hideName && (
        <sprite position={[0, 1.55, 0]} scale={[1.4, 0.35, 1]}>
          <spriteMaterial map={tag} transparent depthWrite={false} />
        </sprite>
      )}
    </group>
  );
}
