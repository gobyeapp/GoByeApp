import type { FileService, PresignedRequest } from './service';
import { FileError, type FileCaller, type FileRecord } from './types';

/**
 * Video (D-051). Optional today. Originals are stored in R2 through the same file service (incident
 * footage and public clips), so they get the same checks, quarantine, access rules and retention.
 *
 * R2 stores and serves files; it does NOT transcode or produce adaptive (HLS/DASH) streams. A
 * phone-recorded MP4 plays progressively; a MOV/HEVC clip may not play in every browser. When we need
 * transcoding or adaptive streaming, a provider such as Cloudflare Stream plugs in behind `VideoService`
 * (status: Future enhancement, pending approval).
 */

export type VideoState = 'uploading' | 'checking' | 'ready_original' | 'processing' | 'ready_streaming' | 'failed' | 'unsupported';

export interface VideoAsset {
  fileId: string;
  state: VideoState;
  /** Container of the stored original. */
  container: 'mp4' | 'mov' | null;
  /** Plays in common players without processing (MP4 with H.264 is the safe case). */
  playableAsIs: boolean;
  note?: string;
}

export interface VideoPlayback {
  kind: 'original' | 'stream';
  access: PresignedRequest;
}

export interface VideoService {
  /** Same as a file upload with class `incident_video` (or `public_media` for staff clips). */
  initialize: FileService['initializeUpload'];
  complete(caller: FileCaller | null, fileId: string): Promise<VideoAsset>;
  state(caller: FileCaller | null, fileId: string): Promise<VideoAsset>;
  playback(caller: FileCaller | null, fileId: string, reason?: string): Promise<VideoPlayback>;
}

/** Hook for a streaming provider later (e.g. Cloudflare Stream). Not implemented: pending approval. */
export interface StreamingProvider {
  ingest(p: { sourceUrl: string; fileId: string }): Promise<{ providerId: string }>;
  status(providerId: string): Promise<'processing' | 'ready' | 'failed'>;
  playback(providerId: string, ttlSeconds: number): Promise<PresignedRequest>;
}

const describe = (r: FileRecord): VideoAsset => {
  const container = r.detectedMime === 'video/mp4' ? 'mp4' : r.detectedMime === 'video/quicktime' ? 'mov' : null;
  const state: VideoState =
    r.status === 'pending_upload' ? 'uploading' : r.status === 'approved' ? 'ready_original' : r.status === 'scanning' || r.status === 'uploaded' ? 'checking' : 'failed';
  return {
    fileId: r.fileId,
    state,
    container,
    playableAsIs: container === 'mp4',
    note: container === 'mov' ? 'Stored as recorded (MOV). Some browsers can’t play it until a streaming provider converts it.' : undefined,
  };
};

/** Originals in R2 only: no transcoding, no adaptive streaming (see the note above). */
export function createR2OriginalsVideoService(files: FileService): VideoService {
  return {
    initialize: (caller, req) => {
      if (!['video/mp4', 'video/quicktime'].includes(req.mime.toLowerCase())) return Promise.reject(new FileError('invalid_type', 'Use an MP4 or MOV video.'));
      return files.initializeUpload(caller, req);
    },
    async complete(caller, fileId) {
      return describe(await files.completeUpload(caller, fileId));
    },
    async state(caller, fileId) {
      return describe(await files.getFileMetadata(caller, fileId));
    },
    async playback(caller, fileId, reason) {
      return { kind: 'original', access: await files.getDownloadAccess(caller, fileId, reason) };
    },
  };
}
