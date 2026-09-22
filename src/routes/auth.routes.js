const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

// Credential endpoints get their own tighter limit than the global one.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, validate({ body: c.schemas.registerSchema }), c.register);
router.post('/login', authLimiter, validate({ body: c.schemas.loginSchema }), c.login);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);
router.post('/logout-all', requireAuth, c.logoutAll);
router.get('/me', requireAuth, c.me);
router.post('/change-password', requireAuth, authLimiter,
  validate({ body: c.schemas.changePasswordSchema }), c.changePassword);

module.exports = router;
