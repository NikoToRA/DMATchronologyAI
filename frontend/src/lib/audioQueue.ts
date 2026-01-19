/**
 * Audio Queue - IndexedDB-based audio segment storage for offline support
 *
 * Provides:
 * - Local storage of audio segments before upload
 * - Automatic retry with exponential backoff
 * - Offline detection and queue management
 */

function getApiBaseUrl(): string {
  // NEXT_PUBLIC_* is inlined at build time; fallback to same-origin.
  return process.env.NEXT_PUBLIC_API_URL || '';
}

function formatFastApiErrorPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const anyPayload = payload as any;
  if (typeof anyPayload.message === 'string' && anyPayload.message.trim()) return anyPayload.message;
  const detail = anyPayload.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    // Typical FastAPI validation: [{ loc: [...], msg: "...", type: "..." }, ...]
    const parts = detail
      .map((d: any) => {
        const loc = Array.isArray(d?.loc) ? d.loc.join('.') : d?.loc;
        const msg = d?.msg ?? JSON.stringify(d);
        return loc ? `${loc}: ${msg}` : String(msg);
      })
      .filter(Boolean);
    return parts.length ? parts.join(' / ') : null;
  }
  return null;
}

function guessAudioExtension(mimeType: string | undefined): string {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('audio/webm')) return 'webm';
  if (t.includes('audio/wav') || t.includes('audio/wave') || t.includes('audio/x-wav')) return 'wav';
  if (t.includes('audio/ogg')) return 'ogg';
  if (t.includes('audio/mpeg') || t.includes('audio/mp3')) return 'mp3';
  if (t.includes('audio/mp4') || t.includes('audio/x-m4a')) return 'm4a';
  return 'webm';
}

function isLikelyCorruptWebmError(errorText: string): boolean {
  const e = (errorText || '').toLowerCase();
  return (
    e.includes('ebml header parsing failed') ||
    e.includes('invalid data found when processing input') ||
    e.includes('decoding failed')
  );
}

// =============================================================================
// Types
// =============================================================================

export type SegmentStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface PendingSegment {
  localId: string;
  sessionId: string;
  speakerName: string;
  speakerId: string;
  audioBlob: Blob;
  startTime: string;
  endTime: string;
  createdAt: string;
  lastAttemptAt: string;
  status: SegmentStatus;
  retryCount: number;
  lastError: string | null;
  duration: number;
}

export interface UploadResult {
  ok: boolean;
  entryId?: string;
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DB_NAME = 'chronology_audio_queue';
const DB_VERSION = 1;
const STORE_NAME = 'pending_segments';
const MAX_RETRY_COUNT = 5;
const RETRY_DELAYS = [5000, 10000, 20000, 40000, 80000]; // Exponential backoff
const MAX_AGE_HOURS = 24;

// =============================================================================
// Database Initialization
// =============================================================================

let db: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: 'localId',
        });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

// =============================================================================
// Queue Operations
// =============================================================================

/**
 * Add a new audio segment to the queue
 */
export async function addToQueue(
  segment: Omit<PendingSegment, 'localId' | 'createdAt' | 'lastAttemptAt' | 'status' | 'retryCount' | 'lastError'>
): Promise<PendingSegment> {
  const database = await getDB();

  const now = new Date().toISOString();
  const newSegment: PendingSegment = {
    ...segment,
    localId: crypto.randomUUID(),
    createdAt: now,
    lastAttemptAt: now,
    status: 'pending',
    retryCount: 0,
    lastError: null,
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(newSegment);

    request.onsuccess = () => resolve(newSegment);
    request.onerror = () => reject(new Error('Failed to add segment to queue'));
  });
}

/**
 * Get all pending segments for a session
 */
export async function getPendingSegments(sessionId?: string): Promise<PendingSegment[]> {
  const database = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    let request: IDBRequest;
    if (sessionId) {
      const index = store.index('sessionId');
      request = index.getAll(sessionId);
    } else {
      request = store.getAll();
    }

    request.onsuccess = () => {
      const segments = request.result as PendingSegment[];
      // Filter to only pending/failed segments
      resolve(segments.filter((s) => s.status !== 'uploaded'));
    };
    request.onerror = () => reject(new Error('Failed to get pending segments'));
  });
}

/**
 * Update a segment's status
 */
export async function updateSegmentStatus(
  localId: string,
  status: SegmentStatus,
  error?: string
): Promise<void> {
  const database = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(localId);

    getRequest.onsuccess = () => {
      const segment = getRequest.result as PendingSegment;
      if (!segment) {
        reject(new Error('Segment not found'));
        return;
      }

      segment.status = status;
      segment.lastAttemptAt = new Date().toISOString();
      if (error) {
        segment.lastError = error;
      }
      if (status === 'failed') {
        segment.retryCount += 1;
      }

      const putRequest = store.put(segment);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(new Error('Failed to update segment'));
    };
    getRequest.onerror = () => reject(new Error('Failed to get segment'));
  });
}

/**
 * Force-reset segments for retry (used for manual "retry all").
 * - sets status to 'pending'
 * - resets retryCount to 0
 * - clears lastError
 */
export async function resetSegmentsForRetry(sessionId?: string): Promise<number> {
  const database = await getDB();
  const segments = await getPendingSegments(sessionId);
  const toReset = segments.filter((s) => s.status !== 'pending');
  if (toReset.length === 0) return 0;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let updated = 0;

    transaction.oncomplete = () => resolve(updated);
    transaction.onerror = () => reject(new Error('Failed to reset segments'));

    for (const seg of toReset) {
      seg.status = 'pending';
      seg.retryCount = 0;
      seg.lastError = null;
      seg.lastAttemptAt = new Date().toISOString();
      const req = store.put(seg);
      req.onsuccess = () => {
        updated += 1;
      };
    }
  });
}

/**
 * Remove a segment from the queue (after successful upload)
 */
export async function removeFromQueue(localId: string): Promise<void> {
  const database = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(localId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Failed to remove segment'));
  });
}

/**
 * Get count of pending segments
 */
export async function getPendingCount(sessionId?: string): Promise<number> {
  const segments = await getPendingSegments(sessionId);
  return segments.filter((s) => s.status === 'pending' || s.status === 'failed').length;
}

/**
 * Get a single segment by localId
 */
export async function getSegmentById(localId: string): Promise<PendingSegment | null> {
  const database = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(localId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(new Error('Failed to get segment'));
  });
}

/**
 * Retry uploading a specific segment by localId
 */
export async function retrySegment(localId: string, participantIdOverride?: string): Promise<UploadResult> {
  const segment = await getSegmentById(localId);
  if (!segment) {
    return { ok: false, error: 'Segment not found' };
  }
  return uploadSegment(segment, participantIdOverride);
}

/**
 * Rebind queued segments to a new participant_id.
 * Useful when the user has re-registered in the current session and old segments
 * still carry a participant_id from another session/login.
 */
export async function rebindSegmentsToParticipant(
  sessionId: string,
  participantId: string,
  speakerName?: string
): Promise<number> {
  const database = await getDB();
  const segments = await getPendingSegments(sessionId);
  if (segments.length === 0) return 0;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let updated = 0;

    transaction.oncomplete = () => resolve(updated);
    transaction.onerror = () => reject(new Error('Failed to rebind segments'));

    for (const seg of segments) {
      if (seg.speakerId !== participantId || (speakerName && seg.speakerName !== speakerName)) {
        seg.speakerId = participantId;
        if (speakerName) seg.speakerName = speakerName;
        const req = store.put(seg);
        req.onsuccess = () => {
          updated += 1;
        };
      }
    }
  });
}

/**
 * Clean up old segments (older than MAX_AGE_HOURS)
 */
export async function cleanupOldSegments(): Promise<number> {
  const database = await getDB();
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const range = IDBKeyRange.upperBound(cutoff);
    const request = index.openCursor(range);

    let deletedCount = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      } else {
        resolve(deletedCount);
      }
    };
    request.onerror = () => reject(new Error('Failed to cleanup old segments'));
  });
}

// =============================================================================
// Upload Functions
// =============================================================================

/**
 * Upload a single segment to the server
 */
export async function uploadSegment(
  segment: PendingSegment,
  participantIdOverride?: string
): Promise<UploadResult> {
  try {
    await updateSegmentStatus(segment.localId, 'uploading');

    const formData = new FormData();
    // Use filename extension that matches the actual Blob type.
    // Backend prefers filename extension when detecting format.
    const ext = guessAudioExtension(segment.audioBlob?.type);
    formData.append('audio', segment.audioBlob, `recording.${ext}`);
    const pid = participantIdOverride || segment.speakerId;
    formData.append('participant_id', pid);
    formData.append('timestamp', segment.startTime);

    // Use fetch to avoid axios default JSON Content-Type interfering with multipart.
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/zoom/audio/${segment.sessionId}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    let result: any = null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

      if (!res.ok) {
        const formatted = formatFastApiErrorPayload(body);
        const message =
          formatted ||
          (typeof body === 'string' && body ? body : '') ||
          `Upload failed (HTTP ${res.status})`;
        await updateSegmentStatus(segment.localId, 'failed', message);
        return { ok: false, error: message };
      }

      result = body;
    } finally {
      clearTimeout(timeout);
    }

    if (result.ok) {
      await removeFromQueue(segment.localId);
      return { ok: true, entryId: result.entry_id };
    } else {
      const stage = result.stage ? `stage=${result.stage}` : '';
      const err = result.error || result.message || 'Processing failed';
      const message = stage ? `${err} (${stage})` : err;

      // If backend fails to decode/convert (common for corrupted blobs),
      // this segment will never succeed and will keep clogging the queue.
      // Remove it to unblock the rest.
      if (result.stage === 'convert' && typeof err === 'string' && isLikelyCorruptWebmError(err)) {
        await removeFromQueue(segment.localId);
        return { ok: false, error: `音声ファイルが破損しているためスキップしました（キューから削除） (${stage || 'stage=convert'})` };
      }

      await updateSegmentStatus(segment.localId, 'failed', message);
      return { ok: false, error: message };
    }
  } catch (err: any) {
    const base =
      err?.name === 'AbortError'
        ? 'Upload timed out'
        : err?.message || 'Upload failed';
    const errorMessage = base;
    await updateSegmentStatus(segment.localId, 'failed', errorMessage);
    return { ok: false, error: errorMessage };
  }
}

/**
 * Process the upload queue - upload all pending segments
 * @param sessionId - Optional session ID to filter segments
 * @param forceRetry - If true, skip delay checks and include stuck 'uploading' segments
 */
export async function processQueue(sessionId?: string, forceRetry = false): Promise<{
  success: number;
  failed: number;
}> {
  // Keep logs lightweight in production; enable by localStorage: debug_audio_queue=1
  const debug =
    process.env.NODE_ENV !== 'production' ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('debug_audio_queue') === '1');
  if (debug) console.log('[AudioQueue] processQueue called:', { sessionId, forceRetry });

  const segments = await getPendingSegments(sessionId);
  if (debug) {
    console.log(
      '[AudioQueue] Found segments:',
      segments.length,
      segments.map((s) => ({
        id: s.localId?.substring?.(0, 8),
        status: s.status,
        retryCount: s.retryCount,
        sessionId: s.sessionId?.substring?.(0, 8),
      }))
    );
  }

  const pendingSegments = segments.filter((s) => {
    // Manual retry-all: try everything except already-uploaded (filtered out upstream).
    if (forceRetry) return true;

    // Always include pending segments
    if (s.status === 'pending') {
      if (debug) console.log('[AudioQueue] Including pending segment:', s.localId.substring(0, 8));
      return true;
    }

    // Include failed segments (bypass max retry check if forceRetry)
    if (s.status === 'failed') {
      const include = s.retryCount < MAX_RETRY_COUNT;
      if (debug) {
        console.log(
          '[AudioQueue] Failed segment:',
          s.localId.substring(0, 8),
          'retryCount:',
          s.retryCount,
          'include:',
          include
        );
      }
      return include;
    }

    // Include 'uploading' segments that have been stuck for more than 60 seconds
    // (or immediately if forceRetry is true)
    if (s.status === 'uploading') {
      const lastAttempt = new Date(s.lastAttemptAt || s.createdAt).getTime();
      const timeSinceLastAttempt = Date.now() - lastAttempt;
      return timeSinceLastAttempt > 60000;
    }

    // Log unexpected status
    if (debug) {
      console.log(
        '[AudioQueue] Excluding segment with unexpected status:',
        s.localId.substring(0, 8),
        'status:',
        s.status
      );
    }
    return false;
  });

  if (debug) console.log('[AudioQueue] Segments to process:', pendingSegments.length);

  let success = 0;
  let failed = 0;

  for (const segment of pendingSegments) {
    // Check if we should wait before retry (skip if forceRetry)
    if (!forceRetry && segment.status === 'failed' && segment.retryCount > 0) {
      const delay = RETRY_DELAYS[Math.min(segment.retryCount - 1, RETRY_DELAYS.length - 1)];
      const lastAttempt = new Date(segment.lastAttemptAt || segment.createdAt).getTime();
      const timeSinceLastAttempt = Date.now() - lastAttempt;

      if (timeSinceLastAttempt < delay) {
        continue; // Skip this segment, not ready for retry yet
      }
    }

    if (debug) console.log('[AudioQueue] Uploading segment:', segment.localId);
    const result = await uploadSegment(segment);
    if (debug) console.log('[AudioQueue] Upload result:', segment.localId, result);
    if (result.ok) {
      success++;
    } else {
      failed++;
    }
  }

  if (debug) console.log('[AudioQueue] processQueue complete:', { success, failed });
  return { success, failed };
}

/**
 * Start background queue processor
 */
let queueProcessorInterval: NodeJS.Timeout | null = null;

export function startQueueProcessor(intervalMs = 10000): void {
  if (queueProcessorInterval) return;

  queueProcessorInterval = setInterval(async () => {
    if (!navigator.onLine) return; // Skip if offline

    try {
      await processQueue();
      await cleanupOldSegments();
    } catch (err) {
      console.error('Queue processor error:', err);
    }
  }, intervalMs);
}

export function stopQueueProcessor(): void {
  if (queueProcessorInterval) {
    clearInterval(queueProcessorInterval);
    queueProcessorInterval = null;
  }
}
