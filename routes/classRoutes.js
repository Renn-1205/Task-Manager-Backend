import express from "express";
import {
  createClass,
  getClasses,
  getClass,
  updateClass,
  deleteClass,
  joinClass,
  removeMember,
  getClassMembers,
} from "../controllers/classController.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// Student joins a class via invite code
router.post("/join", joinClass);

// Teacher-only class management
router.post("/", requireRole("teacher", "admin"), createClass);
router.put("/:id", requireRole("teacher", "admin"), updateClass);
router.delete("/:id", requireRole("teacher", "admin"), deleteClass);
router.delete("/:id/members/:userId", requireRole("teacher", "admin"), removeMember);

// Shared (auth required, role logic in controller)
router.get("/", getClasses);
router.get("/:id", getClass);
router.get("/:id/members", getClassMembers);

export default router;
