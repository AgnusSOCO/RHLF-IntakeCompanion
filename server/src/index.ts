import http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { config, rcConfigured } from "./config";
import { CallTracker } from "./ringcentral/callTracker";
import { ensureTelephonySubscription } from "./ringcentral/subscriptions";
import { createHttpApp } from "./api/http";
import { ObjectionEngine } from "./assist/objections";
import { Hub } from "./hub";

const tracker = new CallTracker();
const objections = new ObjectionEngine();
objections.load();
const hub = new Hub(tracker, objections);

const app = createHttpApp(tracker);
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function authParams(url: URL): { extensionId?: string; ok: boolean } {
  const token = url.searchParams.get("token");
  const extensionId = url.searchParams.get("extensionId") ?? undefined;
  return { extensionId, ok: token === config.agentToken && Boolean(extensionId) };
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const { extensionId, ok } = authParams(url);
  if (!ok || !extensionId) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.pathname === "/audio") {
      hub.registerCompanion(extensionId, ws);
    } else if (url.pathname === "/ui") {
      hub.registerUi(extensionId, ws);
    } else {
      ws.close(1008, "unknown path");
    }
  });
});

server.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
  console.log(`[server] agent UI: http://localhost:${config.port}/ui/?extensionId=<ext>&token=<token>`);
  if (!config.deepgramApiKey) {
    console.warn("[server] DEEPGRAM_API_KEY not set - transcription will fail");
  }
  if (rcConfigured()) {
    ensureTelephonySubscription().catch((e) => console.error("[rc]", e.message));
  } else {
    console.log("[server] RC credentials not set - running without real call events");
  }
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
