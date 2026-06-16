# Real-Time Interview: Frontend Integration Guide

This guide is for the frontend agent implementing the Real-Time Voice Interview flow. The feature has two distinct phases:

1. **HTTP REST Initiation** (creates the session and fetches the initial AI audio greeting).
2. **Socket.io Live Loop** (real-time, bidirectional audio streaming).

---

## 1. Authentication Concept (Crucial)

The backend recently migrated to **httpOnly cookies** for JWT tokens.

- You **do not** need to manually attach a `Bearer` token in the `Authorization` header for fetch requests.
- You **do not** have access to the `accessToken` string in JavaScript.
- Instead, you MUST configure all HTTP requests and the Socket.io connection to send credentials (cookies) automatically.

For `fetch()`, use: `credentials: "include"`.
For Socket.io, use: `withCredentials: true`.

---

## 2. Phase 1: Session Initialization (HTTP)

To start an interview, make a `POST` request to the backend. This endpoint creates the conversation in the database, generates the AI's opening question based on the user's resume, and synthesizes that first text into audio.

**Endpoint:** `POST /api/v1/interview/start`

```javascript
// Example implementation:
const response = await fetch("http://localhost:3000/api/v1/interview/start", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include", // CRITICAL: sends the httpOnly JWT cookie
});

const json = await response.json();
/*
json.data expects:
{
  interviewId: "65f2...", // MongoDB ObjectId
  initialAudio: "<base64_string>", // PCM audio of the greeting
  initialMessage: "Hello! It is great to meet you...", // Text of the greeting
  encoding: "linear16",
  sampleRate: 16000
}
*/
const { interviewId, initialAudio, initialMessage, sampleRate } = json.data;
```

**What the frontend should do with this response:**

1. Save `interviewId` to state.
2. Display the `initialMessage` text in the chat transcript UI immediately as an AI message.
3. Immediately play the `initialAudio` (decode the base64 string to a Float32 or Uint8 array and play it via Web Audio API).
4. Open the Socket.io connection.

---

## 3. Phase 2: Socket.io Connection

Once you have the `interviewId` and the AI has finished speaking its greeting, connect to the Socket.io server.

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  withCredentials: true, // CRITICAL: sends the httpOnly JWT cookie
  transports: ["websocket"],
});

// 1. Join the specific interview room
socket.on("connect", () => {
  socket.emit("join_interview", interviewId);
});

// 2. Listen for User transcription (Live STT updates)
socket.on("transcript_update", (data) => {
  // data = { role: "user", content: "I think the architecture was..." }
  // Display this in the UI chat log.
});

// 3. Listen for AI Audio Chunks (LLM generation + TTS)
socket.on("ai_audio_chunk", (data) => {
  // data = { audio: <ArrayBuffer>, text: "That makes sense. " }
  // 1. Play the audio buffer (Linear16 PCM, 16000Hz).
  // 2. Append the `text` to the UI chat log dynamically (creates a typing effect).
});

// 4. Listen for AI Turn Completion
// The backend will emit this when the LLM has finished generating the full response
// AND all audio chunks have been sent.
socket.on("ai_turn_complete", () => {
  // The AI stopped speaking.
  // It is now safe to start recording the user again or enable the microphone button.
});

// 5. General Error Handling
socket.on("error", (err) => {
  console.error("Socket error from backend:", err.message);
  // e.g., "Unauthorized" or "Audio chunk too large"
});

// 6. Pipeline Busy Guard
socket.on("pipeline_busy", (data) => {
  // Fired if the user speaks while the AI is still processing the previous turn.
  // Display a toast: data.message
});
```

---

## 4. Phase 3: Sending User Audio

When it's the user's turn to speak, record their microphone.
The backend handles transcription (STT) via Groq's Whisper API. Whisper accepts compressed audio like WebM/Opus, which makes things very easy for the web frontend.

Using standard `MediaRecorder`:

```javascript
let mediaRecorder;
let audioChunks = [];

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    // Combine chunks into a single Blob
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Send to backend via Socket
    socket.emit("candidate_audio_chunk", {
      interviewId,
      audioBuffer: arrayBuffer,
    });

    // Clear chunks for the next turn
    audioChunks = [];
  };

  mediaRecorder.start();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}
```

---

## 5. Phase 4: Ending the Interview

When the user clicks "End Interview":

```javascript
socket.emit("end_interview", interviewId);

socket.on("interview_ended", (data) => {
  // data.message = "Interview wrapped up successfully"
  // Redirect the user to the feedback/report page.
});
```

---

## 6. How to Play Backend Audio (Linear16 PCM)

The most complex part of the frontend is playing the raw PCM audio returned by Deepgram (both the base64 initial greeting and the arrayBuffer socket chunks).

Deepgram returns raw 16-bit PCM audio at 16,000Hz (1 channel). The Web Audio API operates on 32-bit floats. You must convert it.

**Utility Function: Play PCM Audio (Base64 or ArrayBuffer)**

```javascript
const audioContext = new (window.AudioContext || window.webkitAudioContext)({
  sampleRate: 16000,
});

async function playPCMAudio(input) {
  let buffer;

  // If base64 (from the HTTP initialization)
  if (typeof input === "string") {
    const binaryString = atob(input);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    buffer = bytes.buffer;
  } else {
    // If ArrayBuffer (from the Socket.io ai_audio_chunk event)
    buffer = input;
  }

  // Deepgram returns 16-bit integers (Int16).
  // Web Audio Context requires Float32 (-1.0 to 1.0).
  const int16Array = new Int16Array(buffer);
  const audioBuffer = audioContext.createBuffer(1, int16Array.length, 16000);
  const float32Array = audioBuffer.getChannelData(0);

  // Convert Int16 to Float32
  for (let i = 0; i < int16Array.length; i++) {
    // 32768 is the max value of a 16-bit signed int
    float32Array[i] = int16Array[i] / 32768.0;
  }

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  source.start();

  // Return a promise that resolves when this specific chunk finishes playing
  return new Promise((resolve) => {
    source.onended = resolve;
  });
}
```

> **Crucial UX Note:** Because the AI generates text sentence-by-sentence, you will receive multiple `ai_audio_chunk` events in rapid succession. If you call `playPCMAudio` immediately for every event, they will all play overlapping at the same time.
>
> **You MUST implement a queue system.** Push audio buffers into an array when the socket receives them, and write a recursive/async loop to play them sequentially. Do not play chunk N+1 until chunk N's `onended` event fires.

---

## Summary of State Flow

1. **Idle:** Wait for user to click "Start".
2. **HTTP Init:** Call `/start`. Decode base64, play initial audio greeting.
3. **Connect:** Open socket, `emit("join_interview")`. Wait for greeting to finish playing.
4. **User Turn:** Start `MediaRecorder`. User speaks. Stop recorder.
5. **Processing:** Emit `candidate_audio_chunk`. Wait.
6. **STT Arrives:** Receive `transcript_update`. Show user's text in UI.
7. **AI Speaks:** Receive multiple `ai_audio_chunk` events sequentially. Queue and play them one by one. Append the `text` field to the UI dynamically.
8. **AI Done:** Receive `ai_turn_complete`. Go back to step 4.
