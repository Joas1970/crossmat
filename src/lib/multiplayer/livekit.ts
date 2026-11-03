import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const roomIdSchema = z.string().regex(/^cm-[a-f0-9]{36}$/);
const secretSchema = z.string().regex(/^[a-f0-9]{64}$/);
const guestIdSchema = z.string().uuid();

async function runtime() {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) {
    throw new Error("A sala segura ainda não está configurada no servidor.");
  }
  const { AccessToken, RoomServiceClient, TrackSource } = await import("livekit-server-sdk");
  const apiUrl = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  return {
    url,
    api: new RoomServiceClient(apiUrl, apiKey, apiSecret),
    token: (identity: string, name: string, host: boolean, room: string) => {
      const token = new AccessToken(apiKey, apiSecret, {
        identity,
        name,
        ttl: host ? "1h" : "1m",
      });
      token.addGrant({
        roomJoin: true,
        room,
        canSubscribe: true,
        canPublish: host,
        canPublishSources: host ? [TrackSource.SCREEN_SHARE] : [],
        canPublishData: false,
      });
      return token.toJwt();
    },
  };
}

async function store() {
  const { dbSource, getSql } = await import("@/lib/db");
  if (process.env.VERCEL && process.env.NODE_ENV === "production" && dbSource !== "neon") {
    throw new Error("A sala segura precisa de um banco Postgres persistente (DATABASE_URL) no projeto Vercel.");
  }
  return getSql();
}

async function secrets() {
  return import("node:crypto");
}

async function digest(value: string) {
  const crypto = await secrets();
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function verifySecret(value: string, expected: string) {
  const crypto = await secrets();
  const actualBytes = Buffer.from(await digest(value), "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

async function randomSecret() {
  const crypto = await secrets();
  return crypto.randomBytes(32).toString("hex");
}

async function requireHost(roomId: string, hostSecret: string) {
  const sql = await store();
  const rows = await sql.query<{
    id: string;
    livekit_room: string;
    host_secret_hash: string;
    closed_at: string | null;
  }>(
    "select id, livekit_room, host_secret_hash, closed_at from crossmat_live_rooms where id = $1 and expires_at > now()",
    [roomId],
  );
  const room = rows[0];
  if (!room || room.closed_at || !(await verifySecret(hostSecret, room.host_secret_hash))) {
    throw new Error("Sala indisponível ou credencial inválida.");
  }
  return { sql, room };
}

export const createLiveRoom = createServerFn({ method: "POST" }).handler(async () => {
  const { randomUUID } = await secrets();
  const id = `cm-${randomUUID()}`;
  const roomName = `crossmat-${randomUUID()}`;
  const hostSecret = await randomSecret();
  const lk = await runtime();
  const sql = await store();
  await sql.query("delete from crossmat_live_rooms where expires_at < now() or closed_at < now() - interval '3 hours'");
  await lk.api.createRoom({ name: roomName, emptyTimeout: 900, maxParticipants: 16 });
  await sql.query(
    "insert into crossmat_live_rooms (id, livekit_room, host_secret_hash, expires_at) values ($1, $2, $3, now() + interval '3 hours')",
    [id, roomName, await digest(hostSecret)],
  );
  const token = await lk.token("host", "Anfitrião", true, roomName);
  return { roomId: id, hostSecret, url: lk.url, token };
});

export const requestLiveRoomEntry = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ roomId: roomIdSchema }).parse(data))
  .handler(async ({ data }) => {
    const { randomUUID } = await secrets();
    const guestId = randomUUID();
    const requestSecret = await randomSecret();
    const sql = await store();
    const rooms = await sql.query<{ livekit_room: string; closed_at: string | null }>(
      "select livekit_room, closed_at from crossmat_live_rooms where id = $1 and expires_at > now()",
      [data.roomId],
    );
    if (!rooms[0] || rooms[0].closed_at) throw new Error("Esta sala não está mais disponível.");
    const counts = await sql.query<{ count: number }>(
      "select count(*)::int as count from crossmat_live_guests where room_id = $1 and created_at > now() - interval '3 hours'",
      [data.roomId],
    );
    if ((counts[0]?.count ?? 0) >= 24) throw new Error("Esta sala atingiu o limite de pedidos de entrada.");
    const alias = `Convidado ${guestId.slice(0, 4).toUpperCase()}`;
    await sql.query(
      "insert into crossmat_live_guests (id, room_id, display_name, request_secret_hash, status, expires_at) values ($1, $2, $3, $4, 'pending', now() + interval '3 hours')",
      [guestId, data.roomId, alias, await digest(requestSecret)],
    );
    return { guestId, requestSecret, alias };
  });

export const getLiveRoomStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ roomId: roomIdSchema, hostSecret: secretSchema }).parse(data))
  .handler(async ({ data }) => {
    const { sql, room } = await requireHost(data.roomId, data.hostSecret);
    const guests = await sql.query<{ id: string; display_name: string; status: string }>(
      "select id, display_name, status from crossmat_live_guests where room_id = $1 and expires_at > now() and status in ('pending', 'approved') order by created_at asc",
      [room.id],
    );
    return { guests };
  });

export const getLiveHostSession = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ roomId: roomIdSchema, hostSecret: secretSchema }).parse(data))
  .handler(async ({ data }) => {
    const { room } = await requireHost(data.roomId, data.hostSecret);
    const lk = await runtime();
    return {
      url: lk.url,
      token: await lk.token("host", "Anfitrião", true, room.livekit_room),
    };
  });

export const decideLiveRoomEntry = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ roomId: roomIdSchema, hostSecret: secretSchema, guestId: guestIdSchema, approve: z.boolean() }).parse(data))
  .handler(async ({ data }) => {
    const { sql, room } = await requireHost(data.roomId, data.hostSecret);
    const result = await sql.query<{ id: string }>(
      "update crossmat_live_guests set status = $1, approved_at = case when $1 = 'approved' then now() else null end where id = $2 and room_id = $3 and status = 'pending' and expires_at > now() returning id",
      [data.approve ? "approved" : "denied", data.guestId, room.id],
    );
    if (!result.length) throw new Error("Este pedido já foi respondido ou expirou.");
    return { ok: true };
  });

export const getLiveGuestAdmission = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ roomId: roomIdSchema, guestId: guestIdSchema, requestSecret: secretSchema }).parse(data))
  .handler(async ({ data }) => {
    const sql = await store();
    const rows = await sql.query<{
      status: string;
      display_name: string;
      request_secret_hash: string;
      livekit_room: string;
      closed_at: string | null;
    }>(
      "select g.status, g.display_name, g.request_secret_hash, r.livekit_room, r.closed_at from crossmat_live_guests g join crossmat_live_rooms r on r.id = g.room_id where g.id = $1 and g.room_id = $2 and g.expires_at > now() and r.expires_at > now()",
      [data.guestId, data.roomId],
    );
    const guest = rows[0];
    if (!guest || guest.closed_at || !(await verifySecret(data.requestSecret, guest.request_secret_hash))) {
      throw new Error("Pedido de entrada inválido ou expirado.");
    }
    if (guest.status !== "approved") return { status: guest.status as "pending" | "denied" | "removed" | "left" };
    const lk = await runtime();
    return {
      status: "approved" as const,
      url: lk.url,
      token: await lk.token(`guest-${data.guestId}`, guest.display_name, false, guest.livekit_room),
    };
  });

export const removeLiveRoomGuest = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ roomId: roomIdSchema, hostSecret: secretSchema, guestId: guestIdSchema }).parse(data))
  .handler(async ({ data }) => {
    const { sql, room } = await requireHost(data.roomId, data.hostSecret);
    const rows = await sql.query<{ status: string }>(
      "update crossmat_live_guests set status = 'removed' where id = $1 and room_id = $2 and status = 'approved' returning status",
      [data.guestId, room.id],
    );
    if (!rows.length) throw new Error("Participante não encontrado.");
    const lk = await runtime();
    await lk.api.removeParticipant(room.livekit_room, `guest-${data.guestId}`).catch(() => {});
    return { ok: true };
  });

export const leaveLiveRoom = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ roomId: roomIdSchema, guestId: guestIdSchema, requestSecret: secretSchema }).parse(data))
  .handler(async ({ data }) => {
    const sql = await store();
    const rows = await sql.query<{ livekit_room: string; request_secret_hash: string; status: string }>(
      "select r.livekit_room, g.request_secret_hash, g.status from crossmat_live_guests g join crossmat_live_rooms r on r.id = g.room_id where g.id = $1 and g.room_id = $2 and r.closed_at is null and r.expires_at > now()",
      [data.guestId, data.roomId],
    );
    const guest = rows[0];
    if (!guest || !(await verifySecret(data.requestSecret, guest.request_secret_hash))) return { ok: true };
    await sql.query("update crossmat_live_guests set status = 'left' where id = $1 and status = 'approved'", [data.guestId]);
    if (guest.status === "approved") {
      const lk = await runtime();
      await lk.api.removeParticipant(guest.livekit_room, `guest-${data.guestId}`).catch(() => {});
    }
    return { ok: true };
  });

export const closeLiveRoom = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ roomId: roomIdSchema, hostSecret: secretSchema }).parse(data))
  .handler(async ({ data }) => {
    const { sql, room } = await requireHost(data.roomId, data.hostSecret);
    await sql.query("update crossmat_live_rooms set closed_at = now() where id = $1", [room.id]);
    await sql.query("update crossmat_live_guests set status = 'removed' where room_id = $1 and status in ('pending', 'approved')", [room.id]);
    const lk = await runtime();
    await lk.api.deleteRoom(room.livekit_room).catch(() => {});
    return { ok: true };
  });
