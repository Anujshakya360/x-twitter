require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await connectDB();
    const server = app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));

    const shutdown = (signal) => {
      console.log(`\n${signal} received, closing server`);
      server.close(() => process.exit(0));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('unhandledRejection', (err) => { 
      console.error('Unhandled rejection:', err); 
      shutdown('unhandledRejection'); 
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
})();