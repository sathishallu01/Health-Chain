"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/authRoutes");
const recordRoutes = require("./routes/recordRoutes");
const accessRoutes = require("./routes/accessRoutes");
const connectDB = require("./config/db");
const authMiddleware = require("./middleware/authMiddleware");

const app = express();
const PORT = process.env.PORT || 5000;

// Basic security and request handling
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || "http://localhost:5173"
}));
app.use(express.json({ limit: "1mb" }));

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.RATE_LIMIT ? parseInt(process.env.RATE_LIMIT, 10) : (process.env.NODE_ENV === "test" ? 10000 : 100),
  skip: () => process.env.NODE_ENV === "test",
}));

// Route mounts
app.use("/api/auth", authRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/access", accessRoutes);

// Test route
app.get("/", (req, res) => {
  res.json({
    message: "Patient Health Record API is running",
    status: "success"
  });
});

// Health check route
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "patient-health-record-backend"
  });
});

app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: "Authentication successful!",
    user: req.user,
  });
});

const { seedDemoProviders } = require("./services/seedProviders");

async function startServer() {
  await connectDB();
  await seedDemoProviders().catch((err) =>
    console.warn("[Server] Seed demo providers warning:", err.message)
  );

  app.listen(PORT, () => {
    console.log(`Backend server running at http://localhost:${PORT}`);
  });
}

// Only start the server when run directly (not when required by tests)
if (require.main === module) {
  startServer();
}

module.exports = app;