const express = require("express");
const { createUser, listUsers, deleteUser } = require("../controllers/userController");
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/create", authMiddleware, adminMiddleware, createUser);
router.get("/", authMiddleware, adminMiddleware, listUsers);
router.delete("/:id", authMiddleware, adminMiddleware, deleteUser);

module.exports = router;


