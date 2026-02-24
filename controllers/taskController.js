import supabase from "../config/db.js";
import { createNotification } from "./notificationController.js";

// ─── CREATE TASK (Teacher only) ──────────────────────────────
export const createTask = async (req, res) => {
  try {
    const { title, description, due_date, priority, assignee_id, class_id } = req.body;
    const createdBy = req.user.id;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    // If class_id is provided, verify the class exists (and teacher owns it, unless admin)
    if (class_id) {
      const { data: cls } = await supabase
        .from("classes")
        .select("id, teacher_id")
        .eq("id", class_id)
        .single();

      if (!cls) {
        return res.status(400).json({
          success: false,
          message: "Invalid class",
        });
      }

      if (req.user.role !== "admin" && cls.teacher_id !== createdBy) {
        return res.status(400).json({
          success: false,
          message: "You don't own this class",
        });
      }
    }

    const taskData = {
      title,
      description: description || null,
      due_date: due_date || null,
      priority: priority || "medium",
      status: "todo",
      created_by: createdBy,
      assignee_id: assignee_id || null,
      class_id: class_id || null,
    };

    // If assignee is provided, verify they exist and are a student
    if (assignee_id) {
      const { data: assignee, error: assigneeError } = await supabase
        .from("users")
        .select("id, role")
        .eq("id", assignee_id)
        .single();

      if (assigneeError || !assignee) {
        return res.status(400).json({
          success: false,
          message: "Assignee not found",
        });
      }
    }

    const { data: task, error } = await supabase
      .from("tasks")
      .insert(taskData)
      .select(`
        id, title, description, due_date, priority, status,
        created_by, assignee_id, class_id, created_at, updated_at
      `)
      .single();

    if (error) {
      console.error("Create task DB error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create task",
      });
    }

    // ── Notify the assigned student ──
    if (task.assignee_id) {
      createNotification({
        user_id: task.assignee_id,
        type: "task_assigned",
        title: "New Task Assigned",
        message: `You've been assigned a new task: "${task.title}"`,
        task_id: task.id,
        class_id: task.class_id || null,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Task created successfully",
      task,
    });
  } catch (error) {
    console.error("Create task error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── GET ALL TASKS (Teacher: all their tasks; Student: assigned tasks) ───
export const getTasks = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    const { status, priority, search, class_id, page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from("tasks")
      .select(`
        id, title, description, due_date, priority, status,
        created_by, assignee_id, class_id, created_at, updated_at,
        assignee:users!tasks_assignee_id_fkey(id, name, email),
        creator:users!tasks_created_by_fkey(id, name, email)
      `, { count: "exact" });

    // Teachers see tasks they created; students see tasks assigned to them
    if (role === "teacher" || role === "admin") {
      query = query.eq("created_by", userId);
    } else {
      query = query.eq("assignee_id", userId);
    }

    // Filter by class
    if (class_id) {
      query = query.eq("class_id", class_id);
    }

    // Filters
    if (status && status !== "all") {
      query = query.eq("status", status);
    }
    if (priority && priority !== "all") {
      query = query.eq("priority", priority);
    }
    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    // Pagination & ordering
    query = query.order("created_at", { ascending: false }).range(from, to);

    const { data: tasks, error, count } = await query;

    if (error) {
      console.error("Get tasks DB error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch tasks",
      });
    }

    return res.status(200).json({
      success: true,
      tasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error("Get tasks error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── GET SINGLE TASK ─────────────────────────────────────────
export const getTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, id: userId } = req.user;

    const { data: task, error } = await supabase
      .from("tasks")
      .select(`
        id, title, description, due_date, priority, status,
        created_by, assignee_id, created_at, updated_at,
        assignee:users!tasks_assignee_id_fkey(id, name, email),
        creator:users!tasks_created_by_fkey(id, name, email)
      `)
      .eq("id", id)
      .single();

    if (error || !task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Authorization: teachers can see their own tasks, students only assigned tasks
    if (role === "student" && task.assignee_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden — you can only view tasks assigned to you",
      });
    }

    if (role === "teacher" && task.created_by !== userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden — you can only view tasks you created",
      });
    }

    return res.status(200).json({ success: true, task });
  } catch (error) {
    console.error("Get task error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── UPDATE TASK ─────────────────────────────────────────────
// Teacher: can update all fields. Student: can only update status.
export const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, id: userId } = req.user;

    // Fetch existing task
    const { data: existingTask, error: fetchError } = await supabase
      .from("tasks")
      .select("id, created_by, assignee_id")
      .eq("id", id)
      .single();

    if (fetchError || !existingTask) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Authorization
    if (role === "student") {
      if (existingTask.assignee_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden — you can only update tasks assigned to you",
        });
      }

      // Students can ONLY update status
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Students can only update task status",
        });
      }

      const { data: task, error } = await supabase
        .from("tasks")
        .update({ status })
        .eq("id", id)
        .select(`
          id, title, description, due_date, priority, status,
          created_by, assignee_id, created_at, updated_at
        `)
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to update task",
        });
      }

      // ── Notify teacher when student completes a task ──
      if (status === "completed" && existingTask.created_by) {
        // Get student name for the notification
        const { data: studentUser } = await supabase
          .from("users")
          .select("name")
          .eq("id", userId)
          .single();
        const studentName = studentUser?.name || "A student";

        createNotification({
          user_id: existingTask.created_by,
          type: "task_completed",
          title: "Task Completed",
          message: `${studentName} completed the task: "${task.title}"`,
          task_id: task.id,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Task status updated",
        task,
      });
    }

    // Teacher / Admin — can update everything
    if (existingTask.created_by !== userId && role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Forbidden — you can only edit tasks you created",
      });
    }

    const { title, description, due_date, priority, status, assignee_id, class_id } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (due_date !== undefined) updateData.due_date = due_date;
    if (priority !== undefined) updateData.priority = priority;
    if (status !== undefined) updateData.status = status;
    if (assignee_id !== undefined) updateData.assignee_id = assignee_id;
    if (class_id !== undefined) updateData.class_id = class_id;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    const { data: task, error } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", id)
      .select(`
        id, title, description, due_date, priority, status,
        created_by, assignee_id, created_at, updated_at
      `)
      .single();

    if (error) {
      console.error("Update task DB error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update task",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Task updated successfully",
      task,
    });
  } catch (error) {
    console.error("Update task error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── DELETE TASK (Teacher only) ──────────────────────────────
export const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, id: userId } = req.user;

    // Fetch task to check ownership
    const { data: existingTask, error: fetchError } = await supabase
      .from("tasks")
      .select("id, created_by")
      .eq("id", id)
      .single();

    if (fetchError || !existingTask) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (existingTask.created_by !== userId && role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Forbidden — you can only delete tasks you created",
      });
    }

    const { error } = await supabase.from("tasks").delete().eq("id", id);

    if (error) {
      console.error("Delete task DB error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete task",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Task deleted successfully",
    });
  } catch (error) {
    console.error("Delete task error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── GET TASK STATS (for teacher dashboard) ──────────────────
export const getTaskStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get counts by status
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id, status")
      .eq("created_by", userId);

    if (error) {
      throw error;
    }

    const totalTasks = tasks.length;
    const todoCount = tasks.filter((t) => t.status === "todo").length;
    const inProgressCount = tasks.filter((t) => t.status === "in-progress").length;
    const completedCount = tasks.filter((t) => t.status === "completed").length;

    // Get total students (unique assignees)
    const { data: assignees, error: assigneeError } = await supabase
      .from("tasks")
      .select("assignee_id")
      .eq("created_by", userId)
      .not("assignee_id", "is", null);

    const uniqueStudents = assigneeError
      ? 0
      : new Set(assignees.map((a) => a.assignee_id)).size;

    return res.status(200).json({
      success: true,
      stats: {
        totalActive: todoCount + inProgressCount,
        pendingReview: inProgressCount,
        todo: todoCount,
        completed: completedCount,
        totalTasks,
        totalStudents: uniqueStudents,
      },
    });
  } catch (error) {
    console.error("Get task stats error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─── GET STUDENTS (for assignee dropdown) ────────────────────
export const getStudents = async (req, res) => {
  try {
    const { data: students, error } = await supabase
      .from("users")
      .select("id, name, email")
      .eq("role", "student")
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      students,
    });
  } catch (error) {
    console.error("Get students error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
