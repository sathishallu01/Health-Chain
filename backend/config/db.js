
const mongoose = require("mongoose");

async function connectDB() {
  try {
    await mongoose.connect(
      process.env.MONGO_URI ||
        "mongodb://127.0.0.1:27017/patient_health_records"
    );

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

module.exports = connectDB;
