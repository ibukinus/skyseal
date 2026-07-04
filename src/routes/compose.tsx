import type { Agent } from "@atproto/api";
import { Hono } from "hono";
import { buildAnnouncementUrl } from "../lib/at-uri.js";
import { isValidRecordKey } from "../lib/atproto-syntax.js";
import { requireAuth } from "../middleware/auth.js";
import { csrfProtection, generateCsrfToken } from "../middleware/csrf.js";
import { validateSpoilerRecord } from "../services/content.js";
import { getAgentForDid, SessionRevokedError } from "../services/oauth.js";
import {
  buildDedicatedUrl,
  createSpoilerPost,
  SPOILER_COLLECTION,
  SpoilerPostWriteError,
  validateComposeText,
} from "../services/spoiler-post.js";
import type { AppEnv } from "../types.js";
import { ComposeDone } from "../views/compose-done.js";
import { ComposeForm } from "../views/compose-form.js";

/**
 * 投稿作成（`GET /compose`・`POST /compose`・`GET /compose/done/:rkey`。screens.md 3.2・3.3・4.1）。
 *
 * 自己完結のHonoサブアプリとしてexportする。統括者が `app.route("/", composeRoute)` で
 * app.tsx に配線する想定（このファイル内で requireAuth・csrfProtection を都度 use する）。
 */
export const composeRoute = new Hono<AppEnv>();

const COMPOSE_TITLE = "投稿";
const COMPOSE_DONE_TITLE = "投稿完了";
const NOT_FOUND_MESSAGE = "指定された投稿が見つかりません。";

composeRoute.get("/compose", requireAuth(), (c) => {
  const session = c.get("session");
  const csrfToken = generateCsrfToken(session.csrfSecret);
  return c.render(<ComposeForm csrfToken={csrfToken} />, { title: COMPOSE_TITLE });
});

composeRoute.post("/compose", requireAuth(), csrfProtection(), async (c) => {
  const session = c.get("session");
  const body = await c.req.parseBody();
  const text = typeof body.text === "string" ? body.text : "";

  const validationError = validateComposeText(text);
  if (validationError) {
    const csrfToken = generateCsrfToken(session.csrfSecret);
    return c.render(<ComposeForm csrfToken={csrfToken} text={text} error={validationError} />, {
      title: COMPOSE_TITLE,
    });
  }

  let agent: Agent;
  try {
    agent = await getAgentForDid(c.get("oauthClient"), c.get("db"), session.did);
  } catch (err) {
    if (err instanceof SessionRevokedError) {
      return c.redirect("/", 302);
    }
    throw err;
  }

  try {
    const result = await createSpoilerPost(agent, c.get("config").origin, session.did, text);
    // PRG（Post/Redirect/Get）。リロードによる二重投稿を防ぐ（screens.md 1.）。
    return c.redirect(`/compose/done/${result.rkeyPost}`, 303);
  } catch (err) {
    if (err instanceof SpoilerPostWriteError) {
      const csrfToken = generateCsrfToken(session.csrfSecret);
      return c.render(<ComposeForm csrfToken={csrfToken} text={text} error="write-failed" />, {
        title: COMPOSE_TITLE,
      });
    }
    throw err;
  }
});

composeRoute.get("/compose/done/:rkey", requireAuth(), async (c) => {
  const session = c.get("session");
  const rkey = c.req.param("rkey");
  if (!isValidRecordKey(rkey)) {
    return c.text(NOT_FOUND_MESSAGE, 404);
  }

  let agent: Agent;
  try {
    agent = await getAgentForDid(c.get("oauthClient"), c.get("db"), session.did);
  } catch (err) {
    if (err instanceof SessionRevokedError) {
      return c.redirect("/", 302);
    }
    throw err;
  }

  // announcementRkey はセッションのDIDで本文レコードをgetRecordして得る（screens.md 3.3）。
  let recordValue: unknown;
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: session.did,
      collection: SPOILER_COLLECTION,
      rkey,
    });
    recordValue = res.data.value;
  } catch {
    return c.text(NOT_FOUND_MESSAGE, 404);
  }

  const validated = validateSpoilerRecord(recordValue);
  if (!validated) {
    return c.text(NOT_FOUND_MESSAGE, 404);
  }

  const origin = c.get("config").origin;
  const dedicatedUrl = buildDedicatedUrl(origin, session.did, rkey);
  const announcementUrl = buildAnnouncementUrl(session.did, validated.announcementRkey);

  return c.render(<ComposeDone dedicatedUrl={dedicatedUrl} announcementUrl={announcementUrl} />, {
    title: COMPOSE_DONE_TITLE,
  });
});
