import type Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config/index.js";
import { openDatabase } from "../db/index.js";
import { CSRF_FIELD_NAME, generateCsrfToken } from "../middleware/csrf.js";
import type { AppSession } from "../services/session.js";
import { createAppSession, SESSION_COOKIE_NAME } from "../services/session.js";
import type { AppEnv } from "../types.js";

vi.mock("../services/oauth.js", () => {
  class SessionRevokedError extends Error {}
  return {
    getAgentForDid: vi.fn(),
    SessionRevokedError,
  };
});

vi.mock("../services/spoiler-post.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/spoiler-post.js")>();
  return {
    ...actual,
    createSpoilerPost: vi.fn(),
  };
});

const { getAgentForDid, SessionRevokedError } = await import("../services/oauth.js");
const { createSpoilerPost, SpoilerPostWriteError } = await import("../services/spoiler-post.js");
const { composeRoute } = await import("./compose.js");

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const ORIGIN = "https://skyseal.mp0.jp";

function buildConfig(): Config {
  return {
    origin: ORIGIN,
    dbPath: ":memory:",
    encryptionKey: Buffer.alloc(32),
    oauthPrivateKeys: [],
    trustedProxies: [],
    denylistPath: "",
  };
}

function buildApp(db: Database.Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("config", buildConfig());
    c.set("db", db);
    // biome-ignore lint/suspicious/noExplicitAny: テストではoauthClientの中身は使わない（getAgentForDidをモック済み）
    c.set("oauthClient", {} as any);
    await next();
  });
  app.route("/", composeRoute);
  return app;
}

function cookieHeader(session: AppSession): Record<string, string> {
  return { cookie: `${SESSION_COOKIE_NAME}=${session.sessionId}` };
}

describe("compose routes", () => {
  let db: Database.Database;
  let session: AppSession;

  beforeEach(() => {
    db = openDatabase(":memory:");
    session = createAppSession(db, DID);
    vi.mocked(getAgentForDid).mockReset();
    vi.mocked(createSpoilerPost).mockReset();
  });

  afterEach(() => {
    db.close();
  });

  describe("GET /compose", () => {
    it("未ログインなら / へリダイレクトする", async () => {
      const app = buildApp(db);
      const res = await app.request("/compose", { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });

    it("ログイン済みならCSRFトークン付きのフォームを返す", async () => {
      const app = buildApp(db);
      const res = await app.request("/compose", { headers: cookieHeader(session) });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('name="text"');
      expect(body).toContain(`name="${CSRF_FIELD_NAME}"`);
      // タイトル・カテゴリ・作品名・進行範囲の入力欄がない（要件6.2 受入基準4）。
      expect(body).not.toContain('name="title"');
    });
  });

  describe("POST /compose", () => {
    function validBody(csrfToken: string, text: string): URLSearchParams {
      return new URLSearchParams({ [CSRF_FIELD_NAME]: csrfToken, text });
    }

    it("CSRFトークン欠如は403", async () => {
      const app = buildApp(db);
      const res = await app.request("/compose", {
        method: "POST",
        headers: { ...cookieHeader(session), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ text: "本文" }),
      });
      expect(res.status).toBe(403);
      expect(createSpoilerPost).not.toHaveBeenCalled();
    });

    it("空文字列の本文は422相当のエラー再表示（本文保持）", async () => {
      const app = buildApp(db);
      const csrfToken = generateCsrfToken(session.csrfSecret);
      const res = await app.request("/compose", {
        method: "POST",
        headers: { ...cookieHeader(session), "content-type": "application/x-www-form-urlencoded" },
        body: validBody(csrfToken, ""),
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("本文を入力してください");
      expect(createSpoilerPost).not.toHaveBeenCalled();
    });

    it("空白のみの本文は拒否され、入力値をフォームに保持する", async () => {
      const app = buildApp(db);
      const csrfToken = generateCsrfToken(session.csrfSecret);
      const whitespaceText = "   　\n\t  ";
      const res = await app.request("/compose", {
        method: "POST",
        headers: { ...cookieHeader(session), "content-type": "application/x-www-form-urlencoded" },
        body: validBody(csrfToken, whitespaceText),
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("本文を入力してください");
      expect(createSpoilerPost).not.toHaveBeenCalled();
    });

    it("7,500バイト超過の本文は拒否する", async () => {
      const app = buildApp(db);
      const csrfToken = generateCsrfToken(session.csrfSecret);
      const tooLong = "a".repeat(7501);
      const res = await app.request("/compose", {
        method: "POST",
        headers: { ...cookieHeader(session), "content-type": "application/x-www-form-urlencoded" },
        body: validBody(csrfToken, tooLong),
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("7,500バイト以内");
      expect(createSpoilerPost).not.toHaveBeenCalled();
    });

    it("セッション失効時は / へリダイレクトする", async () => {
      vi.mocked(getAgentForDid).mockRejectedValue(new SessionRevokedError());
      const app = buildApp(db);
      const csrfToken = generateCsrfToken(session.csrfSecret);
      const res = await app.request("/compose", {
        method: "POST",
        headers: { ...cookieHeader(session), "content-type": "application/x-www-form-urlencoded" },
        body: validBody(csrfToken, "ネタバレ本文"),
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });

    it("成功時は303で /compose/done/{rkeyPost} へリダイレクトする（PRG）", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: テスト用のAgentダブル
      vi.mocked(getAgentForDid).mockResolvedValue({} as any);
      vi.mocked(createSpoilerPost).mockResolvedValue({
        rkeyPost: "3labc0000000a",
        rkeyAnnounce: "3labc0000000b",
        dedicatedUrl: `${ORIGIN}/p/${DID}/3labc0000000a`,
      });

      const app = buildApp(db);
      const csrfToken = generateCsrfToken(session.csrfSecret);
      const res = await app.request("/compose", {
        method: "POST",
        headers: { ...cookieHeader(session), "content-type": "application/x-www-form-urlencoded" },
        body: validBody(csrfToken, "ネタバレ本文"),
        redirect: "manual",
      });

      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/compose/done/3labc0000000a");
      expect(createSpoilerPost).toHaveBeenCalledWith(
        expect.anything(),
        ORIGIN,
        DID,
        "ネタバレ本文",
      );
    });

    it("PDS書き込み失敗時は本文を保持したままエラー表示（フォールバックしない）", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: テスト用のAgentダブル
      vi.mocked(getAgentForDid).mockResolvedValue({} as any);
      vi.mocked(createSpoilerPost).mockRejectedValue(new SpoilerPostWriteError(new Error("boom")));

      const app = buildApp(db);
      const csrfToken = generateCsrfToken(session.csrfSecret);
      const text = "書き込みに失敗する本文";
      const res = await app.request("/compose", {
        method: "POST",
        headers: { ...cookieHeader(session), "content-type": "application/x-www-form-urlencoded" },
        body: validBody(csrfToken, text),
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("投稿の作成に失敗しました");
      expect(body).toContain(text);
    });
  });

  describe("GET /compose/done/:rkey", () => {
    it("不正なrkey構文は404", async () => {
      const app = buildApp(db);
      const res = await app.request("/compose/done/bad%20key", {
        headers: cookieHeader(session),
      });
      expect(res.status).toBe(404);
    });

    it("レコードが取得できない場合は404", async () => {
      const getRecord = vi.fn().mockRejectedValue(new Error("not found"));
      vi.mocked(getAgentForDid).mockResolvedValue({
        com: { atproto: { repo: { getRecord } } },
        // biome-ignore lint/suspicious/noExplicitAny: テスト用のAgentダブル
      } as any);

      const app = buildApp(db);
      const res = await app.request("/compose/done/3labc0000000a", {
        headers: cookieHeader(session),
      });
      expect(res.status).toBe(404);
    });

    it("正常時は専用URLと案内投稿リンクを表示する", async () => {
      const rkey = "3labc0000000a";
      const announcementRkey = "3labc0000000b";
      const secretText = "これは秘密の本文です";
      const getRecord = vi.fn().mockResolvedValue({
        data: {
          value: {
            $type: "jp.mp0.skyseal.post",
            text: secretText,
            createdAt: "2026-07-04T00:00:00.000Z",
            announcementRkey,
          },
        },
      });
      vi.mocked(getAgentForDid).mockResolvedValue({
        com: { atproto: { repo: { getRecord } } },
        // biome-ignore lint/suspicious/noExplicitAny: テスト用のAgentダブル
      } as any);

      const app = buildApp(db);
      const res = await app.request(`/compose/done/${rkey}`, {
        headers: cookieHeader(session),
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(`${ORIGIN}/p/${DID}/${rkey}`);
      expect(body).toContain(`https://bsky.app/profile/${DID}/post/${announcementRkey}`);
      // 本文そのものはこの画面に表示しない。
      expect(body).not.toContain(secretText);
      expect(getRecord).toHaveBeenCalledWith({
        repo: DID,
        collection: "jp.mp0.skyseal.post",
        rkey,
      });
    });
  });
});
