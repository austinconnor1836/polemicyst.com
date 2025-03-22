// lib/openFacebookOAuth.ts
export function openFacebookOAuth({ redirectUri = "/clips-genie" } = {}) {
  const clientId = process.env.NEXT_PUBLIC_AUTH_FACEBOOK_ID;
  if (!clientId) {
    console.error("❌ Missing NEXT_PUBLIC_AUTH_FACEBOOK_ID");
    return;
  }

  const encodedRedirectUri = encodeURIComponent(
    `${window.location.origin}/api/auth/callback/facebook`
  );

  const scope = [
    "public_profile",
    "email",
    "pages_show_list",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
    "publish_video",
  ].join(",");

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodedRedirectUri}&response_type=code&scope=${scope}`;

  // ✅ Redirect to Facebook (may open native app on mobile)
  window.location.href = authUrl;
}
