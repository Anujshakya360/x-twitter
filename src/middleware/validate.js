const ApiError = require('../utils/ApiError');

// validate({ body: schema, params: schema, query: schema })
module.exports = (schemas) => (req, res, next) => {
  for (const key of ['body', 'params', 'query']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || key,
        message: i.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }
    // Zod strips unknown keys, which also blocks mass-assignment.
    if (key !== 'query') req[key] = result.data;
    else req.validatedQuery = result.data;
  }
  next();
};
