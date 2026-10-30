// خوادم STUN/TURN للاتصال الصوتي المباشر بين اللاعبين (WebRTC)
//   STUN_URLS        افتراضيًا خوادم Google العامة
//   TURN_URLS        مثال: turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
//   TURN_USERNAME + TURN_CREDENTIAL   بيانات ثابتة
//   TURN_SECRET      أو سر coturn (use-auth-secret) لإصدار بيانات مؤقتة لكل لاعب
//   TURN_TTL         صلاحية البيانات المؤقتة بالثواني (افتراضي 6 ساعات)

import { createHmac } from "node:crypto";
import type { IceServer } from "../shared/types";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function iceServers(playerId: string, now = Date.now()): IceServer[] {
  const stun = list(process.env.STUN_URLS ?? "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302");
  const servers: IceServer[] = stun.length ? [{ urls: stun }] : [];
  const turn = list(process.env.TURN_URLS);
  if (turn.length) {
    if (process.env.TURN_SECRET) {
      const ttl = Number(process.env.TURN_TTL) || 6 * 3600;
      const username = `${Math.floor(now / 1000) + ttl}:${playerId}`;
      const credential = createHmac("sha1", process.env.TURN_SECRET).update(username).digest("base64");
      servers.push({ urls: turn, username, credential });
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      servers.push({ urls: turn, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
  }
  return servers;
}
