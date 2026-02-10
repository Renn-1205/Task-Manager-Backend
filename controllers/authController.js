import bcrypt from "bcryptjs";
import crypto from "crypto";
import supabase from "../config/db.js";
import { generateTokenAndSetCookie } from "../utils/generateTokenAndSetCookie.js";

// ─── SIGNUP ──────────────────────────────────────────────────
export const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

    // Insert user into Supabase
    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        name,
        email,
        password: hashedPassword,
        role: "student",
        is_verified: false,
        verification_code: verificationCode,
        verification_code_expires_at: verificationCodeExpiresAt,
      })
      .select("id, name, email, role, is_verified, created_at")
      .single();

    if (error) {
      console.error("Signup DB error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create account",
      });
    }

    // Set JWT cookie
    generateTokenAndSetCookie(newUser.id, res);

    return res.status(201).json({
      success: true,
      message: "Account created successfully. Please verify your email.",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        isVerified: newUser.is_verified,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── VERIFY EMAIL ────────────────────────────────────────────
export const verifyEmail = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Verification code is required",
      });
    }

    // Find user with matching unexpired code
    const { data: user, error } = await supabase
      .from("users")
      .select("id, verification_code_expires_at")
      .eq("verification_code", code)
      .gt("verification_code_expires_at", new Date().toISOString())
      .single();

    if (error || !user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }

    // Mark user as verified and clear the code
    const { error: updateError } = await supabase
      .from("users")
      .update({
        is_verified: true,
        verification_code: null,
        verification_code_expires_at: null,
      })
      .eq("id", user.id);

    if (updateError) {
      throw updateError;
    }

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("Verify email error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── LOGIN ───────────────────────────────────────────────────
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Get user with password for comparison
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, password, role, is_verified")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Update last login
    await supabase
      .from("users")
      .update({ last_login: new Date().toISOString() })
      .eq("id", user.id);

    // Set JWT cookie
    generateTokenAndSetCookie(user.id, res);

    return res.status(200).json({
      success: true,
      message: "Logged in successfully",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── LOGOUT ──────────────────────────────────────────────────
export const logout = (req, res) => {
  res.clearCookie("token");
  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};

// ─── FORGOT PASSWORD ─────────────────────────────────────────
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (error || !user) {
      // Don't reveal whether the email exists
      return res.status(200).json({
        success: true,
        message: "If an account with that email exists, a reset link has been sent",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await supabase
      .from("users")
      .update({
        reset_password_token: resetToken,
        reset_password_expires_at: resetTokenExpiresAt,
      })
      .eq("id", user.id);

    return res.status(200).json({
      success: true,
      message: "If an account with that email exists, a reset link has been sent",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── RESET PASSWORD ──────────────────────────────────────────
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Token and new password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Find user with matching unexpired token
    const { data: user, error } = await supabase
      .from("users")
      .select("id, email")
      .eq("reset_password_token", token)
      .gt("reset_password_expires_at", new Date().toISOString())
      .single();

    if (error || !user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Update password and clear reset token
    await supabase
      .from("users")
      .update({
        password: hashedPassword,
        reset_password_token: null,
        reset_password_expires_at: null,
      })
      .eq("id", user.id);

    return res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── GET CURRENT USER (check-auth) ──────────────────────────
export const getCurrentUser = async (req, res) => {
  try {
    // req.user is set by verifyToken middleware
    return res.status(200).json({
      success: true,
      user: req.user,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
