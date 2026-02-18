import { Router } from "express";
import {
  getQuestions,
  submitAnswer,
} from "../controllers/question.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// GET /api/v1/questions?topic=React&limit=5
router.get("/", verifyJWT, getQuestions);

// POST /api/v1/questions/submit
router.post("/submit", verifyJWT, submitAnswer);

export default router;
