const router = require('express').Router();
const c = require('../controllers/user.controller');
const validate = require('../middleware/validate');
const { requireAuth, optionalAuth } = require('../middleware/auth');

// Static paths must be declared before /:username or "suggestions" would be
// read as a username.
router.get('/suggestions', requireAuth, c.suggestions);
router.patch('/me', requireAuth, validate({ body: c.schemas.updateSchema }), c.updateProfile);

router.get('/:username', optionalAuth, c.getProfile);
router.get('/:username/posts', optionalAuth, c.posts);
router.get('/:username/replies', optionalAuth, c.replies);
router.get('/:username/media', optionalAuth, c.media);
router.get('/:username/likes', optionalAuth, c.likes);
router.get('/:username/followers', optionalAuth, c.followers);
router.get('/:username/following', optionalAuth, c.following);

router.post('/:username/follow', requireAuth, c.followUser);
router.delete('/:username/follow', requireAuth, c.unfollowUser);

module.exports = router;
