const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/post.controller');
const validate = require('../middleware/validate');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100,
  message: { success: false, message: 'Slow down — too many posts.' } });

router.post('/', requireAuth, writeLimiter, validate({ body: c.schemas.createSchema }), c.createPost);

router.get('/:id', optionalAuth, c.getPost);
router.get('/:id/thread', optionalAuth, c.getPostThread);
router.get('/:id/replies', optionalAuth, c.getReplies);
router.get('/:id/likes', optionalAuth, c.getLikers);
router.delete('/:id', requireAuth, c.deletePost);

router.post('/:id/like', requireAuth, c.likePost);
router.delete('/:id/like', requireAuth, c.unlikePost);

router.post('/:id/repost', requireAuth, c.repost);
router.delete('/:id/repost', requireAuth, c.undoRepost);

router.post('/:id/bookmark', requireAuth, c.bookmarkPost);
router.delete('/:id/bookmark', requireAuth, c.unbookmarkPost);

router.post('/:id/vote', requireAuth, validate({ body: c.schemas.voteSchema }), c.votePoll);

module.exports = router;
