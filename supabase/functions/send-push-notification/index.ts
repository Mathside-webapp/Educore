import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:educore@example.com";

  if (req.method === "GET") {
    if (!publicKey) return json({ error: "VAPID_PUBLIC_KEY is not configured." }, 503);
    return json({ publicKey });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!publicKey || !privateKey) return json({ error: "VAPID secrets are not configured." }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  // Supabase Database Webhook payload shape.
  if (payload?.type !== "INSERT" || payload?.table !== "classside_notifications") {
    return json({ ok: true, ignored: true });
  }

  const note = payload.record || {};
  const userId = String(note.user_id || "");
  if (!userId) return json({ error: "Notification user_id is missing." }, 400);

  const { data: subscriptions, error } = await admin
    .from("classside_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) return json({ error: error.message }, 500);
  if (!subscriptions?.length) return json({ ok: true, delivered: 0 });

  webpush.setVapidDetails(vapidSubject, publicKey, privateKey);

  const body = JSON.stringify({
    title: note.title || "EduCore",
    body: note.body || "You have a new EduCore update.",
    tag: `classside-${note.id || crypto.randomUUID()}`,
    notificationId: note.id || null,
    type: note.type || "update",
    relatedAssignmentId: note.related_assignment_id || null,
    relatedSubmissionId: note.related_submission_id || null,
    url: "./",
  });

  let delivered = 0;
  let removed = 0;

  await Promise.all(subscriptions.map(async (sub: any) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        { TTL: 60 * 60 * 24, urgency: "high" },
      );
      delivered += 1;
    } catch (sendError: any) {
      const statusCode = Number(sendError?.statusCode || sendError?.status || 0);
      console.error("Web Push delivery failed", statusCode, sendError?.message || sendError);
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("classside_push_subscriptions").delete().eq("id", sub.id);
        removed += 1;
      }
    }
  }));

  return json({ ok: true, delivered, removed });
});
