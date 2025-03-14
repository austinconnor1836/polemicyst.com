import { NextRequest } from "next/server";
import axios from "axios";
import FormData from "form-data";

export const config = {
  api: {
    bodyParser: false, // Disable default body parsing
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

    // Step 1: Fetch the Page Access Token
    const { data: pagesData } = await axios.get(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`
    );

    if (!pagesData?.data || pagesData.data.length === 0) {
      return new Response(JSON.stringify({ error: "No Facebook pages found for this user." }), { status: 400 });
    }

    // Use the first page's access token (or let user select from multiple pages)
    const page = pagesData.data[0];
    const pageId = page.id;
    const pageAccessToken = page.access_token; // Correct Page Access Token

    if (!pageId || !pageAccessToken) {
      return new Response(JSON.stringify({ error: "Failed to retrieve page access token" }), { status: 400 });
    }

    // Step 2: Convert Blob to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Step 3: Prepare the multipart/form-data payload
    const fbForm = new FormData();
    fbForm.append("description", description);
    fbForm.append("access_token", pageAccessToken); // Use Page Access Token
    fbForm.append("source", buffer, "video.mp4"); // Use 'source' for binary uploads

    // Step 4: Upload video to Facebook
    const response = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/videos`, fbForm, {
      headers: fbForm.getHeaders(),
    });

    return new Response(JSON.stringify({ videoId: response.data.id }), { status: 200 });
  } catch (error: any) {
    console.error("Error uploading video to Facebook:", error.response?.data || error.message);
    return new Response(JSON.stringify({ error: "Failed to upload video to Facebook" }), { status: 500 });
  }
}
