import jwt from "jsonwebtoken";
import supabase from "../config/db.js";

/**
 * Middleware to verify JWT token from cookies.
 * Attaches user data to req.user on success.
 */
export const verifyToken = async (req, res, next) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized — no token provided",
      });
    }

    // Verify the JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized — invalid token",
      });
    }

    // Fetch user from Supabase (excluding password)
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, is_verified, created_at, updated_at")
      .eq("id", decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized — user not found",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized — token expired",
      });
    }
    console.error("Token verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
