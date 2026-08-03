// Mirrors js/core/auth/authManager.js and js/core/profile/collectionSyncService.js
// from the NuvioWeb app — same password-grant auth and sync_pull/push_collections
// RPCs, run headlessly here instead of from the app's own Supabase client.
// Defaults come from https://web.nuvioapp.space/nuvio.env.js; override via env
// if the backend project or key ever rotates.
const SUPABASE_URL = process.env.NUVIO_SUPABASE_URL || "https://api.nuvio.tv";
const SUPABASE_ANON_KEY =
  process.env.NUVIO_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI";

export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || `Nuvio sign-in failed (${res.status})`);
  }
  return data.access_token;
}

async function rpc(accessToken, fnName, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(data?.message || `${fnName} failed (${res.status})`);
  }

  return data;
}

export async function pullCollections(accessToken, profileId) {
  const rows = await rpc(accessToken, "sync_pull_collections", { p_profile_id: profileId });
  const blob = Array.isArray(rows) ? rows[0] || null : rows || null;
  const raw = blob?.collections_json ?? blob?.collectionsJson ?? blob ?? [];
  return Array.isArray(raw) ? raw : [];
}

export async function pushCollections(accessToken, profileId, collections) {
  await rpc(accessToken, "sync_push_collections", {
    p_profile_id: profileId,
    p_collections_json: collections
  });
}

// Case-insensitive title match. Throws with the available titles listed so a
// typo in TARGET_COLLECTION_TITLE/TARGET_FOLDER_TITLE is easy to diagnose.
export function findFolder(collections, collectionTitle, folderTitle) {
  const collection = collections.find(
    (c) => (c.title || "").trim().toLowerCase() === collectionTitle.trim().toLowerCase()
  );
  if (!collection) {
    const available = collections.map((c) => c.title).join(", ") || "(none)";
    throw new Error(`Collection "${collectionTitle}" not found. Available: ${available}`);
  }
  const folder = (collection.folders || []).find(
    (f) => (f.title || "").trim().toLowerCase() === folderTitle.trim().toLowerCase()
  );
  if (!folder) {
    const available = (collection.folders || []).map((f) => f.title).join(", ") || "(none)";
    throw new Error(
      `Folder "${folderTitle}" not found in collection "${collectionTitle}". Available: ${available}`
    );
  }
  return { collection, folder };
}
