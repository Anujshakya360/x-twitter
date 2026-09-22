const router = require('express').Router();
const c = require('../controllers/feed.controller');
const { requireAuth, optionalAuth } = require('../middleware/auth');

router.get('/for-you', optionalAuth, c.forYou);
router.get('/following', requireAuth, c.following);

module.exports = router;
