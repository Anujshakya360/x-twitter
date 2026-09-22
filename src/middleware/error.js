const ApiError = require('../utils/ApiError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  // Translate driver / mongoose errors into API errors.
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    error = ApiError.conflict(`That ${field} is already taken`);
  } else if (err.name === 'ValidationError') {
    error = ApiError.badRequest('Validation failed',
      Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })));
  } else if (err.name === 'CastError') {
    error = ApiError.badRequest(`Invalid ${err.path}`);
  } else if (err.name === 'MulterError') {
    error = ApiError.badRequest(err.message);
  }

  const status = error.status || 500;
  if (status >= 500) console.error(err);

  res.status(status).json({
    success: false,
    message: status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : error.message,
    ...(error.details ? { details: error.details } : {}),
  });
}

const notFound = (req, res) =>
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });

module.exports = { errorHandler, notFound };
