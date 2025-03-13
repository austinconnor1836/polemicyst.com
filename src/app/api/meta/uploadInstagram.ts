import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { instagramAccountId, accessToken, videoUrl, caption } = req.body;

  try {
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

    res.status(200).json({ postId: publishResponse.data.id });
  } catch (error) {
    console.error("Error uploading video to Instagram:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to upload video to Instagram" });
  }
}
