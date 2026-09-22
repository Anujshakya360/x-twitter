const { z } = require('zod');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { AUTHOR_FIELDS } = require('../utils/decorate');
const { cursorFilter, clampLimit, buildPage } = require('../utils/pagination');

const sendSchema = z.object({ text: z.string().trim().min(1).max(280) });

// Finds the 1:1 conversation between two users, creating it on first contact.
// $all on a 2-element array is how you match an exact unordered pair without
// caring which side is "first" — critical since either user might message first.
async function findOrCreateConversation(userIdA, userIdB) {
  let convo = await Conversation.findOne({
    participants: { $all: [userIdA, userIdB], $size: 2 },
  });
  if (!convo) {
    convo = await Conversation.create({ participants: [userIdA, userIdB] });
  }
  return convo;
}

// List every conversation the viewer is part of, most recent first.
const listConversations = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const convos = await Conversation.find({
    participants: req.user._id, ...cursorFilter(req.query.cursor),
  })
    .sort({ _id: -1 }).limit(limit + 1)
    .populate('participants', AUTHOR_FIELDS)
    .populate('lastSender', AUTHOR_FIELDS);

  const page = buildPage(convos, limit);
  const shaped = page.items.map((c) => ({
    _id: c._id,
    otherUser: c.participants.find((p) => String(p._id) !== String(req.user._id)) || c.participants[0],
    lastMessage: c.lastMessage,
    lastMessageAt: c.lastMessageAt,
    lastSenderIsMe: c.lastSender && String(c.lastSender._id) === String(req.user._id),
  }));

  res.json({ success: true, data: shaped, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

// Open (or create) the thread with a specific user by username, and return
// its recent messages. This is the endpoint the chat UI hits first.
const openConversation = asyncHandler(async (req, res) => {
  const other = await User.findOne({ username: req.params.username.toLowerCase(), deletedAt: null });
  if (!other) throw ApiError.notFound('This account doesn\u2019t exist');
  if (String(other._id) === String(req.user._id)) throw ApiError.badRequest('You cannot message yourself');

  const convo = await findOrCreateConversation(req.user._id, other._id);
  const limit = clampLimit(req.query.limit, 30, 50);

  const rows = await Message.find({ conversation: convo._id, ...cursorFilter(req.query.cursor) })
    .sort({ _id: -1 }).limit(limit + 1);
  const page = buildPage(rows, limit);

  // Mark the other person's messages as read the moment this thread is opened.
  await Message.updateMany(
    { conversation: convo._id, sender: other._id, readAt: null },
    { $set: { readAt: new Date() } }
  );

  res.json({
    success: true,
    data: {
      conversationId: convo._id,
      otherUser: { _id: other._id, name: other.name, username: other.username, verified: other.verified },
      messages: page.items.reverse().map((m) => ({
        _id: m._id, text: m.text, createdAt: m.createdAt,
        fromMe: String(m.sender) === String(req.user._id), readAt: m.readAt,
      })),
    },
    nextCursor: page.nextCursor, hasMore: page.hasMore,
  });
});

const sendMessage = asyncHandler(async (req, res) => {
  const other = await User.findOne({ username: req.params.username.toLowerCase(), deletedAt: null });
  if (!other) throw ApiError.notFound('This account doesn\u2019t exist');
  if (String(other._id) === String(req.user._id)) throw ApiError.badRequest('You cannot message yourself');

  const convo = await findOrCreateConversation(req.user._id, other._id);
  const message = await Message.create({ conversation: convo._id, sender: req.user._id, text: req.body.text });

  convo.lastMessage = req.body.text;
  convo.lastMessageAt = message.createdAt;
  convo.lastSender = req.user._id;
  await convo.save();

  res.status(201).json({
    success: true,
    data: { _id: message._id, text: message.text, createdAt: message.createdAt, fromMe: true, readAt: null },
  });
});

// Lightweight poll target: how many total unread DMs does the viewer have.
const unreadCount = asyncHandler(async (req, res) => {
  const convos = await Conversation.find({ participants: req.user._id }).select('_id');
  const count = await Message.countDocuments({
    conversation: { $in: convos.map((c) => c._id) },
    sender: { $ne: req.user._id },
    readAt: null,
  });
  res.json({ success: true, data: { unreadCount: count } });
});

module.exports = { listConversations, openConversation, sendMessage, unreadCount, schemas: { sendSchema } };
