const Like = require('../models/Like');
const Bookmark = require('../models/Bookmark');
const Post = require('../models/Post');
const Follow = require('../models/Follow');

const AUTHOR_FIELDS = 'name username avatar verified premium bio followerCount followingCount';

// Given a page of posts and the viewer, attach the per-viewer state in three
// batched queries instead of N per post. Without this the timeline is an
// N+1 query and gets slow around 20 posts.
async function decoratePosts(posts, viewerId) {
  const list = Array.isArray(posts) ? posts : [posts];
  if (!list.length) return Array.isArray(posts) ? [] : null;

  // Collect ids of the posts themselves plus anything they embed.
  const ids = new Set();
  for (const p of list) {
    if (!p) continue;
    ids.add(String(p._id));
    if (p.repostOf?._id) ids.add(String(p.repostOf._id));
    if (p.quoteOf?._id) ids.add(String(p.quoteOf._id));
  }
  const idArray = [...ids];

  let liked = new Set(), bookmarked = new Set(), reposted = new Set();

  if (viewerId) {
    const [likes, bookmarks, reposts] = await Promise.all([
      Like.find({ user: viewerId, post: { $in: idArray } }).select('post').lean(),
      Bookmark.find({ user: viewerId, post: { $in: idArray } }).select('post').lean(),
      Post.find({ author: viewerId, repostOf: { $in: idArray } }).select('repostOf').lean(),
    ]);
    liked = new Set(likes.map((l) => String(l.post)));
    bookmarked = new Set(bookmarks.map((b) => String(b.post)));
    reposted = new Set(reposts.map((r) => String(r.repostOf)));
  }

  const apply = (post) => {
    if (!post) return post;
    const obj = post.toObject ? post.toObject() : post;
    const id = String(obj._id);
    obj.viewerState = {
      liked: liked.has(id),
      bookmarked: bookmarked.has(id),
      reposted: reposted.has(id),
      isAuthor: viewerId ? String(obj.author?._id || obj.author) === String(viewerId) : false,
    };
    if (obj.poll) delete obj.poll.voters;
    if (obj.repostOf) obj.repostOf = apply(obj.repostOf);
    if (obj.quoteOf) obj.quoteOf = apply(obj.quoteOf);
    return obj;
  };

  const out = list.map(apply);
  return Array.isArray(posts) ? out : out[0];
}

// Same idea for user lists: one query to find which of them the viewer follows.
async function decorateUsers(users, viewerId) {
  const list = Array.isArray(users) ? users : [users];
  if (!list.length) return Array.isArray(users) ? [] : null;

  let followingSet = new Set();
  if (viewerId) {
    const rows = await Follow.find({
      follower: viewerId,
      following: { $in: list.map((u) => u._id) },
    }).select('following').lean();
    followingSet = new Set(rows.map((r) => String(r.following)));
  }

  const out = list.map((u) => {
    const obj = u.toPublicJSON ? u.toPublicJSON() : { ...u };
    delete obj.password;
    delete obj.refreshTokens;
    obj.viewerState = {
      following: followingSet.has(String(u._id)),
      isSelf: viewerId ? String(u._id) === String(viewerId) : false,
    };
    return obj;
  });

  return Array.isArray(users) ? out : out[0];
}

// Standard populate chain for any post query.
const populatePost = (query) =>
  query
    .populate('author', AUTHOR_FIELDS)
    .populate({ path: 'repostOf', populate: { path: 'author', select: AUTHOR_FIELDS } })
    .populate({ path: 'quoteOf', populate: { path: 'author', select: AUTHOR_FIELDS } });

module.exports = { decoratePosts, decorateUsers, populatePost, AUTHOR_FIELDS };
