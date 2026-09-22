// node src/utils/seed.js  — adds demo users/posts WITHOUT touching existing data.
// Safe to run against a database that already has real accounts in it.
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Post = require('../models/Post');
const Like = require('../models/Like');
const Follow = require('../models/Follow');
const { extractHashtags } = require('./text');

const PEOPLE = [
  { name: 'Anouz', username: 'anouz', email: 'anouz@example.com', bio: 'CS student in Kathmandu. Building things.' },
  { name: 'Conscious Call Insights', username: 'picturesfolder', email: 'ci@example.com', verified: true, bio: 'Notes on attention and mind.' },
  { name: 'Dipesh Karki', username: 'dipeshbuilds', email: 'dipesh@example.com', bio: 'Frontend. Coffee. Bugs.' },
  { name: 'Sneha Rai', username: 'sneha_dev', email: 'sneha@example.com', bio: 'Full-stack, mostly Node.' },
  { name: 'Vercel', username: 'vercel', email: 'vercel@example.com', verified: true, bio: 'Ship faster.' },
];

const TEXTS = [
  'Metacognition is thinking about thinking \u2014 observing the observer. #mindfulness',
  'Spent four hours debugging a layout. It was an unclosed div. Validate your HTML. #webdev',
  'Reverse-chronological timelines are underrated. #twitter',
  'Deployed the first version tonight. It works on my machine and, somehow, on yours. #shipping',
  'Learning #Tailwind properly changed how fast I build UI.',
  'Kathmandu mornings hit different. #Kathmandu',
];

(async () => {
  await connectDB();

  // Create each demo user only if that username doesn't already exist —
  // running this twice, or against a database with a real account in it,
  // is safe and won't duplicate or delete anything.
  const users = [];
  for (const p of PEOPLE) {
    let user = await User.findOne({ username: p.username });
    if (!user) {
      user = await User.create({ ...p, password: 'password123' });
      console.log(`Created @${user.username}`);
    } else {
      console.log(`@${user.username} already exists, skipping`);
    }
    users.push(user);
  }

  // Only add the demo posts once — if the first demo post's exact text is
  // already in the database, assume seeding already ran and stop here.
  const alreadySeeded = await Post.findOne({ text: TEXTS[0] });
  if (alreadySeeded) {
    console.log('Demo posts already present — nothing more to add.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const posts = [];
  for (let i = 0; i < TEXTS.length; i++) {
    const author = users[i % users.length];
    posts.push(await Post.create({
      author: author._id, text: TEXTS[i], hashtags: extractHashtags(TEXTS[i]),
    }));
    await User.updateOne({ _id: author._id }, { $inc: { postCount: 1 } });
  }

  await Post.create({
    author: users[3]._id,
    text: 'Tailwind or plain CSS for a first big project?',
    poll: { options: [{ text: 'Tailwind', votes: 68 }, { text: 'Plain CSS', votes: 32 }],
            endsAt: new Date(Date.now() + 8 * 3600 * 1000), voters: [] },
  });
  await Post.create({ author: users[0]._id, text: 'This is exactly it.', parentPost: posts[0]._id });
  await Post.updateOne({ _id: posts[0]._id }, { $inc: { replyCount: 1 } });

  // Demo users follow each other (not your real account — this never touches
  // anyone outside the PEOPLE list above).
  for (const a of users) {
    for (const b of users) {
      if (String(a._id) === String(b._id)) continue;
      const exists = await Follow.findOne({ follower: a._id, following: b._id });
      if (!exists) await Follow.create({ follower: a._id, following: b._id });
    }
    const followerCount = await Follow.countDocuments({ following: a._id });
    const followingCount = await Follow.countDocuments({ follower: a._id });
    await User.updateOne({ _id: a._id }, { $set: { followerCount, followingCount } });
  }

  for (const post of posts) {
    for (const u of users.slice(0, 3)) {
      if (String(u._id) === String(post.author)) continue;
      const exists = await Like.findOne({ user: u._id, post: post._id });
      if (exists) continue;
      await Like.create({ user: u._id, post: post._id });
      await Post.updateOne({ _id: post._id }, { $inc: { likeCount: 1 } });
    }
  }

  console.log(`Seeded ${posts.length + 2} demo posts. Your own account was not touched.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
