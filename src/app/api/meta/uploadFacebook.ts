import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { pageId, accessToken, videoUrl, caption } = req.body;

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/videos`,
      {
        file_url: videoUrl,
        description: caption,
        access_token: accessToken,
      }
    );

    res.status(200).json({ videoId: response.data.id });
  } catch (error) {
    console.error("Error uploading video to Facebook:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to upload video to Facebook" });
  }
}
