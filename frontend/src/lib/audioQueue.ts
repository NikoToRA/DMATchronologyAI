/**
 * Audio Queue - IndexedDB-based audio segment storage for offline support
 *
 * Provides:
 * - Local storage of audio segments before upload
 * - Automatic retry with exponential backoff
 * - Offline detection and queue management
 */

import { api } from './api';

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
  segment: Omit<PendingSegment, 'localId' | 'createdAt' | 'status' | 'retryCount' | 'lastError'>
): Promise<PendingSegment> {
  const database = await getDB();

  const newSegment: PendingSegment = {
    ...segment,
    localId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
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
export async function retrySegment(localId: string): Promise<UploadResult> {
  const segment = await getSegmentById(localId);
  if (!segment) {
    return { ok: false, error: 'Segment not found' };
  }
  return uploadSegment(segment);
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
export async function uploadSegment(segment: PendingSegment): Promise<UploadResult> {
  try {
    await updateSegmentStatus(segment.localId, 'uploading');

    const formData = new FormData();
    formData.append('audio', segment.audioBlob, 'recording.webm');
    formData.append('participant_id', segment.speakerId);
    formData.append('timestamp', segment.startTime);

    const response = await api.post(
      `/api/zoom/audio/${segment.sessionId}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      }
    );

    const result = response.data;

    if (result.ok) {
      await removeFromQueue(segment.localId);
      return { ok: true, entryId: result.entry_id };
    } else {
      await updateSegmentStatus(segment.localId, 'failed', result.error || 'Processing failed');
      return { ok: false, error: result.error || 'Processing failed' };
    }
  } catch (err: any) {
    const errorMessage = err.message || 'Upload failed';
    await updateSegmentStatus(segment.localId, 'failed', errorMessage);
    return { ok: false, error: errorMessage };
  }
}

/**
 * Process the upload queue - upload all pending segments
 */
export async function processQueue(sessionId?: string): Promise<{
  success: number;
  failed: number;
}> {
  const segments = await getPendingSegments(sessionId);
  const pendingSegments = segments.filter(
    (s) => s.status === 'pending' || (s.status === 'failed' && s.retryCount < MAX_RETRY_COUNT)
  );

  let success = 0;
  let failed = 0;

  for (const segment of pendingSegments) {
    // Check if we should wait before retry
    if (segment.status === 'failed' && segment.retryCount > 0) {
      const delay = RETRY_DELAYS[Math.min(segment.retryCount - 1, RETRY_DELAYS.length - 1)];
      const lastAttempt = new Date(segment.createdAt).getTime();
      const timeSinceLastAttempt = Date.now() - lastAttempt;

      if (timeSinceLastAttempt < delay) {
        continue; // Skip this segment, not ready for retry yet
      }
    }

    const result = await uploadSegment(segment);
    if (result.ok) {
      success++;
    } else {
      failed++;
    }
  }

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
