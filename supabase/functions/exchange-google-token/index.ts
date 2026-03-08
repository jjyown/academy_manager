import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ExchangeTokenRequest {
  code: string;
  teacherId: string;
  redirectUri: string;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error(
        "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set in Edge Function secrets"
      );
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
    }

    const { code, teacherId, redirectUri }: ExchangeTokenRequest =
      await req.json();

    if (!code || !teacherId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: code, teacherId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri || "postmessage",
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.error) {
      console.error("Google token exchange error:", tokenData);
      return new Response(
        JSON.stringify({
          error: "Failed to exchange Google authorization code",
          details: tokenData.error_description || tokenData.error,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { access_token, refresh_token } = tokenData;

    if (!refresh_token) {
      // This can happen if the user previously granted access.
      // In that case, we might only get an access_token.
      // We still save it and mark as connected if we got an access_token.
      console.warn(
        "No refresh_token received. User may need to revoke and re-authorize."
      );
    }

    // Verify the access token works with Google Drive
    const driveTestResponse = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    if (!driveTestResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API 접근에 실패했습니다. Drive API가 활성화되어 있는지 확인해주세요.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const driveInfo = await driveTestResponse.json();

    // Save refresh token to teachers table using service role (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const updateData: Record<string, unknown> = {
      google_drive_connected: true,
    };

    if (refresh_token) {
      updateData.google_drive_refresh_token = refresh_token;
    }

    const { error: dbError } = await supabase
      .from("teachers")
      .update(updateData)
      .eq("id", teacherId);

    if (dbError) {
      console.error("DB update error:", dbError);
      return new Response(
        JSON.stringify({
          error: "Failed to save Drive connection",
          details: dbError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        driveEmail: driveInfo.user?.emailAddress,
        hasRefreshToken: !!refresh_token,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
