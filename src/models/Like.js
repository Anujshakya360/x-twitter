const mongoose = require('mongoose');

const likeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  },
  { timestamps: true }
);

// The unique index is what makes double-liking impossible at the database level,
// rather than relying on a check-then-write race in the controller.
likeSchema.index({ user: 1, post: 1 }, { unique: true });
likeSchema.index({ post: 1, createdAt: -1 });
likeSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Like', likeSchema);
