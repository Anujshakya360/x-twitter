const mongoose = require('mongoose');
const { z } = require('zod');
const Post = require('../models/Post');
const Like = require('../models/Like');
const Bookmark = require('../models/Bookmark');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { decoratePosts, decorateUsers, populatePost, AUTHOR_FIELDS } = require('../utils/decorate');
const { cursorFilter, clampLimit, buildPage } = require('../utils/pagination');
const { extractHashtags, extractMentionHandles } = require('../utils/text');
const { notify, clearNotification } = require('../utils/notify');

const createSchema = z.object({
  text: z.string().max(280).optional().default(''),
  media: z.array(z.object({
    url: z.string().min(1),
    type: z.enum(['image', 'gif', 'video']).default('image'),
    alt: z.string().max(1000).optional().default(''),
  })).max(4).optional().default([]),
  parentPost: z.string().optional(),
  quoteOf: z.string().optional(),
  replyPolicy: z.enum(['everyone', 'following', 'mentioned']).optional().default('everyone'),
  poll: z.object({
    options: z.array(z.string().min(1).max(25)).min(2).max(4),
    durationMinutes: z.number().int().min(5).max(10080).default(1440),
  }).optional(),
});

const livePost = (id) => Post.findOne({ _id: id, deletedAt: null });

const createPost = asyncHandler(async (req, res) => {
  const { text, media, parentPost, quoteOf, replyPolicy, poll } = req.body;

  if (!text.trim() && !media.length && !poll) {
    throw ApiError.badRequest('A post needs text, media or a poll');
  }
  if (poll && media.length) throw ApiError.badRequest('A poll cannot also have media');

  let parent = null;
  if (parentPost) {
    parent = await livePost(parentPost);
    if (!parent) throw ApiError.notFound('The post you are replying to no longer exists');
  }

  let quoted = null;
  if (quoteOf) {
    quoted = await livePost(quoteOf);
    if (!quoted) throw ApiError.notFound('The quoted post no longer exists');
  }

  // Resolve @handles to real user ids so mentions are linkable and notifiable.
  const handles = extractMentionHandles(text);
  const mentionedUsers = handles.length
    ? await User.find({ username: { $in: handles }, deletedAt: null }).select('_id').lean()
    : [];

  const post = await Post.create({
    author: req.user._id,
    text: text.trim(),
    media,
    parentPost: parent?._id || null,
    quoteOf: quoted?._id || null,
    replyPolicy,
    hashtags: extractHashtags(text),
    mentions: mentionedUsers.map((u) => u._id),
    poll: poll ? {
      options: poll.options.map((t) => ({ text: t, votes: 0 })),
      endsAt: new Date(Date.now() + poll.durationMinutes * 60 * 1000),
      voters: [],
    } : undefined,
  });

  // Counter bumps. $inc is atomic, so concurrent replies can't clobber each other.
  const bumps = [User.updateOne({ _id: req.user._id }, { $inc: { postCount: 1 } })];
  if (parent) {
    bumps.push(Post.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } }));
    bumps.push(notify({ recipient: parent.author, sender: req.user._id, type: 'reply', post: post._id }));
  }
  if (quoted) {
    bumps.push(Post.updateOne({ _id: quoted._id }, { $inc: { quoteCount: 1 } }));
    bumps.push(notify({ recipient: quoted.author, sender: req.user._id, type: 'quote', post: post._id }));
  }
  for (const u of mentionedUsers) {
    bumps.push(notify({ recipient: u._id, sender: req.user._id, type: 'mention', post: post._id }));
  }
  await Promise.all(bumps);

  const full = await populatePost(Post.findById(post._id));
  res.status(201).json({ success: true, data: await decoratePosts(full, req.user._id) });
});

const getPost = asyncHandler(async (req, res) => {
  const post = await populatePost(livePost(req.params.id));
  if (!post) throw ApiError.notFound('Post not found');

  // Fire and forget — a view shouldn't block the response.
  Post.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } }).catch(() => {});

  res.json({ success: true, data: await decoratePosts(post, req.user?._id) });
});

// Returns the ancestor chain above a post, so the client can render a thread.
const getPostThread = asyncHandler(async (req, res) => {
  const chain = [];
  let cursor = await populatePost(livePost(req.params.id));
  if (!cursor) throw ApiError.notFound('Post not found');

  const focus = cursor;
  let guard = 0;
  while (cursor?.parentPost && guard++ < 20) {
    cursor = await populatePost(livePost(cursor.parentPost));
    if (cursor) chain.unshift(cursor);
  }

  res.json({
    success: true,
    data: {
      ancestors: await decoratePosts(chain, req.user?._id),
      post: await decoratePosts(focus, req.user?._id),
    },
  });
});

const getReplies = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const docs = await populatePost(
    Post.find({ parentPost: req.params.id, deletedAt: null, ...cursorFilter(req.query.cursor) })
      .sort({ _id: -1 }).limit(limit + 1)
  );
  const page = buildPage(docs, limit);
  res.json({ success: true, data: await decoratePosts(page.items, req.user?._id),
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

// Soft delete: the row stays so reply chains and counters don't break.
const deletePost = asyncHandler(async (req, res) => {
  const post = await livePost(req.params.id);
  if (!post) throw ApiError.notFound('Post not found');
  if (String(post.author) !== String(req.user._id)) throw ApiError.forbidden('You can only delete your own posts');

  post.deletedAt = new Date();
  await post.save();

  const work = [User.updateOne({ _id: req.user._id }, { $inc: { postCount: -1 } })];
  if (post.parentPost) work.push(Post.updateOne({ _id: post.parentPost }, { $inc: { replyCount: -1 } }));
  if (post.repostOf) work.push(Post.updateOne({ _id: post.repostOf }, { $inc: { repostCount: -1 } }));
  if (post.quoteOf) work.push(Post.updateOne({ _id: post.quoteOf }, { $inc: { quoteCount: -1 } }));
  await Promise.all(work);

  res.json({ success: true, message: 'Post deleted' });
});

const likePost = asyncHandler(async (req, res) => {
  const post = await livePost(req.params.id);
  if (!post) throw ApiError.notFound('Post not found');

  try {
    await Like.create({ user: req.user._id, post: post._id });
  } catch (err) {
    // Duplicate key means it was already liked — idempotent success, not an error.
    if (err.code === 11000) {
      return res.json({ success: true, data: { liked: true, likeCount: post.likeCount } });
    }
    throw err;
  }

  const updated = await Post.findByIdAndUpdate(post._id, { $inc: { likeCount: 1 } }, { new: true });
  await notify({ recipient: post.author, sender: req.user._id, type: 'like', post: post._id });

  res.json({ success: true, data: { liked: true, likeCount: updated.likeCount } });
});

const unlikePost = asyncHandler(async (req, res) => {
  const removed = await Like.findOneAndDelete({ user: req.user._id, post: req.params.id });
  if (!removed) {
    const post = await livePost(req.params.id);
    return res.json({ success: true, data: { liked: false, likeCount: post?.likeCount ?? 0 } });
  }
  const updated = await Post.findByIdAndUpdate(req.params.id, { $inc: { likeCount: -1 } }, { new: true });
  await clearNotification({ recipient: updated?.author, sender: req.user._id, type: 'like', post: req.params.id });

  res.json({ success: true, data: { liked: false, likeCount: updated?.likeCount ?? 0 } });
});

const getLikers = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const rows = await Like.find({ post: req.params.id, ...cursorFilter(req.query.cursor) })
    .sort({ _id: -1 }).limit(limit + 1)
    .populate('user', AUTHOR_FIELDS);
  const page = buildPage(rows, limit);
  res.json({ success: true,
             data: await decorateUsers(page.items.map((r) => r.user).filter(Boolean), req.user?._id),
             nextCursor: page.nextCursor, hasMore: page.hasMore });
});

const repost = asyncHandler(async (req, res) => {
  const original = await livePost(req.params.id);
  if (!original) throw ApiError.notFound('Post not found');
  if (original.repostOf) throw ApiError.badRequest('Repost the original post instead');

  try {
    await Post.create({ author: req.user._id, repostOf: original._id, text: '' });
  } catch (err) {
    if (err.code === 11000) {
      return res.json({ success: true, data: { reposted: true, repostCount: original.repostCount } });
    }
    throw err;
  }

  const updated = await Post.findByIdAndUpdate(original._id, { $inc: { repostCount: 1 } }, { new: true });
  await notify({ recipient: original.author, sender: req.user._id, type: 'repost', post: original._id });

  res.json({ success: true, data: { reposted: true, repostCount: updated.repostCount } });
});

const undoRepost = asyncHandler(async (req, res) => {
  const removed = await Post.findOneAndDelete({ author: req.user._id, repostOf: req.params.id });
  if (!removed) {
    const post = await livePost(req.params.id);
    return res.json({ success: true, data: { reposted: false, repostCount: post?.repostCount ?? 0 } });
  }
  const updated = await Post.findByIdAndUpdate(req.params.id, { $inc: { repostCount: -1 } }, { new: true });
  await clearNotification({ recipient: updated?.author, sender: req.user._id, type: 'repost', post: req.params.id });

  res.json({ success: true, data: { reposted: false, repostCount: updated?.repostCount ?? 0 } });
});

const bookmarkPost = asyncHandler(async (req, res) => {
  try {
    await Bookmark.create({ user: req.user._id, post: req.params.id });
    await Post.updateOne({ _id: req.params.id }, { $inc: { bookmarkCount: 1 } });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  res.json({ success: true, data: { bookmarked: true } });
});

const unbookmarkPost = asyncHandler(async (req, res) => {
  const removed = await Bookmark.findOneAndDelete({ user: req.user._id, post: req.params.id });
  if (removed) await Post.updateOne({ _id: req.params.id }, { $inc: { bookmarkCount: -1 } });
  res.json({ success: true, data: { bookmarked: false } });
});

const voteSchema = z.object({ optionIndex: z.number().int().min(0).max(3) });

const votePoll = asyncHandler(async (req, res) => {
  const { optionIndex } = req.body;
  const post = await Post.findOne({ _id: req.params.id, deletedAt: null }).select('+poll.voters');

  if (!post?.poll?.options?.length) throw ApiError.notFound('This post has no poll');
  if (post.poll.endsAt && post.poll.endsAt < new Date()) throw ApiError.badRequest('This poll has ended');
  if (optionIndex >= post.poll.options.length) throw ApiError.badRequest('That option does not exist');
  if (post.poll.voters.some((v) => String(v.user) === String(req.user._id))) {
    throw ApiError.conflict('You already voted in this poll');
  }

  post.poll.options[optionIndex].votes += 1;
  post.poll.voters.push({ user: req.user._id, optionIndex });
  await post.save();

  const totalVotes = post.poll.options.reduce((sum, o) => sum + o.votes, 0);
  res.json({
    success: true,
    data: {
      yourVote: optionIndex,
      totalVotes,
      options: post.poll.options.map((o) => ({
        text: o.text, votes: o.votes,
        percent: totalVotes ? Math.round((o.votes / totalVotes) * 100) : 0,
      })),
    },
  });
});

module.exports = {
  createPost, getPost, getPostThread, getReplies, deletePost,
  likePost, unlikePost, getLikers,
  repost, undoRepost,
  bookmarkPost, unbookmarkPost,
  votePoll,
  schemas: { createSchema, voteSchema },
};
