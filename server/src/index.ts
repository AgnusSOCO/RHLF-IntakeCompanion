import http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { config, rcConfigured } from "./config";
import { CallTracker } from "./ringcentral/callTracker";
import { ensureTelephonySubscription } from "./ringcentral/subscriptions";
import { createHttpApp } from "./api/http";
import { ObjectionEngine } from "./assist/objections";
import { ScriptEngine } from "./assist/script";
import { CallLog } from "./callLog";
import { Store } from "./store";
import { Hub } from "./hub";

const tracker = new CallTracker();
const objections = new ObjectionEngine();
objections.load();
const script = new ScriptEngine();
script.load();
const callLog = new CallLog();
const store = new Store();
store.init();
const hub = new Hub(tracker, objections, callLog, store, script);

const app = createHttpApp(tracker, hub, callLog, store);
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function authParams(url: URL): { extensionId?: string; ok: boolean } {
  const token = url.searchParams.get("token");
  const extensionId = url.searchParams.get("extensionId") ?? undefined;
  if (!extensionId || !token) return { ok: false };
  // Env-pinned per-extension token wins outright.
  const envToken = config.agentTokens.get(extensionId);
  if (envToken) return { extensionId, ok: token === envToken };
  // A paired (issued) token locks the extension to itself — the shared
  // AGENT_TOKEN no longer authenticates paired extensions.
  if (store.verifyAgentToken(extensionId, token)) return { extensionId, ok: true };
  return { extensionId, ok: !store.hasPairedToken(extensionId) && token === config.agentToken };
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // Admin/dashboard channel: receives every agent event, tagged by extension.
  if (url.pathname === "/admin") {
    if (!config.adminToken || url.searchParams.get("token") !== config.adminToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => hub.registerAdmin(ws));
    return;
  }

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
