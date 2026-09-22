const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const signAccessToken = (userId) =>
  jwt.sign({ sub: String(userId) }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_TTL || '15m',
  });

const signRefreshToken = (userId, tokenId) =>
  jwt.sign({ sub: String(userId), jti: tokenId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: `${process.env.REFRESH_TOKEN_TTL_DAYS || 30}d`,
  });

const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_ACCESS_SECRET);
const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

// Refresh tokens are stored hashed, so a database leak can't be replayed.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/api/auth',
  maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30) * 24 * 60 * 60 * 1000,
});

module.exports = {
  signAccessToken, signRefreshToken,
  verifyAccessToken, verifyRefreshToken,
  hashToken, refreshCookieOptions,
};
