import { NextRequest } from "next/server";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Define a dedicated temp folder inside Next.js app
const TEMP_DIR = path.join(process.cwd(), "tmp");

// ✅ Ensure the temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ✅ Function to Extract & Compress Audio from Video
async function extractAndCompressAudio(videoBuffer: Uint8Array): Promise<string> {
  const tempInputPath = path.join(TEMP_DIR, `${randomUUID()}.mp4`);
  const tempOutputPath = path.join(TEMP_DIR, `${randomUUID()}.mp3`);

  // 🔥 Save video to a temp file
  fs.writeFileSync(tempInputPath, videoBuffer);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", tempInputPath, // Input video file
      "-vn",               // Remove video stream
      "-ac", "1",          // Convert to mono
      "-ar", "16000",      // Reduce sample rate (16kHz)
      "-b:a", "64k",       // Lower bitrate (64kbps)
      "-f", "mp3",         // Output format
      tempOutputPath,
    ]);

    ffmpeg.on("exit", (code) => {
      fs.unlinkSync(tempInputPath); // ✅ Delete temp video after conversion
      if (code === 0) {
        resolve(tempOutputPath);
      } else {
        reject(new Error("FFmpeg failed to extract audio"));
      }
    });
  });
}

// ✅ Function to Generate AI-Based Description
async function generateDescription(transcript: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: "Summarize the following transcript into an engaging social media post:" },
      { role: "user", content: transcript }
    ],
    max_tokens: 100,
  });

  // Ensure response contains valid data
  const aiGeneratedText = response.choices?.[0]?.message?.content?.trim();
  
  return aiGeneratedText || "No description generated.";
}


// ✅ API Handler
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as Blob | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "Missing video file" }), { status: 400 });
    }

    console.log("🎥 Processing video...");

    // ✅ Convert Blob to Uint8Array
    const arrayBuffer = await file.arrayBuffer();
    const videoBuffer = new Uint8Array(arrayBuffer);

    // ✅ Extract & compress audio using ffmpeg
    console.log("🎵 Extracting & compressing audio...");
    const compressedAudioPath = await extractAndCompressAudio(videoBuffer);

    // ✅ Ensure readable stream for OpenAI API
    const compressedAudioStream = fs.createReadStream(compressedAudioPath);

    // ✅ Transcribe using Whisper
    console.log("📝 Transcribing audio...");
    const transcriptionResponse = await openai.audio.transcriptions.create({
      file: compressedAudioStream,
      model: "whisper-1",
      language: "en",
    });

    const transcript = transcriptionResponse.text;
    console.log("📄 Transcript:", transcript);

    // ✅ Generate AI description
    console.log("🤖 Generating description...");
    const description = await generateDescription(transcript);
    console.log("📢 AI-Generated Description:", description);

    // ✅ Cleanup temp files
    fs.unlinkSync(compressedAudioPath);

    return new Response(
      JSON.stringify({ transcript, generatedDescription: description }),
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error generating description:", error.message);
    return new Response(JSON.stringify({ error: "Failed to generate description" }), { status: 500 });
  }
}
