import { Hono } from "hono";
import type { AppEnv } from "../types.js";

/**
 * GET / は暫定プレースホルダ。Phase 2でログイン画面（ハンドル入力・OAuth開始）に置き換える。
 */
export const homeRoute = new Hono<AppEnv>();

homeRoute.get("/", (c) => {
  return c.render(
    <section>
      <h1>skyseal</h1>
      <p>準備中です。</p>
    </section>,
    { title: "ログイン" },
  );
});
