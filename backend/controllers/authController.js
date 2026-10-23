
const User = require("../models/user");
const jwt = require("jsonwebtoken");

function generateToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    }
  );
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email, and password are required.",
      });
    }

    if (typeof name !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string") {
      return res.status(400).json({
        message: "Name, email, and password must be text.",
      });
    }

    if (name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({
        message: "Name must contain between 2 and 100 characters.",
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must contain at least 8 characters.",
      });
    }

    // Public registration can create patient accounts only.
    // Other roles must be provisioned through a trusted admin workflow.
    if (role && role !== "patient") {
      return res.status(403).json({
        message: "Public registration is available for patients only.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: "patient",
    });

    const token = generateToken(user);

    return res.status(201).json({
      message: "Patient account created successfully.",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      message: "Unable to register account.",
    });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+password");

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        message: "This account is disabled.",
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      message: "Login successful.",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Unable to log in.",
    });
  }
}

module.exports = { register, login };
