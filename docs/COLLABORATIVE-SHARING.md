# Collaborative sharing: key design (for approval, no code yet)

Phase 21 lets an account share one page with other accounts, as reader or editor, without the server learning what is in it. Boards follow only after this design is approved.

## What we keep from the current design

- Notes are sealed on the device; the server relays and stores blobs it cannot read.
- A shared page is **one page**, like a public link (sub-pages are not included).
- Sign-in stays optional, and accounts have no email or name, so people are invited by a **link**, not an address.

## The pieces

1. **Page key (PK).** A random 256-bit key made when a page is first shared. The shared page's content is sealed under keys derived from PK (HKDF, the same way per-doc keys come from the workspace key today). PK is never derived from anyone's workspace key.
2. **Shared room.** One room per shared page, named by a random `shareId`, separate from every account's own room. Bun: a `Room` per `shareId`; Cloudflare: a Durable Object per `shareId`. The sync protocol is unchanged (Subscribe, Push, Entry, Ready, Ack, Snapshot, Notify). Devices open a second WebSocket (`/sync/shared/<shareId>`) only while they hold at least one shared page, so the "one WebSocket per device" rule becomes "one for your own notes, plus one per shared page you open or follow".
3. **Membership table** (new, in the account database): `share_member(shareId, userId, role, epoch, wrappedKey)`, role `owner | editor | reader`. The server uses it to decide who may connect and who may push. It learns who shares a page with whom, and when. It does not learn titles or text.
4. **Member keypair.** On first use each account makes an X25519 key pair on the device. The public half goes to the server (`account_key`); the private half is sealed under the workspace key and kept in the account's own index doc, so every device of that account can use it. New dependency: `@noble/curves` (X25519), beside the noble packages already used.
5. **Wrapping.** To give a member PK, the owner's device does an ephemeral-static X25519 exchange with the member's public key, derives a key with HKDF, and seals PK with AES-GCM (same primitives as today). The result is `wrappedKey`. The server stores it per member and epoch and cannot open it.
6. **Where the recipient keeps it.** After unwrapping, the recipient's device stores `{shareId, PK, role, epoch}` in its own synced index doc under a "shared with me" map, sealed like any other note data. The page then shows in their sidebar under "Shared with me".

## Inviting someone

Accounts cannot be looked up, so an invite is a link, like a public share link:

1. Owner picks "Share with people", chooses a role, optionally names the invite ("for Dina"). The owner's device makes an **invite secret** `s` and uploads an invite record `{inviteId, shareId, role, wrappedPK_under_s}`, where PK is sealed under a key from `s`.
2. The link is `/invite/<inviteId>#<s>`. The fragment never reaches the server.
3. The recipient opens it, signs in or creates an account, and the app unwraps PK with `s`, makes sure they have a key pair, and claims the invite (`POST /api/invites/<id>/claim` with their public key). The server turns the invite into a `share_member` row and deletes the invite (one use). The recipient's device stores PK in its index doc.
4. The owner's device sees the new member (the server tells it), and wraps PK to the member's public key as the long-term wrap (`wrappedKey`, epoch 0), so later key changes reach them.

Anyone who gets the link before the intended person can claim it; the owner sees every member, with the invite's label, and can remove one. The link says so plainly.

## Read and edit

- **Edit:** the server accepts pushes from `owner` and `editor` members.
- **Read:** `reader` members can fetch and subscribe but not push; the server refuses their writes.
- Limit, said plainly: both roles hold PK, so the **server** enforces read-only, not the cryptography. A malicious server could accept a reader's edit; it still could not read the page. A reader who is determined can also read everything they were already allowed to read, forever.

## Removing someone (and its limit)

1. The server deletes their `share_member` row at once: they can no longer connect, fetch or push.
2. The owner's device makes **PK2** (epoch + 1), folds the page's current state into one snapshot sealed under PK2, starts a new epoch in the shared room (old entries dropped), and wraps PK2 to every remaining member's public key. Remaining members' devices fetch and use PK2 automatically.
3. Limit, said plainly: the removed person keeps whatever they already saw and PK (epoch 0), so they can still read anything they copied or any old log entries they downloaded. They cannot see changes made after the removal. If the owner's device is offline at removal, step 2 waits until it is online; until then new edits are still sealed under the old PK, so removal is complete only after step 2 (the panel says "Finishing…").

## Leaving, deleting, and accounts

- A member can **leave**: their row goes, the page leaves their sidebar, nothing rotates (they chose it).
- The owner can **stop sharing**: the shared room and all rows go; each member keeps a read-only local copy of the last state they had, labelled as no longer shared, which they can copy into their own notes.
- Deleting an account removes its memberships. If it owned shared pages, those are stopped as above.
- Server cleanup extends `account.ts` and the "delete forever" path to the shared room.

## Conflicts with other features

- **History, public link, Today lists, backlinks:** a shared page is read on the device like any note. History snapshots of a shared page are sealed under PK and visible to all members (owner-only in v1 to keep the first version small: decision to confirm). A page can be both public-linked and shared with people; the public link keeps its own key.
- **Search and backlinks** index shared pages on each member's device.
- **Quotas** (phase 19): the page's storage counts against the owner.

## Decisions needed before boards

1. Invite by link only (as above), or also something like a short code? (Recommended: link only, one use, expires in 7 days.)
2. Only the owner invites and removes people in v1 (recommended), or editors may invite readers too?
3. History of a shared page: owner only (recommended), or any editor?
4. One extra WebSocket per shared page you have open (recommended; simple, isolated), or one multiplexed socket for all shared pages?

## Build order once approved

1. Crypto: X25519 wrap/unwrap in `packages/sync/src/crypto.ts` with tests.
2. Server: `share_member`, `account_key`, `share_invite` tables and routes; shared rooms on Bun and Cloudflare; membership checks on connect and push; tests, including "reader cannot push" and "removed member cannot connect".
3. Client: key pair in the index doc, "shared with me" map, second socket, rotation on removal.
4. Boards, then UI (invite dialog, people list, role switch, remove, leave, "Shared with me"), browser check with two accounts, e2e test with two accounts.
