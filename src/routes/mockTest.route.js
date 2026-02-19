import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { getConfig, startTest } from "../controllers/mockTest.controller.js";

const router = Router();

router.use(verifyJWT);

router.get("/config", getConfig);
router.post("/start", startTest);

export default router;
