import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  getConfig,
  startTest,
  getTestById,
  submitTest,
  getMockTestStats,
} from "../controllers/mockTest.controller.js";

const router = Router();

router.use(verifyJWT);

router.get("/config", getConfig);
router.get("/stats", getMockTestStats);
router.post("/start", startTest);
router.get("/:testId", getTestById);
router.post("/:testId/submit", submitTest);

export default router;
