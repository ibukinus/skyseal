---
type: Design
title: 本文取得API設計
description: 専用ページが利用する本文取得APIのインターフェース、DID解決、検証、表示停止判定、レート制限の基本設計。
tags: [design, api, pds, rate-limit, moderation]
timestamp: 2026-07-04T21:53:00+09:00
status: accepted
---

# 本文取得API設計

[MVP要件定義書 6.6・6.9・7章](../requirements/mvp.md) と [ADR-0002](../adr/0002-fetch-spoiler-via-service-api.md) の基本設計。

## 1. インターフェース

```text
GET /api/p/{did}/{rkey}
```

認証：不要（専用ページは公開。要件6.6）。

### 成功レスポンス（200）

```json
{
  "text": "ネタバレ本文",
  "createdAt": "2026-07-04T00:00:00.000Z",
  "author": {
    "did": "did:plc:xxxxxxxxxxxxxxxxxxxxxxxx",
    "handle": "alice.example.com",
    "displayName": "Alice"
  },
  "announcementUrl": "https://bsky.app/profile/did:plc:xxxx/post/3yyyyyyyyyyyy"
}
```

- `handle`・`displayName` は取得できた場合のみ含める（どちらも欠ける場合、画面はDIDを表示する）。
- `announcementUrl` はレコードの `announcementRkey` から導出したBluesky上の案内投稿URL。案内投稿の生存確認はしない（要件6.6）。

### 失敗レスポンス（404）

表示できない理由（不存在・形式不正・取得失敗・アカウント停止・削除済み・表示停止）を**区別せず**、一律で返す（要件6.6）。

```json
{ "error": "unavailable" }
```

### レスポンスヘッダ（200・404共通）

- `Cache-Control: no-store`（要件6.6）
- `Content-Type: application/json; charset=utf-8`
- `X-Content-Type-Options: nosniff`
- `X-Robots-Tag: noindex, nosnippet, noarchive`

## 2. 処理フロー

```text
入力検証 → 表示停止判定 → DID解決 → レコード取得 → 形式検証 → 投稿者情報取得 → 返却
```

1. **入力検証** — `{did}` はDID構文（`did:plc:` または `did:web:` のみ許可）、`{rkey}` はrecord-key構文に適合しなければ404。それ以外のDIDメソッドは対応外として404（フォールバック的な緩和はしない）。`did:web` はAT Protocolの制約どおりホスト名のみを許可し、path-basedな `did:web`（コロン区切りのパスを含むもの）は404とする。
2. **表示停止判定** — 表示停止リスト（後述）にDID単位またはDID+rkey単位で一致したら、以降の処理を行わず404。
3. **DID解決** — `did:plc` は `https://plc.directory/{did}`、`did:web` はwell-known経由でDIDドキュメントを取得する。取得したDIDドキュメントの `id` が要求したDIDと一致することを検証し（不一致は404）、`#atproto_pds` サービスエンドポイント（PDS URL）と `alsoKnownAs` のハンドルを得る。
4. **レコード取得** — PDSの `com.atproto.repo.getRecord`（認証なし）で `jp.mp0.skyseal.post/{rkey}` を取得する。アカウントの削除・停止・無効化はPDSがエラーを返すため、種別を問わずすべて404に写像する。
5. **形式検証** — `$type` が `jp.mp0.skyseal.post`、`text` が1〜7,500バイト（UTF-8）の文字列、`createdAt` がdatetime、`announcementRkey` がrecord-key構文であることを検証する（[lexicon.md](./lexicon.md)）。不正なら404。
6. **投稿者情報取得（ベストエフォート）** — 同じPDSの `com.atproto.repo.getRecord`（`repo={did}`、`collection=app.bsky.actor.profile`、`rkey=self`。認証なし）で `displayName` を得る。AppViewは経由しない。ハンドルはDIDドキュメントの値を双方向検証（ハンドル→DID解決の一致確認）し、一致した場合のみ返す。失敗・不一致でも本文の返却は妨げない（省略するだけ）。
7. **返却** — 上記JSONを組み立てて返す。

## 3. 本文の非永続化（要件7.1、7.2、ADR-0002）

- 本文はリクエスト処理中のメモリ上にのみ存在させる。DB書き込み・ファイル書き込み・キャッシュ層を設けない。
- ログ出力はステップ番号とエラー種別のみとし、PDSレスポンスボディ・レコード内容・例外オブジェクトの生値を記録しない。
- DIDドキュメントの解決結果（PDS URL・ハンドル）は本文ではないため、短TTL（5分程度）のインメモリキャッシュを許可する。レイテンシとplc.directoryへの負荷を下げる目的で、恒久保存はしない。

## 4. 表示停止リスト（要件6.9）

`SKYSEAL_DENYLIST_PATH` で指定するJSONファイルで管理する（MVPでは手動運用）。

```json
{
  "dids": ["did:plc:xxxxxxxxxxxxxxxxxxxxxxxx"],
  "records": [
    { "did": "did:plc:yyyyyyyyyyyyyyyyyyyyyyyy", "rkey": "3zzzzzzzzzzzz" }
  ]
}
```

- プロセスは起動時に読み込み、以後60秒間隔で再読み込みする（再起動不要で反映）。ファイル形式が不正な場合は直前の有効なリストを維持し、エラーをログに残す。
- 判定はレコード取得より**前**に行う。skysealを経由せず第三者が直接PDSに作成したレコードも対象にできる（要件6.9）。
- 保存するのは識別子のみで、対象本文は保存しない（要件7.2）。

## 5. レート制限（要件7.3）

| 対象 | 制限 | 超過時 |
| --- | --- | --- |
| 本文取得API・専用ページ（`/p/*` 合算） | クライアントIPごとに30リクエスト/分（トークンバケット） | `429`、`Retry-After` 付き |
| 全体 | プロセス全体で300リクエスト/分（PDS・plc.directoryへの過負荷防止） | `429` |

- 専用ページ自体も表示可否判定でPDSへアクセスするため（[screens.md 3.4](./screens.md)）、レート制限の対象に含める。
- 単一プロセス前提のためインメモリ実装でよい（[ADR 0004](../adr/0004-tech-stack-typescript-hono.md)）。数値は運用開始後に調整する。
- 429のレスポンスにも本文・理由詳細は含めない。

クライアントIPの決定：リバースプロキシ配下での運用を想定し、信頼するプロキシのCIDRを `SKYSEAL_TRUSTED_PROXIES` で設定する。接続元がこの範囲内の場合のみ `X-Forwarded-For` の右端から信頼プロキシを除いた値をクライアントIPとして採用し、範囲外からの `X-Forwarded-For` は無視して接続元IPを使う。未設定時は `X-Forwarded-For` を一切信用しない（プロキシ配下で全員が同一IP扱いになった場合は設定ミスとして運用で検知する）。

## 6. 外部リクエストの安全策（共通）

以下は本文取得APIに限らず、skysealが行うすべての外部HTTPリクエストに適用する。対象：PDSへのアクセス、`did:web` のDIDドキュメント取得、plc.directoryへのアクセス、ハンドル解決、OAuthの認可サーバーメタデータ取得（[oauth-session.md](./oauth-session.md)）。PDS URLや `did:web` のホスト名は第三者が制御できる値であることを前提とする。

- スキームは `https` のみ許可する。
- 名前解決結果がプライベートIP・ループバック・リンクローカルの場合は接続しない（SSRF対策）。DNS再問い合わせによるすり替え（DNS rebinding）を防ぐため、検証したIPに対して接続する。
- リダイレクトは自動追従しない（必要な場合も同一の検証を通してから接続する）。
- 接続・応答のタイムアウトを設ける（目安：合計5秒）。リトライは行わない。
- レスポンスサイズに上限を設ける（レコード取得で数十KBを超える応答は不正として404扱い）。
