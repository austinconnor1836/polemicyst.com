import { NextResponse } from "next/server";
import axios from "axios";
import FormData from "form-data";
import { TwitterApi } from "twitter-api-v2";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const description = formData.get("description") as string;
    const accessToken = formData.get("accessToken") as string;
    const accessSecret = formData.get("accessSecret") as string;

    if (!file || !description || !accessToken || !accessSecret) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    console.log("🐦 Uploading video to Twitter...");

    // Initialize Twitter API client
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_CONSUMER_KEY!,
      appSecret: process.env.TWITTER_CONSUMER_SECRET!,
      accessToken,
      accessSecret,
    });

    const rwClient = twitterClient.readWrite;

    // Convert File to Buffer
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Step 1: INITIATE MEDIA UPLOAD
    const mediaInit = await rwClient.v1.uploadMedia(fileBuffer, {
      type: "video/mp4",
      media_category: "tweet_video",
    });

    console.log("✅ Media uploaded to Twitter, Media ID:", mediaInit);

    // Step 2: POST TWEET WITH VIDEO
    const tweetResponse = await rwClient.v2.tweet({
      text: description,
      media: { media_ids: [mediaInit] },
    });

    console.log("✅ Tweet posted successfully:", tweetResponse.data);

    return NextResponse.json(
      {
        message: "Tweet posted successfully!",
        tweetUrl: `https://twitter.com/user/status/${tweetResponse.data.id}`,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("❌ Error posting to Twitter:", error.response?.data || error.message);
    return NextResponse.json({ error: "Failed to post video to Twitter" }, { status: 500 });
  }
}
