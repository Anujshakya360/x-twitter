const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/posts', require('./post.routes'));
router.use('/feed', require('./feed.routes'));
router.use('/conversations', require('./message.routes'));
router.use('/', require('./misc.routes'));

router.get('/health', (req, res) => res.json({ success: true, uptime: process.uptime() }));

module.exports = router;
