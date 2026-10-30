// تفضيلات اللاعب: الدائمة في localStorage، واختيارات المايك داخل جلسة اللعب في sessionStorage
import type { Avatar, Lang } from "../../shared/types";
import { createStore } from "./store";

export type Graphics = "high" | "low" | "off";

export interface Prefs {
  lang: Lang;
  othersVolume: number;
  gameVolume: number;
  sfxVolume: number;
  reduceMotion: boolean;
  graphics: Graphics;
  name: string;
  avatar: Avatar;
}

const KEY = "gallidha.prefs.v1";

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* وضع التصفح الخاص أو تخزين محجوب */
  }
}

const weakDevice = () => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.deviceMemory ?? 8) <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4;
};

const defaults: Prefs = {
  lang: "ar",
  othersVolume: 1,
  gameVolume: 1,
  sfxVolume: 0.7,
  reduceMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  graphics: weakDevice() ? "low" : "high",
  name: "",
  avatar: { color: Math.floor(Math.random() * 12), hat: Math.floor(Math.random() * 8), eyes: 0 },
};

export const prefs = createStore<Prefs>({ ...defaults, ...(readLocal<Partial<Prefs>>(KEY) ?? {}) });
prefs.subscribe(() => writeLocal(KEY, prefs.get()));

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs.set((p) => ({ ...p, [key]: value }));
}

/** قيم تُحفظ لهذه الجلسة فقط (تُمسح عند إغلاق التبويب) */
export const sessionPref = {
  get<T>(key: string): T | null {
    try {
      const raw = sessionStorage.getItem(`gallidha.${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      if (value === null || value === undefined) sessionStorage.removeItem(`gallidha.${key}`);
      else sessionStorage.setItem(`gallidha.${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

/** معرّف عشوائي ثابت للمتصفح (لمنع المطرود من العودة فقط) */
export function deviceId(): string {
  let id = readLocal<string>("gallidha.device");
  if (!id || !/^[\w-]{8,64}$/.test(id)) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    writeLocal("gallidha.device", id);
  }
  return id;
}
