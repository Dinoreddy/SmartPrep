import { Router } from "express";
import {
  uploadResume,
  updateResume,
  getResume,
  manuallyUpdateProfile,
} from "../controllers/resume.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

// This route requires Login AND a File
router.post(
  "/analyze",
  verifyJWT, // 1. Must be logged in
  upload.single("resume"), // 2. Must upload file named "resume"
  uploadResume, // 3. Run controller
);

router.put(
  "/analyze",
  verifyJWT, // 1. Must be logged in
  upload.single("resume"), // 2. Must upload file named "resume"
  updateResume, // 3. Run controller
);

router.get("/", verifyJWT, getResume);
router.patch("/profile", verifyJWT, manuallyUpdateProfile);

export default router;
