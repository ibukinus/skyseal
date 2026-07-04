import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { openDatabase } from "./db/index.js";

describe("createApp", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyseal-app-test-"));
    fs.writeFileSync(path.join(tmpDir, "denylist.json"), JSON.stringify({ dids: [], records: [] }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET / はプレースホルダ画面を200で返し、共通ヘッダとフッターリンクを含む", async () => {
    const config = loadConfig({
      SKYSEAL_ORIGIN: "https://skyseal.example.com",
      SKYSEAL_DB_PATH: path.join(tmpDir, "skyseal.db"),
      SKYSEAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      SKYSEAL_OAUTH_PRIVATE_KEYS: JSON.stringify([
        { kty: "EC", crv: "P-256", kid: "k1", d: "d", x: "x", y: "y" },
      ]),
      SKYSEAL_DENYLIST_PATH: path.join(tmpDir, "denylist.json"),
    });
    const db = openDatabase(path.join(tmpDir, "skyseal.db"));
    const app = createApp({ config, db });

    const res = await app.request("/");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(body).toContain("skyseal");
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/privacy"');

    db.close();
  });
});
