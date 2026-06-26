import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { startSession, getSessionReport } from "../controllers/interview.controller.js";

const router = Router();

// All interview routes require authentication
router.use(verifyJWT);

// POST /api/v1/interview/start
router.post("/start", startSession);

// GET /api/v1/interview/:interviewId/report
router.get("/:interviewId/report", getSessionReport);

export default router;
