import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { config } from "../config";
import { CallTracker } from "../ringcentral/callTracker";
import { CallLog } from "../callLog";
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

export function createHttpApp(tracker: CallTracker, hub: Hub, callLog: CallLog) {
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
  app.get("/api/agents", adminAuth, (_req, res) => {
    res.json({ agents: hub.agentStatus() });
  });

  /** Recent call records with post-call summaries — newest first. */
  app.get("/api/calls", adminAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const calls = callLog.list(limit).map((r) => ({
      ...r,
      durationMs: (r.endedAt ?? Date.now()) - r.startedAt,
    }));
    res.json({ calls });
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
