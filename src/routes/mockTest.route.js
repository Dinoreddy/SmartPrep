import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  getConfig,
  startTest,
  submitTest,
} from "../controllers/mockTest.controller.js";

const router = Router();

router.use(verifyJWT);

router.get("/config", getConfig);
router.post("/start", startTest);
router.post("/:testId/submit", submitTest);

export default router;
