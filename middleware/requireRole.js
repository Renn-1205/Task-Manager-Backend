/**
 * Middleware to restrict access by user role.
 * Usage: requireRole('teacher') or requireRole('teacher', 'admin')
 */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized — not authenticated",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden — requires ${roles.join(" or ")} role`,
      });
    }

    next();
  };
};
