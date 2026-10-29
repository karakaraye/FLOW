import https from "node:https";
import { generateKeyPairSync, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { googleScopes, type GoogleProvider } from "../src/lib/google/config";
export async function googleFixture() {
  const dir = mkdtempSync(join(tmpdir(), "flow-google-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "tls.key"),
      "-out",
      join(dir, "tls.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=oauth2.googleapis.com",
      "-addext",
      "subjectAltName=DNS:oauth2.googleapis.com,DNS:www.googleapis.com,DNS:sheets.googleapis.com,DNS:gmail.googleapis.com",
    ],
    { stdio: "ignore" },
  );
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  let refreshes = 0,
    sends = 0,
    writes = 0,
    reads = 0,
    failStatus = 0,
    delay = 0,
    revoked = false,
    invalidGrant = false,
    refreshDelay = 50;
  const messages: string[] = [],
    codes = new Map<
      string,
      {
        nonce: string;
        challenge: string;
        provider: GoogleProvider;
        badIdentity?: boolean;
        badScopes?: boolean;
      }
    >();
  const server = https.createServer(
    {
      key: readFileSync(join(dir, "tls.key")),
      cert: readFileSync(join(dir, "tls.pem")),
    },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        void (async () => {
          const raw = Buffer.concat(chunks).toString(),
            path = req.url ?? "",
            form = new URLSearchParams(raw);
          res.setHeader("Content-Type", "application/json");
          if (path === "/oauth2/v1/certs") {
            res.end(
              JSON.stringify({
                "fixture-key": publicKey.export({
                  type: "spki",
                  format: "pem",
                }),
              }),
            );
            return;
          }
          if (path === "/revoke") {
            revoked = true;
            res.end("{}");
            return;
          }
          if (path === "/token") {
            if (form.get("grant_type") === "refresh_token") {
              refreshes++;
              if (invalidGrant || revoked) {
                res.writeHead(400);
                res.end('{"error":"invalid_grant"}');
                return;
              }
              const provider = form.get("refresh_token")?.includes("gmail")
                ? "gmail"
                : "google-sheets";
              await new Promise((r) => setTimeout(r, refreshDelay));
              res.end(
                JSON.stringify({
                  access_token: `fixture-${provider}-access`,
                  refresh_token: `fixture-${provider}-rotated`,
                  expires_in: 3600,
                  scope: googleScopes[provider].join(" "),
                }),
              );
              return;
            }
            const code = form.get("code") ?? "";
            const proof = codes.get(code);
            codes.delete(code);
            if (
              !proof ||
              createHash("sha256")
                .update(form.get("code_verifier") ?? "")
                .digest("base64url") !== proof.challenge ||
              form.get("client_id") !== "fixture-client" ||
              form.get("client_secret") !== "fixture-secret"
            ) {
              res.writeHead(400);
              res.end('{"error":"invalid_grant"}');
              return;
            }
            const token = await new SignJWT({
              email: "authorized@example.test",
              email_verified: true,
              nonce: proof.nonce,
            })
              .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
              .setIssuer(
                proof.badIdentity
                  ? "https://evil.invalid"
                  : "https://accounts.google.com",
              )
              .setAudience("fixture-client")
              .setSubject("fixture-google-subject")
              .setIssuedAt()
              .setExpirationTime("1h")
              .sign(privateKey);
            res.end(
              JSON.stringify({
                access_token: `fixture-${proof.provider}-access`,
                refresh_token: `fixture-${proof.provider}-refresh`,
                id_token: token,
                expires_in: 3600,
                scope: proof.badScopes
                  ? "https://mail.google.com/"
                  : googleScopes[proof.provider].join(" "),
              }),
            );
            return;
          }
          if (!req.headers.authorization?.startsWith("Bearer fixture-")) {
            res.writeHead(401);
            res.end('{"error":{"code":401}}');
            return;
          }
          if (path.startsWith("/gmail/")) {
            sends++;
            messages.push(JSON.parse(raw).raw);
          } else if (req.method === "GET") reads++;
          else writes++;
          if (failStatus) {
            res.writeHead(failStatus);
            res.end(
              JSON.stringify({
                error: {
                  code: failStatus,
                  message: "fixture-private-provider-message",
                  errors: [
                    {
                      reason:
                        failStatus === 429 ? "rateLimitExceeded" : "forbidden",
                    },
                  ],
                },
              }),
            );
            return;
          }
          const finish = () => {
            if (path.startsWith("/gmail/"))
              res.end(
                '{"id":"fixture-message-id","threadId":"fixture-thread"}',
              );
            else if (req.method === "GET")
              res.end(
                '{"range":"Sheet1!A1:B2","values":[["name","value"],["Ada",12]]}',
              );
            else
              res.end(
                JSON.stringify({
                  updatedRows: 1,
                  updates: { updatedRows: 1 },
                  fixtureMethod: req.method,
                }),
              );
          };
          if (delay) setTimeout(finish, delay);
          else finish();
        })().catch(() => {
          res.writeHead(500);
          res.end("{}");
        });
      });
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Fixture failed");
  return {
    port: address.port,
    ca: join(dir, "tls.pem"),
    env: {
      GOOGLE_OAUTH_CLIENT_ID: "fixture-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "fixture-secret",
      GOOGLE_OAUTH_REDIRECT_URI:
        "http://localhost:3000/api/integrations/google/callback",
      HTTP_ACTION_ALLOWED_ORIGINS: JSON.stringify([
        "https://oauth2.googleapis.com",
        "https://www.googleapis.com",
        "https://sheets.googleapis.com",
        "https://gmail.googleapis.com",
      ]),
      GOOGLE_GMAIL_SEND_ENABLED: "true",
      GOOGLE_GMAIL_ALLOWED_RECIPIENTS: '["recipient@example.test"]',
      FLOW_GOOGLE_FIXTURE_PORT: String(address.port),
      FLOW_GOOGLE_FIXTURE_CA: join(dir, "tls.pem"),
    },
    codes,
    messages,
    get counters() {
      return { refreshes, sends, writes, reads, revoked };
    },
    set failure(status: number) {
      failStatus = status;
    },
    set delayMs(ms: number) {
      delay = ms;
    },
    set refreshDelayMs(v: number) {
      refreshDelay = v;
    },
    set invalidRefresh(v: boolean) {
      invalidGrant = v;
    },
    resetRevoked() {
      revoked = false;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
