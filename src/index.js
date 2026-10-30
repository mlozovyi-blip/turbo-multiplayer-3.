import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket server is running!");
    }

    const sockets = this.ctx.getWebSockets();

    if (sockets.length >= 2) {
      return new Response("Room is full", { status:  roomFullStatus() });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const player = sockets.length + 1;
    server.serializeAttachment({ player, x: 0, y: 0 });
    this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({
      type: "welcome",
      player
    }));

    this.broadcast();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(socket, message) {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const attachment = socket.deserializeAttachment();
    if (!attachment) return;

    attachment.x = Number(data.x) || 0;
    attachment.y = Number(data.y) || 0;
    socket.serializeAttachment(attachment);

    this.broadcast();
  }

  async webSocketClose() {
    this.broadcast();
  }

  broadcast() {
    const players = this.ctx.getWebSockets().map(socket => ({
      ...socket.deserializeAttachment()
    }));

    const message = JSON.stringify({
      type: "positions",
      players
    });

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
  }
}

function roomFullStatus() {
  return 409;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("Multiplayer server is running!");
    }

    if (url.pathname === "/ws") {
      const room = url.searchParams.get("room");

      if (!room || !/^[A-Z0-9]{4,8}$/i.test(room)) {
        return new Response("Invalid room code", { status: 400 });
      }

      const id = env.MY_DURABLE_OBJECT.idFromName(room.toUpperCase());
      const stub = env.MY_DURABLE_OBJECT.get(id);

      return stub.fetch(request);
    }

    if (url.pathname === "/api/create" && request.method === "POST") {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const code = Array.from(bytes, b => chars[b % chars.length]).join("");

      return Response.json({ code });
    }

    return new Response("Not found", { status: 404 });
  }
};
