import { Router } from "express";
import authRoutes from "./auth.route.js";
import userRoutes from "./user.route.js";
import resumeRoutes from "./resume.route.js";
import questionRoutes from "./question.route.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/resume", resumeRoutes);
router.use("/questions", questionRoutes);

export default router;