import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "cms-media";
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif",
  "audio/mpeg","audio/mp4","audio/x-m4a","audio/wav","audio/x-wav","audio/ogg","audio/webm","audio/aac",
  "video/mp4","video/quicktime","video/webm","video/x-m4v","video/mpeg"
]);
const headers = {
  "Content-Type":"application/json",
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error:"Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error:"Unauthorized" }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global:{ headers:{ Authorization:`Bearer ${token}` } },
    auth:{ persistSession:false, autoRefreshToken:false }
  });
  const { data:userData, error:userError } = await authClient.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user || String(user.app_metadata?.role || "").toLowerCase() !== "admin") {
    return json({ error:"Admin required" }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth:{ persistSession:false, autoRefreshToken:false } });
  let body:any;
  try { body = await req.json(); } catch { return json({ error:"Invalid JSON" }, 400); }
  const action = String(body?.action || "prepare");

  if (action === "prepare") {
    const name = String(body?.name || "media");
    const size = Number(body?.size || 0);
    const mime = normalizeMime(String(body?.mime || ""), name);
    const language = normalizeLanguage(body?.language);
    if (!size || size > MAX_BYTES) return json({ error:"Fichier trop lourd (50 Mo max)." }, 400);
    if (!ALLOWED.has(mime)) return json({ error:"Format non accepté." }, 400);
    const ext = safeExtension(name, mime);
    const base = slug(name.replace(/\.[^.]+$/, "")).slice(0, 60) || "media";
    const date = new Date().toISOString().slice(0, 10);
    const path = `library/${date}/${crypto.randomUUID()}-${base}.${ext}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return json({ error:error?.message || "Impossible de préparer l’upload." }, 500);
    return json({ path, token:data.token, mime, language });
  }

  if (action === "complete") {
    const path = String(body?.path || "");
    const mime = normalizeMime(String(body?.mime || ""), path);
    const language = normalizeLanguage(body?.language);
    const title = String(body?.title || path.split("/").pop() || "Média").slice(0, 240);
    if (!path.startsWith("library/") || !ALLOWED.has(mime)) return json({ error:"Média invalide." }, 400);
    const { data, error } = await admin.from("cms_media_assets").insert({
      bucket:BUCKET, storage_path:path, media_kind:mediaKind(mime), mime_type:mime,
      language, title, status:"published", updated_by:user.id
    }).select().single();
    if (error) {
      await admin.storage.from(BUCKET).remove([path]).catch(() => {});
      return json({ error:error.message }, 500);
    }
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return json({ asset:data, publicUrl });
  }

  if (action === "delete") {
    const id = String(body?.id || "");
    const path = String(body?.path || "");
    if (!id || !path.startsWith("library/")) return json({ error:"Média invalide." }, 400);
    const { error:storageError } = await admin.storage.from(BUCKET).remove([path]);
    if (storageError) return json({ error:storageError.message }, 500);
    const { error } = await admin.from("cms_media_assets").delete().eq("id", id);
    if (error) return json({ error:error.message }, 500);
    return json({ ok:true });
  }
  return json({ error:"Unknown action" }, 400);
});

function json(value:unknown, status=200) { return new Response(JSON.stringify(value), { status, headers }); }
function normalizeLanguage(value:unknown) { const v=String(value||"").toLowerCase(); if(v==="fr")return "fr"; if(v==="wo"||v==="sn")return "wo"; return null; }
function mediaKind(mime:string) { if(mime.startsWith("image/"))return "image"; if(mime.startsWith("audio/"))return "audio"; if(mime.startsWith("video/"))return "video"; return "other"; }
function normalizeMime(raw:string,name:string) {
  const mime=raw.toLowerCase().trim(); if(ALLOWED.has(mime))return mime;
  const ext=(name.split(".").pop()||"").toLowerCase();
  const byExt:Record<string,string>={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",heic:"image/heic",heif:"image/heif",mp3:"audio/mpeg",m4a:"audio/x-m4a",wav:"audio/wav",ogg:"audio/ogg",aac:"audio/aac",mp4:"video/mp4",mov:"video/quicktime",m4v:"video/x-m4v",webm:"video/webm",mpeg:"video/mpeg",mpg:"video/mpeg"};
  return byExt[ext] || mime;
}
function safeExtension(name:string,mime:string) {
  const ext=(name.split(".").pop()||"").replace(/[^a-z0-9]/gi,"").toLowerCase(); if(ext&&ext.length<=8)return ext;
  const fallback:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","image/heic":"heic","image/heif":"heif","audio/mpeg":"mp3","audio/mp4":"m4a","audio/x-m4a":"m4a","audio/wav":"wav","audio/x-wav":"wav","audio/ogg":"ogg","audio/webm":"webm","audio/aac":"aac","video/mp4":"mp4","video/quicktime":"mov","video/webm":"webm","video/x-m4v":"m4v","video/mpeg":"mpeg"};
  return fallback[mime] || "bin";
}
function slug(value:string) { return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }
