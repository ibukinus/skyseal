import type Database from "better-sqlite3";
import type { Config } from "./config/index.js";

/**
 * Honoコンテキストに載せる共通の依存関係。
 * ルートモジュールは `Hono<AppEnv>` として定義し、`c.get("config")` / `c.get("db")`
 * で設定とDBハンドルにアクセスできる。
 */
export interface AppEnv {
  Variables: {
    config: Config;
    db: Database.Database;
  };
}

// hono/jsx-rendererのContextRendererは宣言マージ対象のinterfaceである必要があり、
// type aliasにすると多重定義エラーになる。
declare module "hono" {
  interface ContextRenderer {
    // biome-ignore lint/style/useShorthandFunctionType: 宣言マージのためinterfaceのまま維持する
    (content: string | Promise<string>, props?: { title?: string }): Response | Promise<Response>;
  }
}
