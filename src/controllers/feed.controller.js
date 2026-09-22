const Post = require('../models/Post');
const User = require('../models/User');
const Follow = require('../models/Follow');
const Bookmark = require('../models/Bookmark');
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const { decoratePosts, decorateUsers, populatePost, AUTHOR_FIELDS } = require('../utils/decorate');
const { cursorFilter, clampLimit, buildPage } = require('../utils/pagination');

// "For you" — everything public, newest first. A real ranking model would score
// by engagement and affinity here; reverse-chronological is the honest baseline.
const forYou = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const docs = await populatePost(
    Post.find({ deletedAt: null, parentPost: null, ...cursorFilter(req.query.cursor) })
      .sort({ _id: -1 }).limit(limit + 1)
  );
  const page = buildPage(docs, limit);
  res.json({ success: true, data: await decoratePosts(page.items, req.user?._id),
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

// "Following" — fan-out on read. Fine to a few thousand follows; past that you
// would precompute each user's timeline on write instead.
const following = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const rows = await Follow.find({ follower: req.user._id }).select('following').lean();
  const authors = [...rows.map((r) => r.following), req.user._id];

  const docs = await populatePost(
    Post.find({ author: { $in: authors }, deletedAt: null, parentPost: null, ...cursorFilter(req.query.cursor) })
      .sort({ _id: -1 }).limit(limit + 1)
  );
  const page = buildPage(docs, limit);
  res.json({ success: true, data: await decoratePosts(page.items, req.user._id),
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

const bookmarks = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const rows = await Bookmark.find({ user: req.user._id, ...cursorFilter(req.query.cursor) })
    .sort({ _id: -1 }).limit(limit + 1)
    .populate({ path: 'post', match: { deletedAt: null },
                populate: { path: 'author', select: AUTHOR_FIELDS } });
  const page = buildPage(rows, limit);
  res.json({ success: true,
             data: await decoratePosts(page.items.map((r) => r.post).filter(Boolean), req.user._id),
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

// type: top | latest | people
const search = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const type = req.query.type || 'top';
  const limit = clampLimit(req.query.limit);
  if (!q) return res.json({ success: true, data: [], nextCursor: null, hasMore: false });

  if (type === 'people') {
    const users = await User.find({ deletedAt: null, $text: { $search: q } })
      .limit(limit).select(AUTHOR_FIELDS);
    return res.json({ success: true, data: await decorateUsers(users, req.user?._id), hasMore: false });
  }

  // A leading # searches the hashtag array; anything else is a full-text search.
  const filter = q.startsWith('#')
    ? { hashtags: q.slice(1).toLowerCase(), deletedAt: null }
    : { $text: { $search: q }, deletedAt: null };

  const sort = type === 'latest' ? { _id: -1 } : { likeCount: -1, _id: -1 };
  const docs = await populatePost(
    Post.find({ ...filter, ...cursorFilter(req.query.cursor) }).sort(sort).limit(limit + 1)
  );
  const page = buildPage(docs, limit);
  res.json({ success: true, data: await decoratePosts(page.items, req.user?._id),
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

// Trends from the last 24 hours, counted off the hashtags array.
const trends = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await Post.aggregate([
    { $match: { createdAt: { $gte: since }, deletedAt: null, 'hashtags.0': { $exists: true } } },
    { $unwind: '$hashtags' },
    { $group: { _id: '$hashtags', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  res.json({ success: true, data: rows.map((r) => ({ hashtag: `#${r._id}`, postCount: r.count })) });
});

const listNotifications = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const rows = await Notification.find({ recipient: req.user._id, ...cursorFilter(req.query.cursor) })
    .sort({ _id: -1 }).limit(limit + 1)
    .populate('sender', AUTHOR_FIELDS)
    .populate({ path: 'post', select: 'text media author', match: { deletedAt: null } });
  const page = buildPage(rows, limit);

  const unreadCount = await Notification.countDocuments({ recipient: req.user._id, read: false });
  res.json({ success: true, data: page.items, unreadCount,
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

const markNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, read: false }, { $set: { read: true } });
  res.json({ success: true, message: 'Notifications marked as read' });
});

module.exports = {
  forYou, following, bookmarks, search, trends,
  listNotifications, markNotificationsRead,
};
