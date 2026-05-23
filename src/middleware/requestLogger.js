/**
 * Request logger middleware.
 * Logs method, path, status, and duration of incoming API requests.
 */
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
};

export default requestLogger;
