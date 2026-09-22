const Notification = require('../models/Notification');

// Never notify yourself about your own action.
async function notify({ recipient, sender, type, post = null }) {
  if (!recipient || String(recipient) === String(sender)) return null;
  return Notification.create({ recipient, sender, type, post });
}

async function clearNotification({ recipient, sender, type, post = null }) {
  if (!recipient || String(recipient) === String(sender)) return;
  await Notification.deleteOne({ recipient, sender, type, post });
}

module.exports = { notify, clearNotification };
