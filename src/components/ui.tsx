import type { ButtonHTMLAttributes, ReactNode } from "react";
import { sfx } from "../lib/sfx";

type Variant = "primary" | "grape" | "azure" | "ghost" | "danger" | "mint";

const variants: Record<Variant, string> = {
  primary: "bg-gradient-to-b from-tang-400 to-tang-600 text-white [--btn-depth:#9a3412]",
  grape: "bg-gradient-to-b from-grape-500 to-grape-700 text-white [--btn-depth:#3b0f7a]",
  azure: "bg-gradient-to-b from-azure-400 to-azure-600 text-white [--btn-depth:#1e3a8a]",
  mint: "bg-gradient-to-b from-mint-400 to-emerald-600 text-white [--btn-depth:#065f46]",
  danger: "bg-gradient-to-b from-rose-400 to-rose-600 text-white [--btn-depth:#881337]",
  ghost: "bg-white/10 text-white border border-white/15 [--btn-depth:rgb(0_0_0/0.35)]",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  onClick,
  silent,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" | "xl"; silent?: boolean }) {
  const sizes = {
    sm: "min-h-10 px-3 text-sm rounded-xl",
    md: "min-h-12 px-5 text-base rounded-2xl",
    lg: "min-h-14 px-6 text-lg rounded-2xl",
    xl: "min-h-16 px-7 text-xl rounded-3xl",
  };
  return (
    <button
      {...rest}
      onClick={(e) => {
        if (!silent) sfx("click");
        onClick?.(e);
      }}
      className={`btn-3d inline-flex items-center justify-center gap-2 font-bold select-none ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-3xl ${className}`}>{children}</div>;
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 py-2 ${disabled ? "opacity-50" : ""}`}>
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-xs text-white/60">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          sfx("click");
          onChange(!checked);
        }}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${checked ? "bg-tang-500" : "bg-white/20"}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "start-7" : "start-1"}`} />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-1 rounded-2xl bg-black/25 p-1 ${disabled ? "opacity-50" : ""}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => {
            sfx("click");
            onChange(o.value);
          }}
          className={`min-h-10 flex-1 rounded-xl px-3 text-sm font-bold transition ${o.value === value ? "bg-white text-night-900 shadow" : "text-white/80 hover:bg-white/10"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="block space-y-1.5">
      <div className="text-sm font-bold text-white/85">{label}</div>
      {children}
      {hint && <div className="text-xs text-white/55">{hint}</div>}
    </div>
  );
}

export const inputClass =
  "w-full min-h-12 rounded-2xl border border-white/15 bg-black/30 px-4 text-lg text-white placeholder:text-white/35 focus:border-tang-400 focus:outline-none";

export function Slider({ value, onChange, label, icon }: { value: number; onChange: (v: number) => void; label: ReactNode; icon?: ReactNode }) {
  return (
    <label className="block py-1.5">
      <span className="mb-1 flex items-center justify-between text-sm font-semibold">
        <span>
          {icon} {label}
        </span>
        <span className="tabular-nums text-white/60">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}

export function IconButton({ label, onClick, children, className = "", active }: { label: string; onClick: () => void; children: ReactNode; className?: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        sfx("click");
        onClick();
      }}
      className={`grid h-11 w-11 place-items-center rounded-2xl border border-white/15 text-xl transition ${active ? "bg-white text-night-900" : "bg-white/10 hover:bg-white/20"} ${className}`}
    >
      {children}
    </button>
  );
}

export function Screen({ title, onBack, children, wide }: { title?: ReactNode; onBack?: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full ${wide ? "max-w-5xl" : "max-w-xl"} px-4 pb-10`}>
      {(title || onBack) && (
        <div className="mb-4 flex items-center gap-3">
          {onBack && (
            <IconButton label="back" onClick={onBack}>
              <span className="rtl:rotate-180">←</span>
            </IconButton>
          )}
          {title && <h1 className="font-display text-3xl drop-shadow">{title}</h1>}
        </div>
      )}
      {children}
    </div>
  );
}
