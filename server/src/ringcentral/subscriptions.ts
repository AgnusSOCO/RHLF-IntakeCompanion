import { config } from "../config";

/**
 * Creates and renews a RingEX webhook subscription for account-level
 * telephony session events. Requires RC_* credentials and PUBLIC_URL.
 */

let accessToken: string | undefined;
let tokenExpiresAt = 0;
let subscriptionId: string | undefined;

async function login(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) return accessToken;

  const auth = Buffer.from(`${config.rc.clientId}:${config.rc.clientSecret}`).toString("base64");
  const res = await fetch(`${config.rc.serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: config.rc.jwt,
    }),
  });
  if (!res.ok) throw new Error(`RingCentral auth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = json.access_token;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;
  return accessToken!;
}

export async function ensureTelephonySubscription(): Promise<void> {
  if (!config.publicUrl) {
    console.log("[rc] PUBLIC_URL not set - skipping webhook subscription (use /dev/call-event to test)");
    return;
  }
  const token = await login();
  const res = await fetch(`${config.rc.serverUrl}/restapi/v1.0/subscription`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      eventFilters: ["/restapi/v1.0/account/~/telephony/sessions"],
      deliveryMode: {
        transportType: "WebHook",
        address: `${config.publicUrl}/webhooks/ringcentral`,
        verificationToken: config.rc.webhookVerificationToken || undefined,
      },
      expiresIn: 630_720_000, // max ~20 years; renew on restart anyway
    }),
  });
  if (!res.ok) throw new Error(`Subscription failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  subscriptionId = json.id;
  console.log(`[rc] telephony subscription active: ${subscriptionId}`);
}
