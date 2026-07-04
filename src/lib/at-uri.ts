/**
 * Bluesky上の案内投稿URLの構築（content-api.md 1.、lexicon.md 1.）。
 */

/**
 * 本文レコードの `announcementRkey` から、Bluesky上の案内投稿URLを導出する。
 * 案内投稿の生存確認はしない（content-api.md 1.、要件6.6）。
 *
 * @param did 投稿者のDID
 * @param announcementRkey 案内投稿（app.bsky.feed.post）のレコードキー
 */
export function buildAnnouncementUrl(did: string, announcementRkey: string): string {
  return `https://bsky.app/profile/${did}/post/${announcementRkey}`;
}
