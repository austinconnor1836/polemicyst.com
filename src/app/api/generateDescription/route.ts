// /src/app/api/generateDescription/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/src/lib/prisma";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const videoId = formData.get("videoId") as string;

  if (!file || !videoId) {
    return new Response("Missing file or videoId", { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const blob = new Blob([buffer], { type: file.type });

  const proxyFormData = new FormData();
  proxyFormData.set("file", blob, file.name);

  try {
    const backendRes = await fetch("http://localhost:3001/api/generate", {
      method: "POST",
      body: proxyFormData,
    });

    const raw = await backendRes.text();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

    const { title, description, hashtags } = parsed;

    const fixedHashtags = [
      "#Polemicyst", "#news", "#politics", "#youtube", "#trump",
      "#left", "#progressive", "#viral", "#maga"
    ];
    const allHashtags = [...fixedHashtags, ...hashtags];
    const hashtagsString = allHashtags.join(", ");
    const patreonLink = "\n\nSupport me on Patreon: https://www.patreon.com/c/Polemicyst";
    const fullDescription = `${description}\n\n${hashtagsString}${patreonLink}`;
    const shortTemplate = `${description} ${hashtagsString}`.substring(0, 300).trim();

    // Update the video in the DB
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
