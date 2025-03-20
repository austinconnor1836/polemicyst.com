import { NextResponse } from "next/server";
import axios from "axios";

export async function POST(req: Request) {
  try {
    const { platforms, descriptions, videoFile, videoUrl, session } = await req.json();

    if (!platforms || platforms.length === 0) {
      return NextResponse.json({ message: "No platforms selected" }, { status: 400 });
    }

    console.log("📤 Dispatching posts to platforms:", platforms);

    const postPromises = platforms.map(async (platform: string) => {
      const endpointMap: Record<string, string> = {
        bluesky: "/api/bluesky/post",
        facebook: "/api/meta/upload/facebook",
        instagram: "/api/meta/upload/instagram",
        youtube: "/api/youtube/upload",
        twitter: "/api/twitter/post",
      };

      if (!endpointMap[platform]) {
        console.warn(`❌ Unknown platform: ${platform}`);
        return { platform, success: false, error: "Unknown platform" };
      }

      try {
        let response;

        if (platform === "facebook" || platform === "instagram") {
          // ✅ Upload Blob for Facebook and Instagram
          const formData = new FormData();
          formData.append("file", videoFile); // Video file (Blob)
          formData.append("description", descriptions[platform]);
          formData.append("accessToken", session?.accessToken || "");

          response = await axios.post(endpointMap[platform], formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        } else {
          // ✅ Send YouTube URL for Bluesky, Twitter, YouTube
          response = await axios.post(endpointMap[platform], {
            youtubeUrl: videoUrl, // Video URL instead of file
            description: descriptions[platform],
            session,
          });
        }

        return { platform, success: true, response: response.data };
      } catch (error: any) {
        console.error(`❌ Error posting to ${platform}:`, error.response?.data || error.message);
        return { platform, success: false, error: error.response?.data || error.message };
      }
    });

    const results = await Promise.all(postPromises);

    return NextResponse.json({ message: "Posting completed", results });
  } catch (error) {
    console.error("❌ Error in postToPlatforms:", error);
    return NextResponse.json({ message: "Error posting to platforms" }, { status: 500 });
  }
}
