import { Router } from "express";
import authRoutes from "./auth.route.js";
import userRoutes from "./user.route.js";
import resumeRoutes from "./resume.route.js";
import questionRoutes from "./question.route.js";
import mockTestRoutes from "./mockTest.route.js";
import interviewRoutes from "./interview.route.js";
import analyticsRoutes from "./analytics.route.js";
import dashboardRoutes from "./dashboard.route.js";
import debugRoutes from "./debug.route.js"; // ← DEBUG: remove when done

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/resume", resumeRoutes);
router.use("/questions", questionRoutes);
router.use("/mock-tests", mockTestRoutes);
router.use("/interview", interviewRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/dashboard", dashboardRoutes);
if (process.env.NODE_ENV !== "production") router.use("/debug", debugRoutes); // ← DEBUG: remove when done

export default router;
