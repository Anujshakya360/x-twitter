# X Clone — Backend API

Express + MongoDB (Mongoose) REST API covering auth, posts, replies, likes,
reposts, quotes, bookmarks, polls, follows, notifications, search and trends.

## Run it

```bash
npm install
cp .env.example .env          # then fill in the two JWT secrets
npm run seed                  # optional demo data
npm run dev                   # http://localhost:5000
```

Generate a secret with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Seeded accounts all use the password `password123` (try `anouz`).

## How auth works

Two tokens:

- **Access token** — a 15-minute JWT returned in the JSON body. Store it in
  memory on the client and send it as `Authorization: Bearer <token>`.
- **Refresh token** — a 30-day JWT in an `httpOnly` cookie scoped to `/api/auth`.
  JavaScript can't read it, so an XSS bug can't steal a long-lived session.

Only the SHA-256 hash of each refresh token is stored on the user document, and
every call to `/api/auth/refresh` burns the old token and issues a new one. If a
token that was already burned is presented, the server assumes it was stolen and
wipes every session for that account.

On the client: when a request returns 401 with "Access token expired", call
`POST /api/auth/refresh` (with `credentials: 'include'`) once, then retry.

## Endpoints

### Auth — `/api/auth`
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/register` | – | name, username, email, password, dateOfBirth? |
| POST | `/login` | – | identifier (username or email), password |
| POST | `/refresh` | cookie | – |
| POST | `/logout` | – | – |
| POST | `/logout-all` | yes | – |
| GET | `/me` | yes | – |
| POST | `/change-password` | yes | currentPassword, newPassword |

### Posts — `/api/posts`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/` | yes | text, media[], parentPost?, quoteOf?, poll?, replyPolicy? |
| GET | `/:id` | optional | increments viewCount |
| GET | `/:id/thread` | optional | ancestors + the post |
| GET | `/:id/replies` | optional | cursor paginated |
| GET | `/:id/likes` | optional | who liked it |
| DELETE | `/:id` | yes | author only, soft delete |
| POST/DELETE | `/:id/like` | yes | idempotent |
| POST/DELETE | `/:id/repost` | yes | idempotent |
| POST/DELETE | `/:id/bookmark` | yes | idempotent |
| POST | `/:id/vote` | yes | optionIndex |

A reply sets `parentPost`. A plain repost is a Post row with `repostOf` and no
text. A quote post has its own text plus `quoteOf`.

### Users — `/api/users`
`GET /suggestions` (who to follow) · `PATCH /me` · `GET /:username` ·
`GET /:username/posts|replies|media|likes|followers|following` ·
`POST|DELETE /:username/follow`

### Feed and misc
`GET /api/feed/for-you` · `GET /api/feed/following` · `GET /api/bookmarks` ·
`GET /api/search?q=&type=top|latest|people` · `GET /api/trends` ·
`GET /api/notifications` · `POST /api/notifications/read` ·
`POST /api/upload` (multipart, field `files`, max 4)

## Response shape

Every endpoint returns the same envelope:

```json
{ "success": true, "data": ..., "nextCursor": "6512...", "hasMore": true }
```

Errors:
```json
{ "success": false, "message": "Validation failed",
  "details": [{ "field": "password", "message": "Password must be at least 8 characters" }] }
```

Each post carries a `viewerState` object so the UI can render filled hearts
without a second request:

```json
"viewerState": { "liked": true, "bookmarked": false, "reposted": false, "isAuthor": false }
```

## Design decisions worth knowing

**Cursor pagination, not skip.** Every list takes `?cursor=<last _id>&limit=20`.
ObjectIds increase monotonically, so `_id < cursor` means "older than". With
`skip`, new posts arriving while the user scrolls shift the offset and the client
sees duplicates and gaps.

**Counters are denormalised.** `likeCount`, `replyCount` and the rest live on the
Post document and are moved with atomic `$inc`. Rendering a timeline never runs
an aggregation.

**Uniqueness is enforced by indexes, not code.** `Like`, `Bookmark` and `Follow`
each have a unique compound index, and reposts have a partial unique index on
`(author, repostOf)`. Two simultaneous like requests can't both succeed — the
second gets a duplicate-key error, which the controller treats as success.

**Deletes are soft.** A deleted post keeps its row with `deletedAt` set, so reply
chains and quote embeds don't turn into null references.

**Uploads go to local disk.** `middleware/upload.js` uses multer's disk storage.
Swap that one storage engine for multer-s3 or Cloudinary in production; nothing
else changes.

## Before you deploy

- Add email verification and a password-reset flow. Neither is here.
- Follower fan-out is computed on read. That's fine into the thousands; past
  that, precompute timelines on write.
- `/api/trends` aggregates on every call. Cache it for a few minutes.
- Real-time (live notifications, new-post banner) needs Socket.IO on top of this.
