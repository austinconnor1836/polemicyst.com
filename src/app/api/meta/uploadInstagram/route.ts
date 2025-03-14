import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export async function POST(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { instagramAccountId, accessToken, videoUrl, caption } = req.body;

    if (!instagramAccountId || !accessToken || !videoUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Step 1: Upload video to Instagram
    const uploadResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media`,
      {
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        access_token: accessToken,
      }
    );

    // Step 2: Publish the video
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`,
      {
        creation_id: uploadResponse.data.id,
        access_token: accessToken,
      }
    );

    return res.status(200).json({ postId: publishResponse.data.id });
  } catch (error: any) {
    console.error("Error uploading video to Instagram:", error.response?.data || error.message);
    return res.status(500).json({ error: "Failed to upload video to Instagram" });
  }
}

// Only allow POST requests
export async function GET(req: NextApiRequest, res: NextApiResponse) {
  return res.status(405).json({ error: "Method Not Allowed" });
}

export async function PUT(req: NextApiRequest, res: NextApiResponse) {
  return res.status(405).json({ error: "Method Not Allowed" });
}

export async function DELETE(req: NextApiRequest, res: NextApiResponse) {
  return res.status(405).json({ error: "Method Not Allowed" });
}
