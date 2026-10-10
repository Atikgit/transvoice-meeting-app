import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { audio, tgt_lang, src_lang, azure_voice, userId, audioDurationSeconds } = await req.json();

    // ১. হোস্টের মিনিট ব্যালেন্স যাচাই
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("minutes_balance")
        .eq("id", userId)
        .single();

      if (!profile || profile.minutes_balance <= 0) {
        return NextResponse.json(
          { error: "Minute balance exhausted", code: "OUT_OF_MINUTES" },
          { status: 402 }
        );
      }
    }

    // ২. আপনার Azure Triton সার্ভারে কল (Deepgram-এর মতো মাস্টার API Key ব্যবহার)
    const azureUrl = process.env.TRANSVOICE_API_URL!;
    const masterApiKey = process.env.TRANSVOICE_MASTER_API_KEY!;

    const response = await fetch(`${azureUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${masterApiKey}` // যেমন: tv_live_master_secret
      },
      body: JSON.stringify({
        audio,
        tgt_lang: tgt_lang || "bn",
        src_lang: src_lang || "auto",
        azure_voice: azure_voice || "en-US-AvaNeural"
      })
    });

    const result = await response.json();

    if (result.error && result.error === "Silence") {
      return NextResponse.json(result);
    }

    // ৩. SaaS ডেটাবেজ থেকে মিনিট কাটা (যেমন ২.৫ সেকেন্ড = ০.০৪১ মিনিট)
    if (userId && audioDurationSeconds) {
      const usedMinutes = audioDurationSeconds / 60.0;
      await supabase.rpc("deduct_user_minutes", {
        p_user_id: userId,
        p_minutes: usedMinutes
      });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}