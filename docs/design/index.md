# design/ — 設計文書

アーキテクチャ、Lexiconスキーマ定義、画面設計などの設計文書を置く。

- [architecture.md](./architecture.md) — アーキテクチャ概要（システム構成、コンポーネント、データフロー、セキュリティ・ログ方針）
- [lexicon.md](./lexicon.md) — Lexicon定義（`jp.mp0.skyseal.post` のスキーマと案内投稿の生成仕様）
- [oauth-session.md](./oauth-session.md) — OAuth・セッション管理設計（granular scope、トークン保管、CSRF対策）
- [content-api.md](./content-api.md) — 本文取得API設計（DID解決、検証、表示停止判定、レート制限）
- [screens.md](./screens.md) — 画面・ルーティング設計（7画面、投稿・削除処理）

技術スタック選定は [ADR 0004](../adr/0004-tech-stack-typescript-hono.md) を参照。
