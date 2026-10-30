// إدارة الغرف: إنشاء برموز دعوة خاصة، البحث، وتنظيف الغرف الفارغة

import { randomInt } from "node:crypto";
import { ROOM_NAME_MAX, TIMING } from "../shared/constants";
import { cleanName, sanitizeSettings } from "../shared/game";
import type { RoomSettings } from "../shared/types";
import { Room, type RoomDeps } from "./room";

export type ManagerDeps = Omit<RoomDeps, "onChange" | "sendRecording" | "toast" | "kicked">;

export interface RoomEvents {
  onChange(room: Room): void;
  sendRecording(room: Room, round: number, playerId: string, wav: Uint8Array): void;
  toast: RoomDeps["toast"];
  kicked: RoomDeps["kicked"];
  closed(room: Room): void;
}

const MAX_AGE = 12 * 60 * 60_000;

export class RoomManager {
  rooms = new Map<string, Room>();
  private sweeper: ReturnType<typeof setInterval>;

  constructor(
    private deps: ManagerDeps,
    private events: RoomEvents,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  get size() {
    return this.rooms.size;
  }

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      const code = String(randomInt(100000, 1000000));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("no free room codes");
  }

  create(rawName: unknown, settings: Partial<RoomSettings> | undefined): Room {
    const code = this.newCode();
    const name = cleanName(rawName, ROOM_NAME_MAX) ?? `غرفة ${code}`;
    const room = new Room(code, name, sanitizeSettings(settings), {
      ...this.deps,
      onChange: (r) => this.events.onChange(r),
      sendRecording: (r, round, id, wav) => this.events.sendRecording(r, round, id, wav),
      toast: (r, ev) => this.events.toast(r, ev),
      kicked: (r, id) => this.events.kicked(r, id),
    });
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  close(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
    this.events.closed(room);
  }

  /** حذف الغرف الفارغة بعد مهلة، والغرف القديمة جدًا */
  sweep() {
    const now = this.deps.now();
    for (const room of this.rooms.values()) {
      const empty = room.connectedCount === 0 && room.emptySince !== null && now - room.emptySince > TIMING.emptyRoomTtl * this.deps.speed;
      if (empty || room.players.size === 0 || now - room.createdAt > MAX_AGE) this.close(room.code);
    }
  }

  dispose() {
    clearInterval(this.sweeper);
    for (const code of [...this.rooms.keys()]) this.close(code);
  }
}
