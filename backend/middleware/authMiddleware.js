
const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  // Check whether the Authorization header exists
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required. Please log in.",
    });
  }

  // Extract the token after "Bearer "
  const token = authHeader.split(" ")[1];

  try {
    // Verify the token using the secret from .env
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach the verified user's details to the request
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token. Please log in again.",
    });
  }
}

module.exports = authMiddleware;
