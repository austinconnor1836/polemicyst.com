// /src/app/api/generateDescription/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/src/lib/prisma";

export async function POST(req: NextRequest) {
  const { videoId } = await req.json();

  if (!videoId) {
    return new Response("Missing videoId", { status: 400 });
  }

  if (!videoId) {
    return new Response("Missing file or videoId", { status: 400 });
  }

  try {
    // ✅ Get video + transcript directly from Prisma
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        transcript: true,
        user: {
          select: {
            templatePreferences: {
              select: {
                sharedPostscript: true
              }
            }
          }
        }
      }
    });

    if (!video || !video.transcript) {
      return new Response("Transcript not found for video", { status: 404 });
    }

    // ✅ Send transcript to backend generation endpoint
    const generateRes = await fetch("http://localhost:3001/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: video.transcript }),
    });

    if (!generateRes.ok) {
      const errorText = await generateRes.text();
      console.error("Generation failed:", errorText);
      return new Response("Failed to generate metadata", { status: 500 });
    }

    const parsed = await generateRes.json();
    const { title, description } = parsed;

    const fixedHashtags = [
      "#Polemicyst", "#news", "#politics", "#youtube", "#trump",
      "#left", "#progressive", "#viral", "#maga",
    ];
    const allHashtags = [...fixedHashtags];
    const hashtagsString = allHashtags.join(", ");

    const postscript = video.user?.templatePreferences?.sharedPostscript ?? "";
    const patreonLink = "\n\nSupport me on Patreon: https://www.patreon.com/c/Polemicyst";
    const fullDescription = `${description}\n\n${hashtagsString}\n${postscript}${patreonLink}`;
    const shortTemplate = `${description} ${hashtagsString}`.substring(0, 300).trim();

    // 4. Update the video with the generated data
    const updated = await prisma.video.update({
      where: { id: videoId },
      data: {
        videoTitle: title || "Generated title",
        sharedDescription: fullDescription,
        blueskyTemplate: shortTemplate,
        twitterTemplate: shortTemplate,
      },
    });

    return Response.json(updated);
  } catch (err) {
    console.error("Error generating description:", err);
    return new Response("Failed to generate description", { status: 500 });
  }
}
