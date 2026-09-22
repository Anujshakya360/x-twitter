const crypto = require('crypto');
const { z } = require('zod');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
  signAccessToken, signRefreshToken, verifyRefreshToken,
  hashToken, refreshCookieOptions,
} = require('../utils/tokens');

const registerSchema = z.object({
  name: z.string().trim().min(1).max(50),
  username: z.string().trim().toLowerCase().min(3).max(15)
    .regex(/^[a-z0-9_]+$/, 'Only letters, numbers and underscores'),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  dateOfBirth: z.coerce.date().optional(),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email'),
  password: z.string().min(1, 'Enter your password'),
});

// Issues a new refresh token and records its hash against the user.
async function issueSession(user, req) {
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(user._id, jti);

  user.refreshTokens.push({
    tokenHash: hashToken(refreshToken),
    jti,
    userAgent: req.get('user-agent') || '',
  });
  // Cap concurrent sessions so the array can't grow without bound.
  if (user.refreshTokens.length > 10) user.refreshTokens = user.refreshTokens.slice(-10);
  await user.save();

  return { accessToken: signAccessToken(user._id), refreshToken };
}

const register = asyncHandler(async (req, res) => {
  const { name, username, email, password, dateOfBirth } = req.body;

  const clash = await User.findOne({ $or: [{ email }, { username }] });
  if (clash) {
    throw ApiError.conflict(clash.email === email ? 'Email already registered' : 'Username already taken');
  }

  const user = await User.create({ name, username, email, password, dateOfBirth });
  const { accessToken, refreshToken } = await issueSession(user, req);

  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  res.status(201).json({ success: true, data: { user: user.toPrivateJSON(), accessToken } });
});

const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;

  const user = await User.findOne({
    $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }],
    deletedAt: null,
  }).select('+password');

  // Same message for "no such user" and "wrong password" so the endpoint
  // can't be used to enumerate which accounts exist.
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Wrong username, email or password');
  }

  const { accessToken, refreshToken } = await issueSession(user, req);
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  res.json({ success: true, data: { user: user.toPrivateJSON(), accessToken } });
});

// Rotation: every refresh burns the old token and issues a new one. If a token
// that was already burned shows up, treat it as theft and kill every session.
const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw ApiError.unauthorized('No refresh token');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid refresh token');
  }

  const user = await User.findOne({ _id: payload.sub, deletedAt: null });
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  const hash = hashToken(token);
  const stored = user.refreshTokens.find((t) => t.tokenHash === hash);

  if (!stored) {
    user.refreshTokens = [];
    await user.save();
    res.clearCookie('refreshToken', refreshCookieOptions());
    throw ApiError.unauthorized('Refresh token reuse detected — all sessions ended');
  }

  user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== hash);
  const { accessToken, refreshToken } = await issueSession(user, req);

  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  res.json({ success: true, data: { accessToken } });
});

const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    const hash = hashToken(token);
    await User.updateOne({ 'refreshTokens.tokenHash': hash }, { $pull: { refreshTokens: { tokenHash: hash } } });
  }
  res.clearCookie('refreshToken', refreshCookieOptions());
  res.json({ success: true, message: 'Logged out' });
});

const logoutAll = asyncHandler(async (req, res) => {
  req.user.refreshTokens = [];
  await req.user.save();
  res.clearCookie('refreshToken', refreshCookieOptions());
  res.json({ success: true, message: 'Logged out on all devices' });
});

const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user.toPrivateJSON() });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  user.password = req.body.newPassword;
  user.refreshTokens = []; // force re-login everywhere
  await user.save();

  res.clearCookie('refreshToken', refreshCookieOptions());
  res.json({ success: true, message: 'Password changed. Sign in again.' });
});

module.exports = {
  register, login, refresh, logout, logoutAll, me, changePassword,
  schemas: { registerSchema, loginSchema, changePasswordSchema },
};
