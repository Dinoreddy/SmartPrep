/**
 * ============================================================
 *  DEBUG ROUTER — development only
 *  Mount point: /api/v1/debug
 *
 *  TO REMOVE: delete this file + the two lines in index.js
 *  that import and mount it.
 * ============================================================
 */

import { Router } from "express";
import multer from "multer";
import { voiceService } from "../services/voice.service.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// In-memory storage: no files written to disk, nothing to clean up
const memUpload = multer({ storage: multer.memoryStorage() });

// ── Mock Socket ────────────────────────────────────────────────────────────
// Mimics the subset of socket.io's Socket API that voice.service.js uses.
// All emitted events are collected into an array and returned in the response.
function createMockSocket() {
  const events = [];

  return {
    events, // expose for reading in the route handler
    emit(eventName, payload) {
      events.push({ event: eventName, payload });
    },
  };
}

// ── POST /api/v1/debug/process-audio ─────────────────────────────────────
// Accepts:
//   - interviewId  (form field, string)
//   - audio        (file field, .webm / any audio format)
//
// Returns the list of socket events that would have been emitted to the
// real client, letting you inspect transcript + AI chunks in Postman.
router.post(
  "/process-audio",
  verifyJWT,
  memUpload.single("audio"),
  async (req, res) => {
    try {
      const { interviewId } = req.body;

      if (!interviewId) {
        return res
          .status(400)
          .json({ success: false, message: "interviewId is required" });
      }

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "audio file is required" });
      }

      const mockSocket = createMockSocket();

      // Run the full STT → LLM → TTS pipeline
      await voiceService.processAudioStream(
        interviewId,
        req.file.buffer, // Buffer from memoryStorage
        mockSocket,
      );

      return res.status(200).json({
        success: true,
        message: "Pipeline executed successfully",
        // All socket events the real client would have received
        emittedEvents: mockSocket.events,
      });
    } catch (err) {
      console.error("[Debug] process-audio error:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Internal error",
      });
    }
  },
);

export default router;
