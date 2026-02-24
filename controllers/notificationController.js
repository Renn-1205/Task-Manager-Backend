import supabase from "../config/db.js";

// ─── HELPER: Create a notification ──────────────────────────
export const createNotification = async ({
  user_id,
  type,
  title,
  message,
  task_id = null,
  class_id = null,
}) => {
  try {
    const { error } = await supabase
      .from("notifications")
      .insert({ user_id, type, title, message, task_id, class_id });

    if (error) {
      console.error("Create notification error:", error);
    }
  } catch (err) {
    console.error("Notification insert failed:", err);
  }
};

// ─── GET NOTIFICATIONS (current user) ────────────────────────
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unread_only } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", userId);

    if (unread_only === "true") {
      query = query.eq("is_read", false);
    }

    query = query.order("created_at", { ascending: false }).range(from, to);

    const { data: notifications, error, count } = await query;

    if (error) {
      console.error("Get notifications DB error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
    }

    return res.status(200).json({
      success: true,
      notifications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── GET UNREAD COUNT ────────────────────────────────────────
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) {
      return res.status(500).json({ success: false, message: "Failed to fetch count" });
    }

    return res.status(200).json({ success: true, unreadCount: count || 0 });
  } catch (error) {
    console.error("Get unread count error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── MARK ONE AS READ ────────────────────────────────────────
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      return res.status(500).json({ success: false, message: "Failed to mark as read" });
    }

    return res.status(200).json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark as read error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── MARK ALL AS READ ───────────────────────────────────────
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) {
      return res.status(500).json({ success: false, message: "Failed to mark all as read" });
    }

    return res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all as read error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── CHECK OVERDUE TASKS & NOTIFY TEACHERS ───────────────────
// Call this periodically or on-demand (GET /api/notifications/check-overdue)
export const checkOverdueTasks = async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // Find tasks that are past due and not completed
    const { data: overdueTasks, error } = await supabase
      .from("tasks")
      .select("id, title, due_date, created_by, assignee_id, status")
      .lt("due_date", today)
      .neq("status", "completed");

    if (error) {
      console.error("Check overdue DB error:", error);
      return res.status(500).json({ success: false, message: "Failed to check overdue tasks" });
    }

    if (!overdueTasks || overdueTasks.length === 0) {
      return res.status(200).json({ success: true, message: "No overdue tasks", count: 0 });
    }

    let notifiedCount = 0;

    for (const task of overdueTasks) {
      // Check if we already sent an overdue notification for this task
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("type", "task_overdue")
        .eq("user_id", task.created_by)
        .maybeSingle();

      if (!existing) {
        await createNotification({
          user_id: task.created_by,
          type: "task_overdue",
          title: "Task Overdue",
          message: `"${task.title}" is past its due date (${task.due_date}) and hasn't been completed yet.`,
          task_id: task.id,
        });
        notifiedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Checked ${overdueTasks.length} overdue tasks, sent ${notifiedCount} new notifications`,
      count: notifiedCount,
    });
  } catch (error) {
    console.error("Check overdue error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
