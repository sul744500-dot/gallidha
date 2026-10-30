// صورة الشخصية ثنائية الأبعاد (للنماذج والقوائم) بنفس تصميم الشخصيات ثلاثية الأبعاد
import { AVATAR_COLORS } from "../../shared/constants";
import type { Avatar } from "../../shared/types";

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function Hat({ hat, color }: { hat: number; color: string }) {
  switch (hat) {
    case 1: // كاب
      return (
        <g>
          <path d="M24 34 Q50 6 76 34 Z" fill="#1e293b" />
          <path d="M66 31 Q88 30 92 38 Q78 38 64 36 Z" fill="#334155" />
          <circle cx="50" cy="14" r="3" fill="#f97316" />
        </g>
      );
    case 2: // تاج
      return <path d="M28 30 L30 10 L40 22 L50 6 L60 22 L70 10 L72 30 Z" fill="#facc15" stroke="#b45309" strokeWidth="2" strokeLinejoin="round" />;
    case 3: // شماغ وعقال
      return (
        <g>
          <path d="M16 46 Q14 10 50 8 Q86 10 84 46 L90 70 L76 58 L50 22 L24 58 L10 70 Z" fill="#fff" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} d={`M${22 + i * 11} 20 l4 4 l-4 4 l-4 -4 z`} fill="#dc2626" />
          ))}
          <ellipse cx="50" cy="22" rx="27" ry="6" fill="none" stroke="#111" strokeWidth="4" />
        </g>
      );
    case 4: // سماعات
      return (
        <g>
          <path d="M20 46 Q20 8 50 8 Q80 8 80 46" fill="none" stroke="#111827" strokeWidth="6" />
          <rect x="10" y="40" width="14" height="22" rx="6" fill={shade(color, 0.45)} stroke="#111827" strokeWidth="3" />
          <rect x="76" y="40" width="14" height="22" rx="6" fill={shade(color, 0.45)} stroke="#111827" strokeWidth="3" />
        </g>
      );
    case 5: // فيونكة
      return (
        <g transform="translate(62 16) rotate(15)">
          <path d="M0 0 L-14 -9 L-14 9 Z M0 0 L14 -9 L14 9 Z" fill="#ec4899" stroke="#9d174d" strokeWidth="2" strokeLinejoin="round" />
          <circle r="4" fill="#f9a8d4" stroke="#9d174d" strokeWidth="2" />
        </g>
      );
    case 6: // طاقية صوف
      return (
        <g>
          <path d="M22 34 Q24 8 50 8 Q76 8 78 34 Z" fill="#22d3ee" />
          <rect x="20" y="28" width="60" height="9" rx="4" fill="#0e7490" />
          <circle cx="50" cy="7" r="6" fill="#fff" />
        </g>
      );
    case 7: // قبعة حفلة
      return (
        <g>
          <path d="M36 28 L52 -2 L66 28 Z" fill="#a855f7" />
          <path d="M40 20 L60 20 M44 12 L57 12" stroke="#fde047" strokeWidth="3" />
          <circle cx="52" cy="-2" r="4" fill="#fde047" />
        </g>
      );
    default:
      return null;
  }
}

function Eyes({ eyes }: { eyes: number }) {
  switch (eyes) {
    case 1:
      return (
        <g fill="none" stroke="#111" strokeWidth="4" strokeLinecap="round">
          <path d="M33 48 q6 -8 12 0" />
          <path d="M55 48 q6 -8 12 0" />
        </g>
      );
    case 2:
      return (
        <g>
          <ellipse cx="39" cy="47" rx="8" ry="7" fill="#fff" />
          <ellipse cx="61" cy="47" rx="8" ry="7" fill="#fff" />
          <circle cx="39" cy="49" r="3.5" fill="#111" />
          <circle cx="61" cy="49" r="3.5" fill="#111" />
          <path d="M30 44 h18 M52 44 h18" stroke="currentColor" strokeWidth="6" />
        </g>
      );
    case 3:
      return (
        <g fill="#fde047" stroke="#111" strokeWidth="1.5">
          <path d="M39 38 l2.6 6 6.4 .5 -4.9 4.2 1.5 6.3 -5.6 -3.4 -5.6 3.4 1.5 -6.3 -4.9 -4.2 6.4 -.5z" />
          <path d="M61 38 l2.6 6 6.4 .5 -4.9 4.2 1.5 6.3 -5.6 -3.4 -5.6 3.4 1.5 -6.3 -4.9 -4.2 6.4 -.5z" />
        </g>
      );
    default:
      return (
        <g>
          <circle cx="39" cy="47" r="8.5" fill="#fff" />
          <circle cx="61" cy="47" r="8.5" fill="#fff" />
          <circle cx="40.5" cy="48" r="4" fill="#111" />
          <circle cx="62.5" cy="48" r="4" fill="#111" />
          <circle cx="42" cy="46" r="1.3" fill="#fff" />
          <circle cx="64" cy="46" r="1.3" fill="#fff" />
        </g>
      );
  }
}

export function AvatarFace({ avatar, size = 56, mouth = 0, className = "", dim }: { avatar: Avatar; size?: number; mouth?: number; className?: string; dim?: boolean }) {
  const color = AVATAR_COLORS[avatar.color % AVATAR_COLORS.length];
  const open = Math.max(0, Math.min(1, mouth));
  return (
    <svg viewBox="-4 -6 108 110" width={size} height={size} className={`${className} ${dim ? "opacity-40 grayscale" : ""}`} aria-hidden style={{ color }}>
      <defs>
        <radialGradient id={`g${avatar.color}`} cx="40%" cy="30%" r="75%">
          <stop offset="0" stopColor={shade(color, 1.25)} />
          <stop offset="1" stopColor={shade(color, 0.7)} />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="98" rx="30" ry="5" fill="rgb(0 0 0 / 0.3)" />
      <path d="M14 58 Q12 18 50 18 Q88 18 86 58 Q88 96 50 96 Q12 96 14 58 Z" fill={`url(#g${avatar.color})`} stroke={shade(color, 0.5)} strokeWidth="2.5" />
      <ellipse cx="50" cy="80" rx="20" ry="12" fill="rgb(255 255 255 / 0.18)" />
      <Eyes eyes={avatar.eyes} />
      <ellipse cx="28" cy="62" rx="5" ry="3" fill="rgb(255 120 160 / 0.45)" />
      <ellipse cx="72" cy="62" rx="5" ry="3" fill="rgb(255 120 160 / 0.45)" />
      {open > 0.08 ? <ellipse cx="50" cy="68" rx={6 + open * 3} ry={2 + open * 8} fill="#3b0a1a" /> : <path d="M41 66 q9 8 18 0" fill="none" stroke="#3b0a1a" strokeWidth="3.5" strokeLinecap="round" />}
      <Hat hat={avatar.hat} color={color} />
    </svg>
  );
}
