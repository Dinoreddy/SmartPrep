import { Router } from "express";
import authRoutes from "./auth.route.js";
import userRoutes from "./user.route.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);

export default router;