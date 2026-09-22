const router = require('express').Router();
const c = require('../controllers/feed.controller');
const upload = require('../middleware/upload');
const { requireAuth, optionalAuth } = require('../middleware/auth');

router.get('/search', optionalAuth, c.search);
router.get('/trends', optionalAuth, c.trends);
router.get('/bookmarks', requireAuth, c.bookmarks);

router.get('/notifications', requireAuth, c.listNotifications);
router.post('/notifications/read', requireAuth, c.markNotificationsRead);

// Upload first, then send the returned URLs in the POST /api/posts body.
router.post('/upload', requireAuth, upload.array('files', 4), (req, res) => {
  const files = (req.files || []).map((f) => ({
    url: `/uploads/${f.filename}`,
    type: f.mimetype.startsWith('video') ? 'video'
        : f.mimetype === 'image/gif' ? 'gif' : 'image',
    size: f.size,
  }));
  res.status(201).json({ success: true, data: files });
});

module.exports = router;
