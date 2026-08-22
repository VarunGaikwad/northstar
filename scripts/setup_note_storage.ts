import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/config/env";

const BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

function numericProviderStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  try {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" && Number.isInteger(status) ? status : undefined;
  } catch {
    return undefined;
  }
}

async function setupNoteStorage(): Promise<void> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      detectSessionInUrl: false,
      autoRefreshToken: false,
    },
  });
  const bucket = env.SUPABASE_NOTE_IMAGES_BUCKET;

  const createResult = await supabase.storage.createBucket(bucket, BUCKET_OPTIONS);
  if (createResult.error !== null) {
    if (numericProviderStatus(createResult.error) !== 409) {
      throw new Error("Unable to configure the note image storage bucket");
    }

    const updateResult = await supabase.storage.updateBucket(bucket, BUCKET_OPTIONS);
    if (updateResult.error !== null) {
      throw new Error("Unable to configure the note image storage bucket");
    }
  }

  console.log("Note image storage bucket is configured.");
}

setupNoteStorage().catch(() => {
  console.error("Unable to configure the note image storage bucket.");
  process.exitCode = 1;
});
