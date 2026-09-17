import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { config } from "../config";
import { CallTracker } from "../ringcentral/callTracker";
import { CallLog } from "../callLog";
import { Store } from "../store";
import type { Hub } from "../hub";

/** Bearer or ?token= check for admin endpoints (dashboard, monitoring). */
function adminAuth(req: Request, res: Response, next: NextFunction) {
  const bearer = req.header("authorization")?.replace(/^Bearer /i, "");
  const token = bearer ?? (req.query.token as string | undefined);
  if (!config.adminToken || token !== config.adminToken) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

/** Agent-scoped auth: extensionId + that extension's token (or shared token). */
function agentAuth(req: Request): string | null {
  const extensionId = req.query.extensionId as string | undefined;
  const token = req.query.token as string | undefined;
  if (!extensionId || !token) return null;
  const expected = config.agentTokens.get(extensionId) ?? config.agentToken;
  return token === expected ? extensionId : null;
}

export function createHttpApp(
  tracker: CallTracker,
  hub: Hub,
  callLog: CallLog,
  store: Store
) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // Dashboard integration reads /api/* cross-origin (e.g. rhlf-ai on another
  // domain). Token-gated; tighten to explicit origins before production.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, activeSessions: (tracker as any).sessions?.size ?? 0 });
  });

  /** Live fleet snapshot — every known extension and its call state. */
  app.get("/api/agents", adminAuth, async (_req, res) => {
    const live = hub.agentStatus();
    // Merge in stored agents that aren't connected right now (offline).
    const known = new Set(live.map((a) => a.extensionId));
    const stored = store.enabled ? await store.listAgents() : [];
    const offline = stored
      .filter((a) => !known.has(a.extensionId))
      .map((a) => ({
        extensionId: a.extensionId,
        name: a.name ?? undefined,
        companionConnected: false,
        uiClients: 0,
        activeSession: null,
        paused: false,
        lastSeen: a.lastSeen,
      }));
    res.json({ agents: [...live, ...offline] });
  });

  /** Recent call records with post-call summaries — newest first. */
  app.get("/api/calls", adminAuth, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = store.enabled ? await store.listCalls(limit) : callLog.list(limit);
    const calls = rows.map((r) => ({
      ...r,
      agentName: store.agentName(r.extensionId),
      durationMs: (r.endedAt ?? Date.now()) - r.startedAt,
    }));
    res.json({ calls });
  });

  /** Per-agent aggregates — the dashboard's performance feed. */
  app.get("/api/performance", adminAuth, async (_req, res) => {
    if (!store.enabled) return res.json({ agents: [], note: "no DATABASE_URL" });
    res.json({ agents: await store.agentPerformance() });
  });

  /**
   * Agent self-service history: the companion UI calls this with the same
   * extensionId+token it uses for its WebSocket. An agent only ever sees
   * their own calls.
   *   GET /api/history?extensionId=&token=&from=<ms>&to=<ms>&q=<text>
   */
  app.get("/api/history", async (req, res) => {
    const extensionId = agentAuth(req);
    if (!extensionId) return res.status(401).json({ error: "unauthorized" });
    if (!store.enabled) {
      const mine = callLog
        .list(200)
        .filter((r) => r.extensionId === extensionId)
        .map((r) => ({ ...r, durationMs: (r.endedAt ?? Date.now()) - r.startedAt }));
      return res.json({ calls: mine, persistent: false });
    }
    const calls = await store.historyFor(extensionId, {
      from: req.query.from ? Number(req.query.from) : undefined,
      to: req.query.to ? Number(req.query.to) : undefined,
      q: (req.query.q as string) || undefined,
      limit: Number(req.query.limit) || 200,
    });
    res.json({
      calls: calls.map((r) => ({
        ...r,
        durationMs: (r.endedAt ?? Date.now()) - r.startedAt,
      })),
      persistent: true,
    });
  });

  /**
   * RingCentral webhook endpoint.
   * Handshake: RC POSTs with a `Validation-Token` header; we must echo it
   * back in the response headers with a 200.
   */
  app.post("/webhooks/ringcentral", (req: Request, res: Response) => {
    const validationToken = req.header("Validation-Token");
    if (validationToken) {
      res.setHeader("Validation-Token", validationToken);
      return res.status(200).end();
    }
    if (
      config.rc.webhookVerificationToken &&
      req.header("Verification-Token") !== config.rc.webhookVerificationToken
    ) {
      return res.status(401).json({ error: "bad verification token" });
    }
    tracker.handleTelephonyEvent(req.body);
    res.status(200).end();
  });

  /**
   * Dev-only: inject a telephony event without a real RC account.
   * POST /dev/call-event  body = telephony session event JSON.
   */
  app.post("/dev/call-event", (req: Request, res: Response) => {
    if (process.env.DEV_EVENTS !== "1") return res.status(404).end();
    tracker.handleTelephonyEvent(req.body);
    res.status(200).json({ ok: true });
  });

  // Agent UI (React app built to ui/dist by `npm --prefix ui run build`).
  app.use("/ui", express.static(path.resolve(__dirname, "../../ui/dist")));

  return app;
}
