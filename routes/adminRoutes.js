import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  changeUserRole,
  getAdminStats,
} from "../controllers/adminController.js";

const router = express.Router();

// All admin routes require authentication + admin role
router.use(verifyToken, requireRole("admin"));

// Stats
router.get("/stats", getAdminStats);

// Users CRUD
router.get("/users", getAllUsers);
router.get("/users/:id", getUserById);
router.post("/users", createUser);
router.put("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);

// Role management
router.patch("/users/:id/role", changeUserRole);

export default router;
