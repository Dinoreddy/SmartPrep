import { Router } from "express";
import authRoutes from "./auth.route.js";
import userRoutes from "./user.route.js";
import resumeRoutes from "./resume.route.js";
import questionRoutes from "./question.route.js";
import mockTestRoutes from "./mockTest.route.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/resume", resumeRoutes);
router.use("/questions", questionRoutes);
router.use("/mock-tests", mockTestRoutes);

export default router;
