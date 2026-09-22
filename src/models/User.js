const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true, maxlength: 50 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true,
                minlength: 3, maxlength: 15, match: /^[a-z0-9_]+$/ },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },

    bio:      { type: String, default: '', maxlength: 160 },
    location: { type: String, default: '', maxlength: 30 },
    website:  { type: String, default: '', maxlength: 100 },
    avatar:   { type: String, default: '' },
    banner:   { type: String, default: '' },
    dateOfBirth: { type: Date },

    verified: { type: Boolean, default: false },
    premium:  { type: Boolean, default: false },

    followerCount:  { type: Number, default: 0, min: 0 },
    followingCount: { type: Number, default: 0, min: 0 },
    postCount:      { type: Number, default: 0, min: 0 },

    // Hashed refresh tokens — one entry per active device/session.
    refreshTokens: [{
      tokenHash: String,
      jti: String,
      createdAt: { type: Date, default: Date.now },
      userAgent: String,
    }],

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.index({ name: 'text', username: 'text' });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Strip secrets from every serialized user.
userSchema.methods.toPublicJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  delete obj.email;
  delete obj.__v;
  return obj;
};

userSchema.methods.toPrivateJSON = function () {
  const obj = this.toPublicJSON();
  obj.email = this.email;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
