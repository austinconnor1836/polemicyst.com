import { NextRequest } from "next/server";
import axios from "axios";
import AWS from "aws-sdk";

// AWS S3 Configuration
const S3_BUCKET = "clips-genie-uploads";
const S3_REGION = process.env.S3_REGION;
const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: "v4",
});

export const config = {
  api: {
    bodyParser: false, // Disable default body parsing for large files
  },
};

// Function to upload video to S3
async function uploadToS3(file: Blob, filename: string): Promise<{ url: string; key: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const uploadParams = {
    Bucket: S3_BUCKET,
    Key: filename,
    Body: buffer,
    ContentType: "video/mp4",
  };

  await s3.upload(uploadParams).promise();

  return {
    url: `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${filename}`,
    key: filename, // Store object key for deletion
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForInstagramMedia(creationId: string, accessToken: string) {
  let attempts = 0;
  const maxAttempts = 15; // Increase retries
  const waitTime = 5000; // Wait 5 seconds per attempt

  while (attempts < maxAttempts) {
    await delay(waitTime);
    attempts++;

    try {
      const response = await axios.get(
        `https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${accessToken}`
      );

      const status = response.data.status_code;
      console.log(`🔄 Instagram Media Status: ${status} (Attempt ${attempts}/${maxAttempts})`);

      if (status === "FINISHED") {
        return true;
      }
    } catch (error: any) {
      console.error("⚠️ Error checking Instagram media status:", error.response?.data || error.message);
    }
  }

  return false; // Media never became ready
}

export async function POST(req: NextRequest) {
  let s3ObjectKey = ""; // Declare S3 object key

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

    // Step 2: Get Instagram Business Account ID
    const { data: instaData } = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );

    const instagramAccountId = instaData.instagram_business_account?.id;
    if (!instagramAccountId) {
      return new Response(JSON.stringify({ error: "No Instagram Business Account linked to this page." }), { status: 400 });
    }

    // Step 3: Upload Video to AWS S3 for Instagram
    console.log("📤 Uploading to AWS S3 for Instagram...");
    const filename = `uploads/${Date.now()}-video.mp4`;
    const { url: s3VideoUrl, key: objectKey } = await uploadToS3(file, filename);
    s3ObjectKey = objectKey; // Store object key for deletion
    console.log("✅ S3 Upload Successful:", s3VideoUrl);

    // Step 4: Upload to Instagram using S3 Public URL
    const igUploadResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media`,
      {
        media_type: "REELS",
        video_url: s3VideoUrl, // ✅ Use S3 public URL
        caption: description,
        access_token: pageAccessToken,
      }
    );

    const creationId = igUploadResponse.data.id;
    console.log("📤 Instagram upload started, waiting for processing...");

    // Step 5: Wait for Instagram media to be ready
    const isReady = await waitForInstagramMedia(creationId, pageAccessToken);
    if (!isReady) {
      return new Response(JSON.stringify({ error: "Instagram media processing took too long." }), { status: 500 });
    }

    // Step 6: Publish the Instagram video
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`,
      {
        creation_id: creationId,
        access_token: pageAccessToken,
      }
    );

    console.log("✅ Instagram upload successful:", publishResponse.data.id);

    // Step 7: Delete the video from S3
    if (s3ObjectKey) {
      console.log("🗑️ Deleting video from S3...");
      await deleteFromS3(s3ObjectKey);
      console.log("✅ S3 Video Deleted:", s3ObjectKey);
    }

    return new Response(
      JSON.stringify({
        instagramPostId: publishResponse.data.id,
      }),
      { status: 200 }
    );

  } catch (error: any) {
    console.error("Error uploading video:", error.response?.data || error.message);
    return new Response(JSON.stringify({ error: "Failed to upload video" }), { status: 500 });
  }
}

// Function to delete video from AWS S3 using `aws-sdk`
async function deleteFromS3(objectKey: string) {
  const deleteParams = {
    Bucket: S3_BUCKET,
    Key: objectKey,
  };

  await s3.deleteObject(deleteParams).promise();
}
