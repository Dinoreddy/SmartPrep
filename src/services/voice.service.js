import Groq, { toFile } from "groq-sdk";
import { createClient } from "@deepgram/sdk";
import { LiveInterview } from "../models/liveInterview.model.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

/**
 * Converts a Deepgram response ReadableStream into a Node.js Buffer.
 * @param {ReadableStream} stream
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Runs a single sentence through the Deepgram TTS API and emits
 * the resulting audio buffer + text back to the client socket.
 *
 * @param {string} sentence - The sentence to synthesize.
 * @param {import("socket.io").Socket} socket
 */
async function synthesizeAndEmit(sentence, socket) {
  const trimmed = sentence.trim();
  if (!trimmed) return;

  try {
    const response = await deepgram.speak.request(
      { text: trimmed },
      { model: "aura-asteria-en", encoding: "linear16", sample_rate: 16000 },
    );

    const stream = await response.getStream();
    if (!stream) {
      console.error("[TTS] Deepgram returned no stream for sentence:", trimmed);
      return;
    }

    const audioBuffer = await streamToBuffer(stream);

    socket.emit("ai_audio_chunk", {
      audio: audioBuffer,
      text: trimmed,
    });
  } catch (err) {
    console.error("[TTS] Failed to synthesize sentence:", trimmed, err);
  }
}

/**
 * Core STT → LLM → TTS pipeline.
 *
 * @param {string} interviewId - MongoDB ObjectId string of the LiveInterview doc.
 * @param {Buffer} audioBuffer - Raw audio bytes received from the client.
 * @param {import("socket.io").Socket} socket
 */
async function processAudioStream(interviewId, audioBuffer, socket) {
  // ── 1. STT: Whisper Turbo ────────────────────────────────────────────────
  const file = await toFile(audioBuffer, "audio.webm");

  const transcription = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3-turbo",
  });

  const userText = transcription.text?.trim();
  if (!userText) {
    console.warn("[STT] Empty transcription received, skipping.");
    return;
  }

  // ── 2. Emit transcript update (user turn) ────────────────────────────────
  socket.emit("transcript_update", { role: "user", content: userText });

  // ── 3. State management: fetch + append user message ────────────────────
  const interview = await LiveInterview.findById(interviewId);
  if (!interview) {
    console.error("[Voice] LiveInterview not found:", interviewId);
    return;
  }

  interview.transcript.push({ role: "user", content: userText });

  // ── 4. LLM streaming (Llama 3.3 70B) ────────────────────────────────────
  const llmStream = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: interview.transcript.map(({ role, content }) => ({
      role,
      content,
    })),
    stream: true,
  });

  // ── 5. Sentence buffering + TTS loop ────────────────────────────────────
  let currentSentence = "";
  let fullResponse = "";
  const ttsPromises = []; // collect all TTS calls to await them together

  for await (const chunk of llmStream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    currentSentence += delta;
    fullResponse += delta;

    // Flush complete sentences to TTS as soon as they're ready
    // Match on ". ", "? ", "! " to avoid splitting on decimal numbers
    const sentenceEndRegex = /[.?!]\s/;
    let matchIndex;

    while ((matchIndex = currentSentence.search(sentenceEndRegex)) !== -1) {
      // Include the punctuation character itself
      const completeSentence = currentSentence.slice(0, matchIndex + 1);
      currentSentence = currentSentence.slice(matchIndex + 2); // skip punct + space

      // Push the promise — don't await inline so LLM stream keeps reading,
      // but track it so we can wait for all TTS to finish before we return.
      ttsPromises.push(synthesizeAndEmit(completeSentence, socket));
    }
  }

  // Flush any trailing text that didn't end with punctuation + space
  if (currentSentence.trim()) {
    ttsPromises.push(synthesizeAndEmit(currentSentence, socket));
  }

  // Wait for ALL TTS synthesis to complete before committing + signalling done
  await Promise.all(ttsPromises);

  // ── 6. Commit complete AI response to MongoDB ────────────────────────────
  interview.transcript.push({ role: "assistant", content: fullResponse });
  await interview.save();

  // Let the client know the AI has finished its turn
  socket.emit("ai_turn_complete");
}

export const voiceService = { processAudioStream };
