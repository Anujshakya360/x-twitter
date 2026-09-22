const router = require('express').Router();
const c = require('../controllers/message.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, c.listConversations);
router.get('/unread-count', requireAuth, c.unreadCount);
router.get('/:username', requireAuth, c.openConversation);
router.post('/:username', requireAuth, validate({ body: c.schemas.sendSchema }), c.sendMessage);

module.exports = router;
