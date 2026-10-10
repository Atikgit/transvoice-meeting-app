import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-signature");
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    if (!signature || !secret) {
      return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 });
    }

    // ১. সিগনেচার ভেরিফিকেশন (HMAC SHA-256)
    const hmac = crypto.createHmac("sha256", secret);
    const digest = Buffer.from(hmac.update(rawBody).digest("hex"), "utf8");
    const signatureBuffer = Buffer.from(signature, "utf8");

    if (digest.length !== signatureBuffer.length || !crypto.timingSafeEqual(digest, signatureBuffer)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const eventName = payload.meta?.event_name;
    const customData = payload.meta?.custom_data;
    const userId = customData?.user_id; // চেকআউট লিংক থেকে প্রাপ্ত Supabase User ID

    // পেমেন্ট সফল বা মাসিক রিনিউ হলে এই ইভেন্টগুলো আসে
    const validEvents = [
      "order_created",
      "subscription_created",
      "subscription_payment_success"
    ];

    if (validEvents.includes(eventName)) {
      const productName = (payload.data?.attributes?.first_order_item?.product_name || "").toLowerCase();
      const variantName = (payload.data?.attributes?.first_order_item?.variant_name || "").toLowerCase();
      const combinedName = `${productName} ${variantName}`;

      // ২. আপনার ৩টি প্রোডাক্টের মিনিট কনফিগারেশন:
      let purchasedMinutes = 120; // ১. ডিফল্ট / Starter Plan: ১২০ মিনিট (২ ঘণ্টা)
      let planName = "starter";

      if (combinedName.includes("pro") || combinedName.includes("diamond")) {
        // ২. Pro Plan: ৩০০ মিনিট
        purchasedMinutes = 300;
        planName = "pro";
      } else if (combinedName.includes("business") || combinedName.includes("corporate") || combinedName.includes("enterprise")) {
        // ৩. Business / Scale Plan: ৬০০ মিনিট
        purchasedMinutes = 600;
        planName = "business";
      }

      if (userId) {
        // Supabase-এ ইউজারের ব্যালেন্সে মিনিট যোগ করা
        await supabase.rpc("add_user_minutes", {
          p_user_id: userId,
          p_minutes: purchasedMinutes,
        });

        // ইউজারের প্ল্যানের নাম আপডেট করা
        await supabase
          .from("profiles")
          .update({ plan: planName })
          .eq("id", userId);

        console.log(`✅ User ${userId} successfully recharged with ${purchasedMinutes} minutes for plan ${planName}`);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}