import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Lang, LocalText } from "../../shared/types";
import { dictionaries, format, type I18nKey } from "./i18n";
import { prefs } from "./prefs";
import { useStore } from "./store";

interface LangCtx {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
  lt: (text: LocalText) => string;
}

const Ctx = createContext<LangCtx | null>(null);

export function translate(lang: Lang, key: I18nKey, vars?: Record<string, string | number>) {
  return format(dictionaries[lang][key] ?? dictionaries.ar[key] ?? key, vars);
}

export function LangProvider({ children }: { children: ReactNode }) {
  const { lang } = useStore(prefs);
  const value = useMemo<LangCtx>(
    () => ({
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      t: (key, vars) => translate(lang, key, vars),
      lt: (text) => text[lang] ?? text.ar,
    }),
    [lang],
  );
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = value.dir;
    document.title = lang === "ar" ? "قلّدها إذا تقدر | GALLIDHA" : "GALLIDHA | Imitate it if you can";
  }, [lang, value.dir]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("LangProvider missing");
  return c;
}
