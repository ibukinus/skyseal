import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { Config } from "./config/index.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { homeRoute } from "./routes/home.js";
import type { AppEnv } from "./types.js";
import { Layout } from "./views/layout.js";

export interface CreateAppDeps {
  config: Config;
  db: Database.Database;
}

export function createApp({ config, db }: CreateAppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("config", config);
    c.set("db", db);
    await next();
  });

  app.use("*", securityHeaders());

  app.use(
    "*",
    jsxRenderer(({ children, title }) => <Layout title={title}>{children}</Layout>),
  );

  app.use("/assets/*", serveStatic({ root: "./public" }));

  app.route("/", homeRoute);

  return app;
}
