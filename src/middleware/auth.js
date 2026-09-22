const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../utils/tokens');

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Hard gate: 401 if there is no valid access token.
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = readToken(req);
  if (!token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw ApiError.unauthorized(err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid token');
  }

  const user = await User.findOne({ _id: payload.sub, deletedAt: null });
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  req.user = user;
  next();
});

// Soft gate: attaches req.user when a token is present, but never rejects.
// Used on public timelines so responses can still carry `liked` / `following` flags.
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = await User.findOne({ _id: payload.sub, deletedAt: null });
  } catch {
    // ignore — treat as anonymous
  }
  next();
});

module.exports = { requireAuth, optionalAuth };
