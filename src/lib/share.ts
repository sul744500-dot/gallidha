import { useEffect, useState } from "react";
import { inviteLink } from "./router";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export async function shareOrCopy(data: { title?: string; text?: string; url?: string; files?: File[] }): Promise<"shared" | "copied" | "failed"> {
  try {
    if (navigator.share && (!data.files || navigator.canShare?.({ files: data.files }))) {
      await navigator.share(data);
      return "shared";
    }
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return "failed";
  }
  return (await copyText([data.text, data.url].filter(Boolean).join(" "))) ? "copied" : "failed";
}

const isLocal = () => ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

/** رابط الدعوة: إذا كان المضيف على localhost نستبدله بعنوان الشبكة المحلية الآمن (HTTPS) ليفتح من جوالات الأصدقاء */
export function useInviteLink(code: string): { link: string; lan: boolean } {
  const [lan, setLan] = useState<string | null>(null);
  useEffect(() => {
    if (!isLocal()) return;
    let alive = true;
    fetch("/lan-info")
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { addresses: string[]; httpsPort: number; port: number } | null) => {
        if (!alive || !info?.addresses.length) return;
        const origin = info.httpsPort ? `https://${info.addresses[0]}:${info.httpsPort}` : `http://${info.addresses[0]}:${info.port}`;
        setLan(origin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return { link: inviteLink(code, lan ?? location.origin), lan: !!lan };
}
