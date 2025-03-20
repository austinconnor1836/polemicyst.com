import { NextRequest } from "next/server";
import axios from "axios";
import FormData from "form-data";

export const config = {
  api: {
    bodyParser: false, // Disable default body parsing for large files
  },
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as Blob | null;
    const description = formData.get("description") as string;
    const userAccessToken = formData.get("accessToken") as string;

    if (!file || !description || !userAccessToken) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // Step 1: Get Facebook Page & Access Token
    const { data: pagesData } = await axios.get(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`
    );

    if (!pagesData?.data || pagesData.data.length === 0) {
      return new Response(JSON.stringify({ error: "No Facebook pages found for this user." }), { status: 400 });
    }

    const page = pagesData.data[0];
    const pageId = page.id;
    const pageAccessToken = page.access_token;

    // Step 3: Convert Blob to Buffer for Facebook Upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Step 4: Upload video to Facebook (returns video ID)
    const fbForm = new FormData();
    fbForm.append("description", description);
    fbForm.append("access_token", pageAccessToken);
    fbForm.append("source", buffer, "video.mp4");

    const fbUploadResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/videos`,
      fbForm,
      { headers: fbForm.getHeaders() }
    );

    const facebookVideoId = fbUploadResponse.data.id;
    const facebookVideoUrl = `https://www.facebook.com/${pageId}/videos/${facebookVideoId}`;

    console.log("✅ Facebook upload successful:", facebookVideoUrl);

    return new Response(
      JSON.stringify({
        facebookVideoId,
      }),
      { status: 200 }
    );

  } catch (error: any) {
    console.error("Error uploading video:", error.response?.data || error.message);
    return new Response(JSON.stringify({ error: "Failed to upload video" }), { status: 500 });
  }
}