import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  checkOverdueTasks,
} from "../controllers/notificationController.js";

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// GET /api/notifications           – list notifications (paginated)
router.get("/", getNotifications);

// GET /api/notifications/unread-count – badge count
router.get("/unread-count", getUnreadCount);

// PUT /api/notifications/read-all   – mark every unread as read
router.put("/read-all", markAllAsRead);

// POST /api/notifications/check-overdue – scan for overdue tasks & notify
router.post("/check-overdue", checkOverdueTasks);

// PUT /api/notifications/:id/read   – mark single notification read
router.put("/:id/read", markAsRead);

export default router;
