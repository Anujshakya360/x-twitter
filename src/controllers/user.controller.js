const { z } = require('zod');
const User = require('../models/User');
const Post = require('../models/Post');
const Like = require('../models/Like');
const Follow = require('../models/Follow');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { decoratePosts, decorateUsers, populatePost, AUTHOR_FIELDS } = require('../utils/decorate');
const { cursorFilter, clampLimit, buildPage } = require('../utils/pagination');
const { notify, clearNotification } = require('../utils/notify');

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  bio: z.string().max(160).optional(),
  location: z.string().max(30).optional(),
  website: z.string().max(100).optional(),
  avatar: z.string().optional(),
  banner: z.string().optional(),
  dateOfBirth: z.coerce.date().optional(),
});

const findByUsername = async (username) =>
  User.findOne({ username: String(username).toLowerCase(), deletedAt: null });

const getProfile = asyncHandler(async (req, res) => {
  const user = await findByUsername(req.params.username);
  if (!user) throw ApiError.notFound('This account doesn\u2019t exist');
  res.json({ success: true, data: await decorateUsers(user, req.user?._id) });
});

const updateProfile = asyncHandler(async (req, res) => {
  Object.assign(req.user, req.body);
  await req.user.save();
  res.json({ success: true, data: req.user.toPrivateJSON() });
});

const followUser = asyncHandler(async (req, res) => {
  const target = await findByUsername(req.params.username);
  if (!target) throw ApiError.notFound('This account doesn\u2019t exist');
  if (String(target._id) === String(req.user._id)) throw ApiError.badRequest('You cannot follow yourself');

  try {
    await Follow.create({ follower: req.user._id, following: target._id });
  } catch (err) {
    if (err.code === 11000) {
      return res.json({ success: true, data: { following: true, followerCount: target.followerCount } });
    }
    throw err;
  }

  const [updatedTarget] = await Promise.all([
    User.findByIdAndUpdate(target._id, { $inc: { followerCount: 1 } }, { new: true }),
    User.updateOne({ _id: req.user._id }, { $inc: { followingCount: 1 } }),
    notify({ recipient: target._id, sender: req.user._id, type: 'follow' }),
  ]);

  res.json({ success: true, data: { following: true, followerCount: updatedTarget.followerCount } });
});

const unfollowUser = asyncHandler(async (req, res) => {
  const target = await findByUsername(req.params.username);
  if (!target) throw ApiError.notFound('This account doesn\u2019t exist');

  const removed = await Follow.findOneAndDelete({ follower: req.user._id, following: target._id });
  if (!removed) {
    return res.json({ success: true, data: { following: false, followerCount: target.followerCount } });
  }

  const [updatedTarget] = await Promise.all([
    User.findByIdAndUpdate(target._id, { $inc: { followerCount: -1 } }, { new: true }),
    User.updateOne({ _id: req.user._id }, { $inc: { followingCount: -1 } }),
    clearNotification({ recipient: target._id, sender: req.user._id, type: 'follow' }),
  ]);

  res.json({ success: true, data: { following: false, followerCount: updatedTarget.followerCount } });
});

// direction: 'followers' lists people following this user,
// 'following' lists people this user follows.
const listConnections = (direction) => asyncHandler(async (req, res) => {
  const user = await findByUsername(req.params.username);
  if (!user) throw ApiError.notFound('This account doesn\u2019t exist');

  const matchKey = direction === 'followers' ? 'following' : 'follower';
  const pickKey = direction === 'followers' ? 'follower' : 'following';
  const limit = clampLimit(req.query.limit);

  const rows = await Follow.find({ [matchKey]: user._id, ...cursorFilter(req.query.cursor) })
    .sort({ _id: -1 }).limit(limit + 1)
    .populate(pickKey, AUTHOR_FIELDS);

  const page = buildPage(rows, limit);
  res.json({ success: true,
             data: await decorateUsers(page.items.map((r) => r[pickKey]).filter(Boolean), req.user?._id),
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

// "Who to follow": popular accounts the viewer isn't already following.
const suggestions = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit, 3, 20);
  const exclude = [req.user._id];

  const alreadyFollowing = await Follow.find({ follower: req.user._id }).select('following').lean();
  exclude.push(...alreadyFollowing.map((f) => f.following));

  const users = await User.find({ _id: { $nin: exclude }, deletedAt: null })
    .sort({ followerCount: -1, createdAt: -1 })
    .limit(limit)
    .select(AUTHOR_FIELDS);

  res.json({ success: true, data: await decorateUsers(users, req.user._id) });
});

// tab: posts | replies | media | likes
const userPosts = (tab) => asyncHandler(async (req, res) => {
  const user = await findByUsername(req.params.username);
  if (!user) throw ApiError.notFound('This account doesn\u2019t exist');
  const limit = clampLimit(req.query.limit);

  if (tab === 'likes') {
    const rows = await Like.find({ user: user._id, ...cursorFilter(req.query.cursor) })
      .sort({ _id: -1 }).limit(limit + 1)
      .populate({ path: 'post', match: { deletedAt: null },
                  populate: { path: 'author', select: AUTHOR_FIELDS } });
    const page = buildPage(rows, limit);
    return res.json({ success: true,
                      data: await decoratePosts(page.items.map((r) => r.post).filter(Boolean), req.user?._id),
                      nextCursor: page.nextCursor, hasMore: page.hasMore });
  }

  const filter = { author: user._id, deletedAt: null, ...cursorFilter(req.query.cursor) };
  if (tab === 'posts') filter.parentPost = null;              // top-level + reposts
  if (tab === 'replies') filter.parentPost = { $ne: null };
  if (tab === 'media') { filter.parentPost = null; filter['media.0'] = { $exists: true }; }

  const docs = await populatePost(Post.find(filter).sort({ _id: -1 }).limit(limit + 1));
  const page = buildPage(docs, limit);

  res.json({ success: true, data: await decoratePosts(page.items, req.user?._id),
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

module.exports = {
  getProfile, updateProfile, followUser, unfollowUser,
  followers: listConnections('followers'),
  following: listConnections('following'),
  suggestions,
  posts: userPosts('posts'),
  replies: userPosts('replies'),
  media: userPosts('media'),
  likes: userPosts('likes'),
  schemas: { updateSchema },
};
