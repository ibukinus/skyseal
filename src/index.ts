import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config/index.js";
import { openDatabase } from "./db/index.js";

function main(): void {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const app = createApp({ config, db });

  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`skyseal listening on http://localhost:${info.port}`);
  });
}

try {
  main();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`起動に失敗しました（設定エラー）: ${err.message}`);
  } else {
    console.error("起動に失敗しました:", err);
  }
  process.exit(1);
}
