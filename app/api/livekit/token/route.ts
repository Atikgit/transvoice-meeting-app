import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room") || "quick-sync";
  const username = req.nextUrl.searchParams.get("username") || "Guest";
  const userId = req.nextUrl.searchParams.get("userId");

  // হোস্টের ক্ষেত্রে মিনিট ব্যালেন্স চেক করা
  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("minutes_balance")
      .eq("id", userId)
      .single();

    if (!profile || profile.minutes_balance <= 0) {
      return NextResponse.json(
        { error: "Insufficient balance. Please upgrade your plan." },
        { status: 402 }
      );
    }
  }

  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;

  const at = new AccessToken(apiKey, apiSecret, { identity: username });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });

  return NextResponse.json({ token: await at.toJwt() });
}