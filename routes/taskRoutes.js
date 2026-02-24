import express from "express";
import {
  createTask,
  getTasks,
  getTask,
  updateTask,
  deleteTask,
  getTaskStats,
  getStudents,
} from "../controllers/taskController.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

// All task routes require authentication
router.use(verifyToken);

// Teacher-only routes
router.post("/", requireRole("teacher", "admin"), createTask);
router.get("/stats", requireRole("teacher", "admin"), getTaskStats);
router.get("/students", requireRole("teacher", "admin"), getStudents);
router.delete("/:id", requireRole("teacher", "admin"), deleteTask);

// Shared routes (teacher + student, with role-based logic in controller)
router.get("/", getTasks);
router.get("/:id", getTask);
router.put("/:id", updateTask);

export default router;
