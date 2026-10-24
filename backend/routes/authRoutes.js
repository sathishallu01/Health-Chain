const express = require("express");
const { register, registerDoctor, login } = require("../controllers/authController");

const router = express.Router();

router.post("/register", register);
router.post("/register-doctor", registerDoctor);
router.post("/login", login);

module.exports = router;
