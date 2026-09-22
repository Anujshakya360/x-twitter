const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  { url: { type: String, required: true },
    type: { type: String, enum: ['image', 'gif', 'video'], default: 'image' },
    alt: { type: String, default: '', maxlength: 1000 } },
  { _id: false }
);

const pollOptionSchema = new mongoose.Schema(
  { text: { type: String, required: true, maxlength: 25 }, votes: { type: Number, default: 0 } },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text:   { type: String, default: '', maxlength: 280 },
    media:  { type: [mediaSchema], default: [], validate: [(v) => v.length <= 4, 'Max 4 media items'] },

    // A reply points at the post it answers.
    parentPost: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null, index: true },
    // A plain repost carries no text and points at the original.
    repostOf:   { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null, index: true },
    // A quote post carries its own text AND embeds the original.
    quoteOf:    { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

    poll: {
      options: { type: [pollOptionSchema], default: undefined },
      endsAt: Date,
      voters: { type: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                         optionIndex: Number }], default: undefined, select: false },
    },

    replyPolicy: { type: String, enum: ['everyone', 'following', 'mentioned'], default: 'everyone' },

    hashtags: { type: [String], default: [], index: true },
    mentions: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },

    // Denormalised counters. Reading a timeline should never aggregate.
    replyCount:    { type: Number, default: 0, min: 0 },
    repostCount:   { type: Number, default: 0, min: 0 },
    quoteCount:    { type: Number, default: 0, min: 0 },
    likeCount:     { type: Number, default: 0, min: 0 },
    bookmarkCount: { type: Number, default: 0, min: 0 },
    viewCount:     { type: Number, default: 0, min: 0 },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Timeline queries: newest first, filtered by author or by top-level-ness.
postSchema.index({ createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ parentPost: 1, createdAt: -1 });
// One plain repost per user per post.
postSchema.index({ author: 1, repostOf: 1 }, { unique: true, partialFilterExpression: { repostOf: { $type: 'objectId' } } });
postSchema.index({ text: 'text' });

postSchema.virtual('isReply').get(function () { return Boolean(this.parentPost); });
postSchema.virtual('isRepost').get(function () { return Boolean(this.repostOf); });

module.exports = mongoose.model('Post', postSchema);
