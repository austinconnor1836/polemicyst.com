import { NextRequest } from "next/server";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

type Highlight = {
  text: string;
  start: number;
  end: number;
};

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

// ✅ Function to Generate AI-Based Description and Hashtags
async function generateDescriptionAndHashtags(transcript: string): Promise<{
  title: string;
  description: string;
  hashtags: string[];
}> {
  const [descResponse, hashtagResponse, titleResponse] = await Promise.all([
    openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Summarize the following transcript into an engaging social media post:" },
        { role: "user", content: transcript },
      ],
      max_tokens: 150,
    }),
    openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Generate five relevant hashtags based on this transcript. Return them as a comma-separated list." },
        { role: "user", content: transcript },
      ],
      max_tokens: 20,
    }),
    openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Generate a compelling, YouTube-style title for this video based on the transcript." },
        { role: "user", content: transcript },
      ],
      max_tokens: 20,
    }),
  ]);

  const description = descResponse.choices?.[0]?.message?.content?.trim() || "No description generated.";
  const hashtags = hashtagResponse.choices?.[0]?.message?.content?.trim().split(", ") || [];
  const title = titleResponse.choices?.[0]?.message?.content?.trim() || "Untitled";

  return { title, description, hashtags };
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
      response_format: "verbose_json", // 🆕 Use verbose to get word timestamps
    });

    const transcript = transcriptionResponse.text;
    const segments = transcriptionResponse.segments || []; // 🆕 Expect timestamps

    // ✅ Generate AI description
    console.log("🤖 Generating description...");
    const { description, hashtags, title } = await generateDescriptionAndHashtags(transcript);
    console.log("📢 AI-Generated Description:", description);

    // ✅ Generate highlights using OpenAI
    console.log("🎯 Extracting highlights...");

    // Chunk segments into blocks of 15–45s
    const candidates: Highlight[] = [];
    let tempText = '';
    let tempStart = segments[0]?.start ?? 0;

    const MAX_CLIP_LENGTH = 90; // seconds
    const MIN_CLIP_LENGTH = 15;

    for (const seg of segments) {
      tempText += seg.text + ' ';

      // if this chunk is now >= MIN_CLIP_LENGTH and <= MAX_CLIP_LENGTH
      const currentLength = seg.end - tempStart;

      if (currentLength >= MIN_CLIP_LENGTH) {
        if (currentLength > MAX_CLIP_LENGTH) {
          candidates.push({
            text: tempText.trim(),
            start: tempStart,
            end: tempStart + MAX_CLIP_LENGTH, // force trim
          });
          tempText = '';
          tempStart = seg.end;
        } else if (currentLength >= 30) {
          candidates.push({ text: tempText.trim(), start: tempStart, end: seg.end });
          tempText = '';
          tempStart = seg.end;
        }
      }
    }


    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          'You are an expert video editor. Choose the most engaging, emotional, or viral-worthy chunks of transcript from a video. Return the result wrapped in a markdown-style JSON code block.',
      },
      {
        role: 'user',
        content: `Here are the transcript chunks:\n\n${JSON.stringify(candidates, null, 2)}`,
      },
    ];

    const highlightResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
    });

    let highlights: Highlight[] = [];

    try {
      const raw = highlightResponse.choices[0]?.message?.content || '';

      // Extract JSON from inside ```json ... ```
      const match = raw.match(/```json\n([\s\S]*?)\n```/) || raw.match(/```([\s\S]*?)```/);

      const jsonString = match ? match[1] : raw; // fallback to raw if no fenced code

      highlights = JSON.parse(jsonString.trim());
    } catch (err) {
      console.error('❌ Failed to parse highlights JSON:', err);
      highlights = [];
    }

    // After getting 'highlights'
    const ratedHighlights = await Promise.all(
      highlights.map(async (highlight) => {
        try {
          const res = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: 'You are a short-form video editor. Rate the following clip on a scale from 0 to 100 across Hook, Flow, Value, and Trend. Return as JSON in markdown code block.',
              },
              {
                role: 'user',
                content: `Clip Transcript:\n"${highlight.text}"`,
              },
            ],
          });

          const raw = res.choices[0].message?.content || '';
          const match = raw.match(/```json\n([\s\S]*?)\n```/) || raw.match(/```([\s\S]*?)```/);
          const jsonString = match ? match[1] : raw;
          const rating = JSON.parse(jsonString.trim());

          return {
            ...highlight,
            score: rating.TotalScore || (
              (rating.Hook + rating.Flow + rating.Value + rating.Trend) / 4
            ),
            breakdown: rating,
          };
        } catch (err) {
          console.error('❌ Failed to rate highlight:', err);
          return { ...highlight, score: 0, breakdown: null };
        }
      })
    );

    // Sort descending
    ratedHighlights.sort((a, b) => b.score - a.score);



    // ✅ Cleanup temp files
    fs.unlinkSync(compressedAudioPath);

    return new Response(
      JSON.stringify({ transcript, description, hashtags, title, highlights: ratedHighlights }),
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error generating description:", error.message);
    return new Response(JSON.stringify({ error: "Failed to generate description" }), { status: 500 });
  }
}
