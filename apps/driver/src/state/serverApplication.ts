import { createApplicationSync, createDriverApplicationApi, createFileUploader, type ApplicationSync, type LocalFile } from '@gobye/core';
import { readJson, writeJson } from './storage';
import { realAuth } from './realAuth';

const FILES_KEY = 'gobye.driver.uploadedFiles';

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' };

/** A picked photo (local URI) as bytes for the checksum, and as a Blob for the upload itself. */
async function read(uri: string): Promise<LocalFile> {
  const res = await fetch(uri);
  const blob = await res.blob();
  const bytes = new Uint8Array(await new Response(blob).arrayBuffer());
  const name = uri.split(/[/?#]/).filter(Boolean).pop() ?? 'photo.jpg';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : 'jpg';
  return { bytes, mime: blob.type || MIME[ext] || 'image/jpeg', filename: name, body: blob };
}

async function put(url: string, headers: Record<string, string>, file: LocalFile): Promise<boolean> {
  const res = await fetch(url, { method: 'PUT', headers, body: (file.body ?? file.bytes) as BodyInit });
  return res.ok;
}

const newKey = () => `drv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Local photo URI → uploaded file id, saved on the device so each photo is uploaded once. */
const uploaded = new Map<string, string>();
let loaded = false;
export async function loadUploadedFiles(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const saved = await readJson<Record<string, string>>(FILES_KEY);
  for (const [k, v] of Object.entries(saved ?? {})) uploaded.set(k, v);
}

/**
 * The application on the GoBye API (Backend Phase 2, WP4, D-080): on when real sign-in and the accounts API
 * are both switched on (EXPO_PUBLIC_AUTH=supabase, EXPO_PUBLIC_ACCOUNTS_API=true). Null keeps the device-only
 * application with the demo relay or the simulated reviewer.
 */
export const serverApplication: ApplicationSync | null = realAuth?.api
  ? createApplicationSync({
      api: createDriverApplicationApi(realAuth.api),
      upload: createFileUploader({ api: realAuth.api, read, put, newKey }),
      files: {
        get: (uri) => uploaded.get(uri),
        set: (uri, id) => {
          uploaded.set(uri, id);
          void writeJson(FILES_KEY, Object.fromEntries(uploaded));
        },
      },
      newKey,
    })
  : null;
