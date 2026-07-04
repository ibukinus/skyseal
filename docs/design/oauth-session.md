---
type: Design
title: OAuth・セッション管理設計
description: AT Protocol OAuth（granular scope）によるログインと、アプリセッション・トークン保管・CSRF対策の基本設計。
tags: [design, oauth, session, security]
timestamp: 2026-07-04T21:53:00+09:00
status: accepted
---

# OAuth・セッション管理設計

[MVP要件定義書 6.1](../requirements/mvp.md) と要件7.3の基本設計。実装には `@atproto/oauth-client-node` を使う（[ADR 0004](../adr/0004-tech-stack-typescript-hono.md)）。

## 1. OAuthクライアント構成

- クライアント種別：confidential client（Webサービス）。
- `client_id`：`https://skyseal.mp0.jp/oauth/client-metadata.json`（クライアントメタデータをこのURLで公開する）。
- リダイレクトURI：`https://skyseal.mp0.jp/oauth/callback`。
- PAR（Pushed Authorization Request）+ DPoPは `@atproto/oauth-client-node` の標準動作に従う。

confidential clientとしてのクライアント認証：

- `token_endpoint_auth_method` は `private_key_jwt`、署名アルゴリズムはES256とする。
- クライアント認証用の秘密鍵（JWK）は環境変数 `SKYSEAL_OAUTH_PRIVATE_KEYS` で与え、対応する公開鍵集合を `jwks_uri`（`https://skyseal.mp0.jp/oauth/jwks.json`）で公開する。
- 鍵ローテーション：新しい鍵を追加してJWKSに新旧を併載し、新鍵への切り替え後に旧鍵を除去する（JWKの `kid` で識別）。MVPでは手動運用でよい。

## 2. 要求スコープ（granular scope）

要求するスコープは以下に固定する。

```text
atproto repo:jp.mp0.skyseal.post?action=create&action=delete repo:app.bsky.feed.post?action=create&action=delete
```

- `atproto` — すべてのatproto OAuthセッションに必須の基本スコープ。
- `repo:jp.mp0.skyseal.post?action=create&action=delete` — 本文レコードの作成・削除。
- `repo:app.bsky.feed.post?action=create&action=delete` — 案内投稿の作成・削除。

設計上の注記：

- `action=update` は要求しない。MVPに投稿編集はなく（要件4.2）、必要権限を作成・削除に絞る。
- `blob:` スコープは要求しない（画像を扱わないため。要件6.1）。
- `rpc:` スコープは要求しない。投稿一覧・レコード取得はいずれも公開エンドポイント（`com.atproto.repo.listRecords` / `getRecord`）を認証なしで呼べるため、認証付きRPCを必要とする操作がない。
- `transition:generic` 等の暫定スコープへの**フォールバックは行わない**（要件6.1、CLAUDE.mdの方針）。

### granular scope未対応PDSの扱い

granular scopeに未対応のPDSでは、PAR（またはトークン発行）の段階で認可サーバーが `invalid_scope` エラーを返す。この場合ログインを失敗として扱い、ログイン画面に「お使いのPDSはコレクション単位の権限指定（granular scope）に対応していないため、skysealにログインできません」という趣旨の明示的なエラーを表示する。広いスコープでの再試行はしない。

補助的に、認可サーバーメタデータの `scopes_supported` を事前確認に使ってよいが、判定の正はPAR時のエラーとする（メタデータ表現がPDS実装間で揺れても誤判定しないため）。

## 3. ログインフロー

1. ログイン画面で投稿者がハンドル（またはDID）を入力する。
2. skysealがハンドル→DID→PDS（認可サーバー）を解決し、PARを実行して認可URLへリダイレクトする。stateとPKCEは `@atproto/oauth-client-node` が管理し、state関連データは `oauth_state` テーブルに保存する。
3. PDS上で投稿者が認可すると `/oauth/callback` に戻る。コールバックでは以下を検証してからトークンを取得する。
   - stateパラメータの検証（CSRF対策、要件7.3）。
   - トークンレスポンスの `sub` が、ログイン開始時に解決したDIDと一致すること。
   - トークンを発行した認可サーバーが、そのDIDのDIDドキュメントから解決される正当な認可サーバーであること（issuerの一致検証）。
   これらはAT Protocol OAuth仕様で必須とされる検証であり、`@atproto/oauth-client-node` が内部で実施する。ライブラリを更新・差し替える際もこの検証が行われることを維持条件とする。
4. トークン一式を `oauth_session` テーブルへ暗号化保存し、アプリセッションを発行して投稿画面へリダイレクトする。

ログインフロー中の外部リクエスト（ハンドル解決、DIDドキュメント取得、認可サーバーメタデータ取得）には、[content-api.md 6.](./content-api.md) の外部リクエスト共通の安全策（https限定、プライベートIP拒否、タイムアウト、サイズ上限）を同様に適用する。

## 4. トークンの保管（要件6.1、7.3）

- OAuthセッション（アクセストークン・リフレッシュトークン・DPoP鍵）は、`SKYSEAL_ENCRYPTION_KEY` を鍵としたAES-256-GCMで暗号化してSQLiteに保存する。
- トークンおよびその一部を、アプリケーションログ・エラーメッセージ・監視データへ出力しない。
- ブラウザ側にはトークンを一切渡さない。ブラウザが持つのはアプリセッションIDのCookieのみ（永続ストレージへのトークン保存禁止の要件を構造的に満たす）。
- トークンのリフレッシュは `@atproto/oauth-client-node` に委ね、リフレッシュ失敗（取り消し・失効）時は該当セッションを削除して再ログインを求める。

## 5. アプリセッション

| 項目 | 設計 |
| --- | --- |
| セッションID | 128bit以上のCSPRNG生成値 |
| Cookie属性 | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| 有効期限 | 発行から14日（固定。スライディング延長なし）。期限到来で再ログイン |
| 保存先 | `app_session` テーブル（セッションID、DID、有効期限、CSRFシークレット） |

- OAuthセッションの有効期限とは独立に、アプリセッションにも上限を設ける（要件7.3「OAuthセッションには有効期限を設ける」に対応。PDS側のトークン期限が長い場合でも14日で切る）。
- 期限切れセッションは定期ジョブ（プロセス内タイマー）で削除する。

## 6. CSRF対策

- OAuthコールバック：stateパラメータの検証（上記3.）。
- 投稿・削除・ログアウトの各POST：`SameSite=Lax` Cookieに加え、セッションごとのCSRFトークンをフォームに埋め込み、サーバー側で照合する（二重防御）。

## 7. ログアウト・連携解除（要件6.1）

1. 可能であれば認可サーバーのトークン取り消し（revocation）を呼ぶ（ベストエフォート。失敗してもログアウトは継続する）。
2. `oauth_session` の該当行と `app_session` の該当行を削除する。
3. セッションCookieを失効させる。

PDS側での連携解除（投稿者がPDSの設定でアプリ許可を取り消した場合）は、次回のトークン利用失敗として検知し、skyseal側のセッション情報を削除する。
