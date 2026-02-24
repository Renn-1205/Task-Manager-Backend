import supabase from "../config/db.js";
import crypto from "crypto";

// Helper: generate a short unique invite code
const generateInviteCode = () => crypto.randomBytes(4).toString("hex"); // 8-char hex

// ─── CREATE CLASS (Teacher only) ─────────────────────────────
export const createClass = async (req, res) => {
  try {
    const { name, description } = req.body;
    const teacherId = req.user.id;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Class name is required",
      });
    }

    // Generate a unique invite code
    let inviteCode = generateInviteCode();

    // Small chance of collision — retry once
    const { data: existing } = await supabase
      .from("classes")
      .select("id")
      .eq("invite_code", inviteCode)
      .maybeSingle();

    if (existing) inviteCode = generateInviteCode();

    const { data: newClass, error } = await supabase
      .from("classes")
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        invite_code: inviteCode,
        teacher_id: teacherId,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Create class DB error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create class",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Class created successfully",
      class: newClass,
    });
  } catch (error) {
    console.error("Create class error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// ─── GET TEACHER'S CLASSES ───────────────────────────────────
export const getClasses = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let query;
    if (role === "admin") {
      // Admin sees ALL classes in the system
      query = supabase
        .from("classes")
        .select("*")
        .order("created_at", { ascending: false });
    } else if (role === "teacher") {
      // Teacher sees classes they own
      query = supabase
        .from("classes")
        .select("*")
        .eq("teacher_id", userId)
        .order("created_at", { ascending: false });
    } else {
      // Student sees classes they belong to
      const { data: memberships, error: mErr } = await supabase
        .from("class_members")
        .select("class_id")
        .eq("user_id", userId);

      if (mErr) throw mErr;

      const classIds = (memberships || []).map((m) => m.class_id);
      if (classIds.length === 0) {
        return res
          .status(200)
          .json({ success: true, classes: [] });
      }

      query = supabase
        .from("classes")
        .select("*")
        .in("id", classIds)
        .order("created_at", { ascending: false });
    }

    const { data: classes, error } = await query;
    if (error) throw error;

    // Attach member count to each class
    const enriched = await Promise.all(
      (classes || []).map(async (cls) => {
        const { count } = await supabase
          .from("class_members")
          .select("id", { count: "exact", head: true })
          .eq("class_id", cls.id);
        return { ...cls, memberCount: count || 0 };
      })
    );

    return res.status(200).json({ success: true, classes: enriched });
  } catch (error) {
    console.error("Get classes error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// ─── GET SINGLE CLASS (with members) ─────────────────────────
export const getClass = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    const { data: cls, error } = await supabase
      .from("classes")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !cls) {
      return res
        .status(404)
        .json({ success: false, message: "Class not found" });
    }

    // Authorization
    if (role === "teacher" && cls.teacher_id !== userId) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden" });
    }
    // Admin can view any class

    if (role === "student") {
      const { data: membership } = await supabase
        .from("class_members")
        .select("id")
        .eq("class_id", id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!membership) {
        return res
          .status(403)
          .json({ success: false, message: "Forbidden — you are not a member of this class" });
      }
    }

    // Get members
    const { data: members } = await supabase
      .from("class_members")
      .select("user_id, joined_at, user:users(id, name, email, role)")
      .eq("class_id", id)
      .order("joined_at", { ascending: true });

    return res.status(200).json({
      success: true,
      class: { ...cls, members: members || [] },
    });
  } catch (error) {
    console.error("Get class error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// ─── UPDATE CLASS (Teacher only) ─────────────────────────────
export const updateClass = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: cls } = await supabase
      .from("classes")
      .select("id, teacher_id")
      .eq("id", id)
      .single();

    if (!cls) {
      return res
        .status(404)
        .json({ success: false, message: "Class not found" });
    }
    if (cls.teacher_id !== userId && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden" });
    }

    const { name, description } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    const { data: updated, error } = await supabase
      .from("classes")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: "Class updated",
      class: updated,
    });
  } catch (error) {
    console.error("Update class error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// ─── DELETE CLASS (Teacher only) ─────────────────────────────
export const deleteClass = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: cls } = await supabase
      .from("classes")
      .select("id, teacher_id")
      .eq("id", id)
      .single();

    if (!cls) {
      return res
        .status(404)
        .json({ success: false, message: "Class not found" });
    }
    if (cls.teacher_id !== userId && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden" });
    }

    // Also clear class_id on tasks that reference this class
    await supabase
      .from("tasks")
      .update({ class_id: null })
      .eq("class_id", id);

    const { error } = await supabase.from("classes").delete().eq("id", id);
    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: "Class deleted successfully",
    });
  } catch (error) {
    console.error("Delete class error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// ─── JOIN CLASS VIA INVITE CODE (Student) ────────────────────
export const joinClass = async (req, res) => {
  try {
    const { invite_code } = req.body;
    const userId = req.user.id;

    if (!invite_code) {
      return res
        .status(400)
        .json({ success: false, message: "Invite code is required" });
    }

    const { data: cls, error: clsError } = await supabase
      .from("classes")
      .select("id, name, teacher_id")
      .eq("invite_code", invite_code.trim())
      .single();

    if (clsError || !cls) {
      return res
        .status(404)
        .json({ success: false, message: "Invalid invite code" });
    }

    // Can't join your own class
    if (cls.teacher_id === userId) {
      return res
        .status(400)
        .json({ success: false, message: "You are the teacher of this class" });
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from("class_members")
      .select("id")
      .eq("class_id", cls.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "You are already a member of this class" });
    }

    const { error } = await supabase
      .from("class_members")
      .insert({ class_id: cls.id, user_id: userId });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: `Joined class "${cls.name}" successfully`,
      class: cls,
    });
  } catch (error) {
    console.error("Join class error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// ─── REMOVE MEMBER (Teacher kicks a student) ─────────────────
export const removeMember = async (req, res) => {
  try {
    const { id: classId, userId: memberId } = req.params;
    const teacherId = req.user.id;

    const { data: cls } = await supabase
      .from("classes")
      .select("id, teacher_id")
      .eq("id", classId)
      .single();

    if (!cls) {
      return res
        .status(404)
        .json({ success: false, message: "Class not found" });
    }
    if (cls.teacher_id !== teacherId && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden" });
    }

    const { error } = await supabase
      .from("class_members")
      .delete()
      .eq("class_id", classId)
      .eq("user_id", memberId);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: "Member removed from class",
    });
  } catch (error) {
    console.error("Remove member error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// ─── GET CLASS MEMBERS (for assignee dropdown within a class) ─
export const getClassMembers = async (req, res) => {
  try {
    const { id: classId } = req.params;

    const { data: members, error } = await supabase
      .from("class_members")
      .select("user:users(id, name, email)")
      .eq("class_id", classId)
      .order("joined_at", { ascending: true });

    if (error) throw error;

    const students = (members || []).map((m) => m.user);

    return res.status(200).json({ success: true, students });
  } catch (error) {
    console.error("Get class members error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
