const mongoose = require('mongoose');

// Cursor pagination on _id. ObjectIds embed a timestamp and are monotonically
// increasing, so "_id < cursor" is equivalent to "older than" without needing a
// compound createdAt+_id key. Offset/skip pagination is avoided because the
// timeline shifts while the user scrolls, which duplicates and drops rows.
function cursorFilter(cursor) {
  if (!cursor || !mongoose.Types.ObjectId.isValid(cursor)) return {};
  return { _id: { $lt: new mongoose.Types.ObjectId(cursor) } };
}

function clampLimit(limit, fallback = 20, max = 50) {
  const n = parseInt(limit, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

// Fetch limit+1 rows, then use the extra one purely to decide hasMore.
function buildPage(docs, limit) {
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  return {
    items,
    nextCursor: hasMore && items.length ? String(items[items.length - 1]._id) : null,
    hasMore,
  };
}

module.exports = { cursorFilter, clampLimit, buildPage };
