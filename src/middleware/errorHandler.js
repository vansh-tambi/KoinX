/**
 * Centralized error handler middleware.
 * Formats Express exceptions cleanly for client consumption.
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  console.error('Unhandled Exception:', err);

  const status = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    error: {
      message,
      statusCode: status,
      // Only return stack traces in development mode
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    },
  });
};

export default errorHandler;
