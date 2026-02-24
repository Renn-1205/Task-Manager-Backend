import bcrypt from "bcryptjs";
import supabase from "../config/db.js";

// ─── GET ALL USERS (with search, filter, pagination) ─────────
export const getAllUsers = async (req, res) => {
  try {
    const {
      search = "",
      role = "",
      status = "",
      page = 1,
      limit = 10,
      sort_by = "created_at",
      sort_order = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Build the query
    let query = supabase
      .from("users")
      .select("id, name, email, role, is_verified, last_login, created_at, updated_at", { count: "exact" });

    // Search filter (name or email)
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Role filter
    if (role && ["student", "teacher", "admin"].includes(role)) {
      query = query.eq("role", role);
    }

    // Status filter (active = logged in within last 30 days, offline = not)
    if (status === "active") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("last_login", thirtyDaysAgo);
    } else if (status === "offline") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.or(`last_login.is.null,last_login.lt.${thirtyDaysAgo}`);
    }

    // Sorting
    const validSortFields = ["created_at", "name", "email", "role", "last_login"];
    const sortField = validSortFields.includes(sort_by) ? sort_by : "created_at";
    const ascending = sort_order === "asc";
    query = query.order(sortField, { ascending });

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: users, error, count } = await query;

    if (error) {
      console.error("Get users error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch users" });
    }

    // Map users to include computed status
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const mappedUsers = (users || []).map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: user.is_verified,
      status: user.last_login && user.last_login >= thirtyDaysAgo ? "active" : "offline",
      lastLogin: user.last_login,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    }));

    return res.status(200).json({
      success: true,
      users: mappedUsers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error("Get all users error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── GET USER BY ID ──────────────────────────────────────────
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, is_verified, last_login, created_at, updated_at")
      .eq("id", id)
      .single();

    if (error || !user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        status: user.last_login && user.last_login >= thirtyDaysAgo ? "active" : "offline",
        lastLogin: user.last_login,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (error) {
    console.error("Get user by ID error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── CREATE USER (Admin) ────────────────────────────────────
export const createUser = async (req, res) => {
  try {
    const { name, email, password, role = "student" } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email, and password are required" });
    }

    if (!["student", "teacher", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    // Check existing
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists with this email" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        name,
        email,
        password: hashedPassword,
        role,
        is_verified: true, // Admin-created users are auto-verified
      })
      .select("id, name, email, role, is_verified, created_at")
      .single();

    if (error) {
      console.error("Create user error:", error);
      return res.status(500).json({ success: false, message: "Failed to create user" });
    }

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        isVerified: newUser.is_verified,
        status: "offline",
        createdAt: newUser.created_at,
      },
    });
  } catch (error) {
    console.error("Create user error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── UPDATE USER (Admin) ────────────────────────────────────
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, password } = req.body;

    // Don't allow admin to modify their own role
    if (id === req.user.id && role && role !== req.user.role) {
      return res.status(400).json({ success: false, message: "You cannot change your own role" });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (role && ["student", "teacher", "admin"].includes(role)) updateData.role = role;

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
      }
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    // Check if email already exists (if changing email)
    if (email) {
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .neq("id", id)
        .single();

      if (existingUser) {
        return res.status(400).json({ success: false, message: "Email already in use by another user" });
      }
    }

    const { data: updatedUser, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select("id, name, email, role, is_verified, last_login, created_at, updated_at")
      .single();

    if (error || !updatedUser) {
      return res.status(404).json({ success: false, message: "User not found or update failed" });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isVerified: updatedUser.is_verified,
        status: updatedUser.last_login && updatedUser.last_login >= thirtyDaysAgo ? "active" : "offline",
        lastLogin: updatedUser.last_login,
        createdAt: updatedUser.created_at,
        updatedAt: updatedUser.updated_at,
      },
    });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── DELETE USER (Admin) ─────────────────────────────────────
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Don't allow admin to delete themselves
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account" });
    }

    const { error } = await supabase.from("users").delete().eq("id", id);

    if (error) {
      console.error("Delete user error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete user" });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── CHANGE USER ROLE ────────────────────────────────────────
export const changeUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !["student", "teacher", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role. Must be student, teacher, or admin" });
    }

    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: "You cannot change your own role" });
    }

    const { data: updatedUser, error } = await supabase
      .from("users")
      .update({ role })
      .eq("id", id)
      .select("id, name, email, role")
      .single();

    if (error || !updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: `User role changed to ${role}`,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Change role error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── GET ADMIN STATS ─────────────────────────────────────────
export const getAdminStats = async (req, res) => {
  try {
    // Total users
    const { count: totalUsers } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true });

    // Total students
    const { count: totalStudents } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "student");

    // Active students (logged in within 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: activeStudents } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "student")
      .gte("last_login", thirtyDaysAgo);

    // Instructors (teachers)
    const { count: instructors } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "teacher");

    // Admins
    const { count: admins } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    // Task completion rate
    const { count: totalTasks } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true });

    const { count: completedTasks } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed");

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // New users this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { count: newUsersThisMonth } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfMonth.toISOString());

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers: totalUsers || 0,
        totalStudents: totalStudents || 0,
        activeStudents: activeStudents || 0,
        instructors: instructors || 0,
        admins: admins || 0,
        completionRate,
        totalTasks: totalTasks || 0,
        completedTasks: completedTasks || 0,
        newUsersThisMonth: newUsersThisMonth || 0,
      },
    });
  } catch (error) {
    console.error("Get admin stats error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
