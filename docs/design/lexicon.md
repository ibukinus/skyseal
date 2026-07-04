---
type: Design
title: Lexicon定義（jp.mp0.skyseal.post）
description: ネタバレ本文レコードのLexiconスキーマ定義と、案内投稿（app.bsky.feed.post）の生成仕様。
tags: [design, lexicon, atproto, nsid]
timestamp: 2026-07-04T21:53:00+09:00
status: accepted
---

# Lexicon定義（`jp.mp0.skyseal.post`）

[MVP要件定義書 6.3・6.4](../requirements/mvp.md) の基本設計。NSIDは [ADR 0003](../adr/0003-rename-service-to-skyseal.md) で確定済み。

## 1. ネタバレ本文レコード

```json
{
  "lexicon": 1,
  "id": "jp.mp0.skyseal.post",
  "defs": {
    "main": {
      "type": "record",
      "description": "A spoiler post. The text is intentionally separated from the author's Bluesky timeline and shown only on the dedicated skyseal page.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["text", "createdAt", "announcementRkey"],
        "properties": {
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 7500,
            "description": "Spoiler body as plain text. Not interpreted as HTML or Markdown."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Client-declared timestamp when this record was created."
          },
          "announcementRkey": {
            "type": "string",
            "format": "record-key",
            "description": "Record key of the companion announcement post (app.bsky.feed.post) in the same repository."
          }
        }
      }
    }
  }
}
```

設計上の注記：

- **レコードキーは `tid`。** 専用URL `/p/{did}/{rkey}` の `{rkey}` になる。TIDは時刻ベースの生成値であり、投稿者の入力文字列を含まないためURL要件（3.2）を満たす。
- **`maxLength: 7500`** — LexiconのmaxLengthはUTF-8バイト数で解釈されるため、要件6.2「UTF-8で7,500バイト」とそのまま対応する。空白のみ投稿の禁止はスキーマでは表現できないため、アプリケーション側で検証する。
- **`announcementRkey`** — 同一リポジトリ内の案内投稿を指す。AT URIは `at://{did}/app.bsky.feed.post/{announcementRkey}` として導出する（要件6.3）。相互参照のためレコードキー2つを書き込み前に生成する（[architecture.md 3.1](./architecture.md)）。
- 書き込み時、PDSは未知のLexiconを検証せず素通しする（`validate` パラメータは省略）。形式の保証はskyseal側の作成時検証と、表示時の本文取得API検証（[content-api.md](./content-api.md)）で行う。

## 2. 案内投稿（`app.bsky.feed.post`）の生成仕様

案内投稿は既存のBluesky投稿Lexiconを使い、以下の内容で固定生成する（要件6.4）。

```json
{
  "$type": "app.bsky.feed.post",
  "text": "ネタバレを含む投稿です。\n\nhttps://skyseal.mp0.jp/p/{did}/{rkey}",
  "langs": ["ja"],
  "createdAt": "（本文レコードと同一時刻）",
  "facets": [
    {
      "index": { "byteStart": 0, "byteEnd": 0 },
      "features": [
        { "$type": "app.bsky.richtext.facet#link", "uri": "https://skyseal.mp0.jp/p/{did}/{rkey}" }
      ]
    }
  ],
  "embed": {
    "$type": "app.bsky.embed.external",
    "external": {
      "uri": "https://skyseal.mp0.jp/p/{did}/{rkey}",
      "title": "ネタバレ投稿",
      "description": "ネタバレを含む投稿です。"
    }
  }
}
```

- `facets[].index` はURL部分の実際のUTF-8バイト範囲を計算して設定する（上記の `0` はプレースホルダ）。
- `embed.external.thumb` は設定しない（Blob操作権限を要求しないため。要件6.1、6.4）。
- `title`・`description` は専用ページのOGP（要件6.7）と同一の固定文言。
- 投稿者による文言追加の余地はない。テンプレートへの変数展開は `{did}`・`{rkey}` のみで、いずれも投稿者の入力文字列を含まない。

## 3. スキーマ公開（任意、対応が望ましい）

要件6.3のとおり必須ではないが、Lexicon解決に対応する場合は以下を行う。

1. NSID authority `jp.mp0.skyseal` に対応するDNS TXTレコード `_lexicon.skyseal.mp0.jp` に、スキーマ公開用アカウントのDIDを `did=did:plc:...` の形式で設定する（`did=` プレフィックスが必須）。
2. そのアカウントのリポジトリに、コレクション `com.atproto.lexicon.schema`・レコードキー `jp.mp0.skyseal.post` としてスキーマを保存する。レコードの内容は上記スキーマJSONに `"$type": "com.atproto.lexicon.schema"` フィールドを加えたものとする。

MVPのリリース条件には含めない。実施時はこの文書を更新する。
