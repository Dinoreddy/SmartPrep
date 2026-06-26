import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  getDashboardFocus,
  getDashboardStats,
  getRecentSessions,
  getAudioDashboardStats,
} from "../controllers/dashboard.controller.js";

const router = Router();

// All dashboard routes are protected by JWT authentication
router.use(verifyJWT);

router.get("/focus", getDashboardFocus);
router.get("/stats", getDashboardStats);
router.get("/recent-sessions", getRecentSessions);
router.get("/audio-stats", getAudioDashboardStats);

export default router;
