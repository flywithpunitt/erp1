const User = require("../models/User");

exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!["ADMIN", "MANAGER"].includes(role)) {
      return res.status(400).json({ message: "Role must be ADMIN or MANAGER" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const user = await User.create({ name, email, password, role });
    return res
      .status(201)
      .json({ message: `${role} created`, user: { id: user._id, name, email, role } });
  } catch (error) {
    return res.status(500).json({ message: "Unable to create user", error: error.message });
  }
};

exports.listUsers = async (_req, res) => {
  const users = await User.find().select("-password").sort({ createdAt: -1 });
  const formatted = users.map((user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  }));
  return res.status(200).json({ users: formatted });
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "MANAGER") {
      return res.status(403).json({ message: "Only manager accounts can be deleted" });
    }

    await User.deleteOne({ _id: id });

    return res.status(200).json({ message: "Manager deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete user", error: error.message });
  }
};

