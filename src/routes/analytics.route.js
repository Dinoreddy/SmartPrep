import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { getChartData } from "../controllers/analytics.controller.js";

const router = Router();

router.use(verifyJWT);

router.get("/charts", getChartData);

export default router;
