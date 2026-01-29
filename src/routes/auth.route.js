import { Router } from "express";

import { register, login, logout } from "../controllers/auth.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  registerValidator,
  loginValidator,
} from "../validators/auth.validator.js";

const router = Router();

router.post("/register", registerValidator, register);
router.post("/login", loginValidator, login);
router.post("/logout", verifyJWT, logout);

export default router;

