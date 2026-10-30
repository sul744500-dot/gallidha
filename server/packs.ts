// مكتبة الأصوات على الخادم: تقرأ كل مجلد داخل public/packs فيه pack.json + ملفات WAV.
// إضافة باقة جديدة = مجلد جديد بنفس الصيغة ثم إعادة تشغيل الخادم (لا تعديل على الكود).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeWav } from "../shared/audio/wav";
import { CATEGORIES } from "../shared/game";
import type { Category, GameMode, LocalText, PackInfo, RoomSettings, ScoreParts, SoundInfo } from "../shared/types";

export interface SoundDef {
  info: SoundInfo;
  file: string;
  weights?: Partial<ScoreParts>;
}

interface PackJson {
  id: string;
  category: Category;
  emoji: string;
  name: LocalText;
  description: LocalText;
  sounds: { id: string; file: string; name: LocalText; emoji: string; difficulty: 1 | 2 | 3; weights?: Partial<ScoreParts> }[];
}

const isText = (v: unknown): v is LocalText => !!v && typeof (v as LocalText).ar === "string" && typeof (v as LocalText).en === "string";

export class SoundLibrary {
  readonly packs: PackInfo[] = [];
  private byId = new Map<string, SoundDef>();

  constructor(readonly dir: string) {
    if (!existsSync(dir)) throw new Error(`sound packs folder not found: ${dir}`);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(dir, entry.name, "pack.json");
      if (!existsSync(manifestPath)) continue;
      try {
        this.loadPack(entry.name, JSON.parse(readFileSync(manifestPath, "utf8")) as PackJson);
      } catch (err) {
        console.warn(`! تجاهل الباقة ${entry.name}: ${(err as Error).message}`);
      }
    }
    const order = (c: Category) => CATEGORIES.indexOf(c);
    this.packs.sort((a, b) => order(a.category) - order(b.category));
  }

  private loadPack(folder: string, p: PackJson) {
    if (!CATEGORIES.includes(p.category) || !isText(p.name)) throw new Error("bad manifest");
    const sounds: SoundInfo[] = [];
    for (const s of p.sounds ?? []) {
      if (!/^[\w-]+$/.test(s.id) || !/^[\w-]+\.wav$/.test(s.file) || !isText(s.name)) continue;
      const file = join(this.dir, folder, s.file);
      if (!existsSync(file)) continue;
      const wav = decodeWav(readFileSync(file));
      const info: SoundInfo = {
        id: `${folder}/${s.id}`,
        pack: folder,
        category: p.category,
        name: s.name,
        emoji: s.emoji || "🔊",
        url: `/packs/${folder}/${s.file}`,
        durationMs: Math.round((wav.samples.length / wav.sampleRate) * 1000),
        difficulty: [1, 2, 3].includes(s.difficulty) ? s.difficulty : 2,
      };
      sounds.push(info);
      this.byId.set(info.id, { info, file, weights: s.weights });
    }
    if (sounds.length) {
      this.packs.push({ id: folder, category: p.category, name: p.name, description: isText(p.description) ? p.description : p.name, emoji: p.emoji || "🔊", sounds });
    }
  }

  get size() {
    return this.byId.size;
  }

  get(id: string): SoundDef | undefined {
    return this.byId.get(id);
  }

  all(): SoundDef[] {
    return [...this.byId.values()];
  }

  /** الأصوات المسموحة حسب الوضع وأنواع الأصوات المختارة */
  pool(settings: RoomSettings): SoundDef[] {
    const mode: GameMode = settings.mode;
    let list = this.all();
    if (mode === "saudi") list = list.filter((s) => s.info.category === "saudi");
    else if (mode === "hard") list = list.filter((s) => s.info.category === "hard" || s.info.difficulty === 3);
    else {
      const cats = settings.categories.length ? settings.categories : CATEGORIES;
      list = list.filter((s) => cats.includes(s.info.category));
    }
    return list.length ? list : this.all();
  }

  /** صوت عشوائي لم يُستخدم في المباراة إن أمكن */
  pick(settings: RoomSettings, used: Set<string>, random: () => number): SoundDef {
    // للاختبارات الآلية فقط: تثبيت الصوت (FORCE_SOUND=animals/cow)
    const forced = process.env.FORCE_SOUND && this.byId.get(process.env.FORCE_SOUND);
    if (forced) return forced;
    const pool = this.pool(settings);
    let fresh = pool.filter((s) => !used.has(s.info.id));
    if (!fresh.length) fresh = pool;
    return fresh[Math.floor(random() * fresh.length) % fresh.length];
  }
}
