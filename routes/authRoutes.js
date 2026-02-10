import express from "express";
import {
  signup,
  login,
  logout,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getCurrentUser,
} from "../controllers/authController.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

// Public routes
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/verify-email", verifyEmail);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Protected routes
router.get("/me", verifyToken, getCurrentUser);

export default router;
