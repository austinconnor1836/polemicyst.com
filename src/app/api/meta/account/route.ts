import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accessToken } = body;

    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token" }, { status: 400 });
    }

    // Get the user's Facebook account details
    const { data } = await axios.get(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
    );

    // Find a valid Facebook Page that the user manages
    const page = data.data.find((account: any) => account.id);
    if (!page) {
      return NextResponse.json({ error: "No Facebook page found" }, { status: 400 });
    }

    // Get Instagram business account ID (if linked)
    const instaResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
    );

    return NextResponse.json({
      pageId: page.id,
      instagramAccountId: instaResponse.data.instagram_business_account?.id || null,
    });
  } catch (error) {
    console.error("Error fetching Facebook account info:", error.response?.data || error.message);
    return NextResponse.json({ error: "Failed to retrieve account details" }, { status: 500 });
  }
}
