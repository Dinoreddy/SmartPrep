import { Router } from "express";
import { getQuestions } from "../controllers/question.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Protected route to fetch questions
// GET /api/v1/questions?topic=React&limit=5
router.get("/", verifyJWT, getQuestions);

export default router;
