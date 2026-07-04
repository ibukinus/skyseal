---
type: ADR
title: 技術スタックをTypeScript + Hono + SQLiteとする
description: MVPの実装言語・フレームワーク・データストアをTypeScript（Node.js）、Hono、SQLiteに決定する。
tags: [adr, tech-stack, typescript, hono, sqlite]
timestamp: 2026-07-04T21:53:00+09:00
status: accepted
---

# 0004 — 技術スタックをTypeScript + Hono + SQLiteとする

## ステータス

accepted（2026-07-04）

## コンテキスト

MVP要件（[requirements/mvp.md](../requirements/mvp.md)）の実装に着手するにあたり、言語・Webフレームワーク・データストアを決める必要がある。

技術選定に効く要件上の制約は以下のとおり。

- AT Protocol OAuth（granular scope）でのログインが必須で、フォールバックを設けない（6.1）。OAuthクライアント実装の成熟度が最重要となる。
- サービス側の恒久データはOAuthセッション情報と表示停止識別子程度に限られ（7.2）、大規模なデータベースは不要。
- 専用ページの初期HTMLに本文を含めず、ページ読み込み後にサービスAPIから取得する（6.7、ADR-0002）。SSRと小さなクライアントJSの組み合わせで足りる。
- 本文取得APIにレート制限を設ける（7.3）。
- 個人運営の小規模サービスであり、運用の単純さ（単一プロセス、少ない依存）を優先する。

## 決定

| 項目 | 採用 |
| --- | --- |
| 言語 | TypeScript（strict） |
| ランタイム | Node.js（Active LTS） |
| Webフレームワーク | Hono（`@hono/node-server`、SSRはHonoのJSXレンダラ） |
| AT Protocolクライアント | `@atproto/oauth-client-node`、`@atproto/api` |
| データストア | SQLite（`better-sqlite3`。OAuthセッション保存用） |
| クライアントJS | 素のTypeScript最小構成（本文取得・バイト数カウントのみ）、esbuildでバンドル |
| テスト | Vitest |
| Lint / Format | Biome |
| 配布形態 | 単一Nodeプロセス（Dockerイメージ）。ホスティング先は別途決定 |

選定理由：

- **TypeScript / Node.js** — AT ProtocolのリファレンスSDK（`@atproto/oauth-client-node` 等）はTypeScript製で、OAuth（DPoP、PAR、granular scope）の実装が最も成熟している。他言語のSDKでgranular scope対応を自前実装するリスクを避ける。
- **Hono** — 軽量で、SSR（JSX）・APIルーティング・セキュリティヘッダやレート制限のミドルウェアを1つのフレームワークで賄える。本サービスの画面数（7画面）とAPI数に対してNext.js等のフルスタックFWは過剰。
- **SQLite** — 恒久保存対象がセッション情報のみで、同時書き込み負荷が低い。外部DBサーバーを持たないことで運用対象を減らす。
- **素のクライアントJS** — 専用ページで必要なクライアント処理は「本文取得APIを叩いてテキストを描画する」だけであり、UIフレームワークは不要。依存を減らすことは本文漏えい防止（7.1）の監査容易性にも効く。

## 検討した代替案

- **Next.js / Remix（React系フルスタック）** — SSRとAPIを統合できるが、画面数が少なく静的な本サービスには過剰。ビルド・ランタイムの複雑さと依存の多さが運用・監査コストになる。
- **Express / Fastify + テンプレートエンジン** — 実績はあるが、HonoのほうがTypeScript第一級・軽量で、ミドルウェア構成も要件に十分。
- **Go / Rust** — 単一バイナリ配布の魅力はあるが、atproto OAuth（DPoP + granular scope）のクライアントSDKの成熟度がTypeScriptに劣り、自前実装分のリスクが大きい。
- **Cloudflare Workers等のエッジランタイム** — `@atproto/oauth-client-node` がNode前提であること、インメモリのレート制限やSQLiteとの相性、常駐単一プロセスの単純さから、MVPではNodeプロセスを選択。エッジ移行はMVP後に必要が生じたら再検討する。

## 結果

- 基本設計文書（[design/architecture.md](../design/architecture.md) ほか）はこのスタックを前提に記述する。
- ホスティング先（VPS、PaaS等）は未決定であり、決定時に別ADRとして記録する。設計は「単一Nodeプロセス + ローカルSQLite」が動く環境であれば成立するようにする。
