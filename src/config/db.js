const mongoose = require('mongoose');

async function connectDB() {
  mongoose.set('strictQuery', true);
  
  // Update this line below:
const uri = process.env.MONGO_URI;

  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);
  console.log('MongoDB connected:', mongoose.connection.name);

  mongoose.connection.on('error', (err) => console.error('MongoDB error:', err.message));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
}

module.exports = connectDB;