// تنقل بسيط عبر الرابط (#/...) يدعم زر الرجوع في الجوال، وروابط الدعوة ?r=CODE
import { createStore } from "./store";

export type Route =
  | { name: "home" }
  | { name: "create" }
  | { name: "join"; code?: string }
  | { name: "how" }
  | { name: "library" }
  | { name: "solo"; sound?: string }
  | { name: "room"; code: string };

function parse(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const q = new URLSearchParams(query);
  const [a, b] = path.split("/");
  switch (a) {
    case "create":
      return { name: "create" };
    case "join":
      return { name: "join", code: q.get("code") ?? undefined };
    case "how":
      return { name: "how" };
    case "library":
      return { name: "library" };
    case "solo":
      return { name: "solo", sound: q.get("sound") ?? undefined };
    case "room":
      return b && /^\d{6}$/.test(b) ? { name: "room", code: b } : { name: "home" };
    default:
      return { name: "home" };
  }
}

function toHash(r: Route): string {
  switch (r.name) {
    case "home":
      return "#/";
    case "join":
      return r.code ? `#/join?code=${r.code}` : "#/join";
    case "solo":
      return r.sound ? `#/solo?sound=${encodeURIComponent(r.sound)}` : "#/solo";
    case "room":
      return `#/room/${r.code}`;
    default:
      return `#/${r.name}`;
  }
}

/** كود الدعوة من الرابط (?r=123456) — يُقرأ مرة واحدة ثم يُزال من شريط العنوان */
function inviteCode(): string | null {
  const q = new URLSearchParams(location.search);
  const code = q.get("r");
  if (code && /^\d{6}$/.test(code)) {
    q.delete("r");
    const rest = q.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
    return code;
  }
  return null;
}

export const invite = inviteCode();
export const route = createStore<Route>(invite ? { name: "join", code: invite } : parse(location.hash));

window.addEventListener("hashchange", () => route.set(parse(location.hash)));

export function navigate(r: Route, replace = false) {
  const hash = toHash(r);
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  route.set(r);
}

export function inviteLink(code: string, origin = location.origin): string {
  return `${origin}/?r=${code}`;
}
