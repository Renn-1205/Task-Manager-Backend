import jwt from "jsonwebtoken";

/**
 * Generates a JWT token and sets it as an HTTP-only cookie.
 * @param {string} userId - The user's ID from Supabase
 * @param {object} res - Express response object
 * @returns {string} The generated JWT token
 */
export const generateTokenAndSetCookie = (userId, res) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return token;
};
