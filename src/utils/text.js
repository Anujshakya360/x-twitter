// Pulls #hashtags and @mentions out of post text.
const HASHTAG = /#([\p{L}\p{N}_]{1,50})/gu;
const MENTION = /@([A-Za-z0-9_]{1,15})/g;

const extractHashtags = (text = '') =>
  [...new Set([...text.matchAll(HASHTAG)].map((m) => m[1].toLowerCase()))];

const extractMentionHandles = (text = '') =>
  [...new Set([...text.matchAll(MENTION)].map((m) => m[1].toLowerCase()))];

module.exports = { extractHashtags, extractMentionHandles };
