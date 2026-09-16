import express, { Request, Response } from "express";
import path from "node:path";
import { config } from "../config";
import { CallTracker } from "../ringcentral/callTracker";

export function createHttpApp(tracker: CallTracker) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, activeSessions: (tracker as any).sessions?.size ?? 0 });
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
