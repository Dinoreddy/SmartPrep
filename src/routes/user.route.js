import { Router } from "express";

import { getCurrentUser, getAllUsers } from "../controllers/user.controller.js";
import { verifyJWT, authorizeRoles } from "../middlewares/auth.middleware.js";

const router = Router();

// Protected route: current user profile
router.get("/profile", verifyJWT, getCurrentUser);

// Admin-only: get all users
router.get("/all", verifyJWT, authorizeRoles("admin"), getAllUsers);

export default router;

