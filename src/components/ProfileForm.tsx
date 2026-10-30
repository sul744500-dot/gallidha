import { AVATAR_COLORS, EYES, HATS, NAME_MAX } from "../../shared/constants";
import type { Avatar } from "../../shared/types";
import { useLang } from "../lib/lang";
import { sfx } from "../lib/sfx";
import { AvatarFace } from "./AvatarFace";
import { Field, inputClass } from "./ui";

export function ProfileForm({ name, avatar, onName, onAvatar }: { name: string; avatar: Avatar; onName: (v: string) => void; onAvatar: (a: Avatar) => void }) {
  const { t } = useLang();
  const set = (patch: Partial<Avatar>) => {
    sfx("pop");
    onAvatar({ ...avatar, ...patch });
  };
  return (
    <div className="space-y-4">
      <Field label={t("profile.name")}>
        <input className={inputClass} value={name} maxLength={NAME_MAX * 2} placeholder={t("profile.namePh")} onChange={(e) => onName(e.target.value)} autoComplete="nickname" enterKeyHint="done" />
      </Field>
      <div className="flex items-center gap-4">
        <div className="grid h-28 w-28 shrink-0 place-items-center rounded-3xl bg-black/25">
          <AvatarFace avatar={avatar} size={96} className="animate-float" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-bold text-white/85">{t("profile.character")}</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("profile.color")}>
            {AVATAR_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={avatar.color === i}
                aria-label={`${t("profile.color")} ${i + 1}`}
                onClick={() => set({ color: i })}
                className={`h-8 w-8 rounded-full border-2 transition ${avatar.color === i ? "scale-110 border-white" : "border-transparent"}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 scroll-thin" role="radiogroup" aria-label={t("profile.hat")}>
        {HATS.map((h, i) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={avatar.hat === i}
            aria-label={h}
            onClick={() => set({ hat: i })}
            className={`shrink-0 rounded-2xl p-1 transition ${avatar.hat === i ? "bg-white/25 ring-2 ring-tang-400" : "bg-black/20"}`}
          >
            <AvatarFace avatar={{ ...avatar, hat: i }} size={46} />
          </button>
        ))}
      </div>
      <div className="flex gap-1.5" role="radiogroup" aria-label={t("profile.eyes")}>
        {EYES.map((e, i) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={avatar.eyes === i}
            aria-label={e}
            onClick={() => set({ eyes: i })}
            className={`rounded-2xl p-1 transition ${avatar.eyes === i ? "bg-white/25 ring-2 ring-tang-400" : "bg-black/20"}`}
          >
            <AvatarFace avatar={{ ...avatar, hat: 0, eyes: i }} size={46} />
          </button>
        ))}
      </div>
    </div>
  );
}
