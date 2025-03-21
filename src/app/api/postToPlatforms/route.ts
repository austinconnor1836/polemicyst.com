import { NextResponse } from "next/server";
import axios from "axios";
import FormData from "form-data";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const platforms = JSON.parse(formData.get("platforms") as string);
    const descriptions = JSON.parse(formData.get("descriptions") as string);
    const session = JSON.parse(formData.get("session") as string);
    const file = formData.get("file") as Blob;
    let videoUrl = null;

    if (!platforms || platforms.length === 0) {
      return NextResponse.json({ message: "No platforms selected" }, { status: 400 });
    }

    console.log("📤 Platforms selected:", platforms);

    const endpointMap: Record<string, string> = {
      bluesky: "/api/bluesky/post",
      facebook: "/api/meta/facebook/upload",
      instagram: "/api/meta/instagram/upload",
      youtube: "/api/youtube/upload",
      twitter: "/api/twitter/post",
    };

    const results: any[] = [];

    // ✅ Upload to YouTube FIRST
    if (platforms.includes("google")) {
      try {
        const ytForm = new FormData();
        ytForm.append("file", file);
        ytForm.append("title", "Polemicyst Video Upload");
        ytForm.append("description", descriptions.youtube);
        ytForm.append("accessToken", session.accessToken);

        const ytRes = await axios.post(endpointMap.youtube, ytForm, {
          headers: ytForm.getHeaders?.() || { "Content-Type": "multipart/form-data" },
        });

        videoUrl = ytRes.data.youtubeLink;
        results.push({ platform: "youtube", success: true, response: ytRes.data });
      } catch (ytErr: any) {
        results.push({ platform: "youtube", success: false, error: ytErr.response?.data || ytErr.message });
        platforms.splice(platforms.indexOf("bluesky"), 1); // Remove Bluesky if YouTube fails
      }
    }

    const postPromises = platforms.filter(p => p !== "google").map(async (platform) => {
      if (!endpointMap[platform]) return { platform, success: false, error: "Unknown platform" };

      try {
        if (platform === "facebook" || platform === "instagram") {
          const metaForm = new FormData();
          metaForm.append("file", file);
          metaForm.append("description", descriptions[platform]);
          metaForm.append("accessToken", session.accessToken);

          const res = await axios.post(endpointMap[platform], metaForm, {
            headers: metaForm.getHeaders?.() || { "Content-Type": "multipart/form-data" },
          });

          return { platform, success: true, response: res.data };
        } else {
          const res = await axios.post(endpointMap[platform], {
            youtubeUrl: videoUrl,
            description: descriptions[platform],
            session,
          });

          return { platform, success: true, response: res.data };
        }
      } catch (err: any) {
        return { platform, success: false, error: err.response?.data || err.message };
      }
    });

    const postResults = await Promise.all(postPromises);
    results.push(...postResults);

    return NextResponse.json({ message: "Posting completed", results });
  } catch (error) {
    console.error("❌ Error in postToPlatforms:", error);
    return NextResponse.json({ message: "Error posting to platforms" }, { status: 500 });
  }
}
