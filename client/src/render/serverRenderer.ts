import type { JobStatusResponse, Settings } from '../types';

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export interface ServerRenderCallbacks {
  onProgress: (status: JobStatusResponse) => void;
  isCancelled: () => boolean;
}

export async function createServerJob(
  html: string,
  htmlFile: File | null,
  audioFile: File | null,
  settings: Settings,
): Promise<string> {
  const form = new FormData();
  if (htmlFile) form.append('htmlFile', htmlFile, htmlFile.name);
  else form.append('htmlText', html);
  if (audioFile) form.append('audio', audioFile, audioFile.name);
  form.append('settings', JSON.stringify({ ...settings, renderMode: 'server' }));

  const response = await fetch(apiUrl('/api/jobs'), { method: 'POST', body: form });
  const body = (await response.json()) as { jobId?: string; error?: string };
  if (!response.ok || !body.jobId) throw new Error(body.error || `Server returned HTTP ${response.status}.`);
  return body.jobId;
}

export async function monitorServerJob(jobId: string, callbacks: ServerRenderCallbacks): Promise<JobStatusResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer: number | undefined;
    let eventSource: EventSource | undefined;

    const finish = (status: JobStatusResponse) => {
      if (settled) return;
      settled = true;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      eventSource?.close();
      if (status.status === 'done') resolve(status);
      else if (status.status === 'cancelled') reject(new DOMException('Rendering cancelled.', 'AbortError'));
      else reject(new Error(status.error || 'Server rendering failed.'));
    };

    const onStatus = (status: JobStatusResponse) => {
      callbacks.onProgress(status);
      if (status.status === 'done' || status.status === 'error' || status.status === 'cancelled') finish(status);
    };

    const poll = async () => {
      if (settled) return;
      if (callbacks.isCancelled()) {
        await cancelServerJob(jobId).catch(() => undefined);
        finish({ jobId, status: 'cancelled', framesDone: 0, totalFrames: 0, etaSeconds: null, elapsedSeconds: 0, videoReady: false, loopCheck: null });
        return;
      }
      try {
        const response = await fetch(apiUrl(`/api/jobs/${jobId}`));
        if (!response.ok) throw new Error(`Status request failed with HTTP ${response.status}.`);
        const status = (await response.json()) as JobStatusResponse;
        onStatus(status);
      } catch (error) {
        callbacks.onProgress({ jobId, status: 'rendering', framesDone: 0, totalFrames: 0, etaSeconds: null, elapsedSeconds: 0, videoReady: false, loopCheck: null, error: error instanceof Error ? error.message : 'Status request failed.' });
      }
      if (!settled) pollTimer = window.setTimeout(() => void poll(), 1000);
    };

    eventSource = new EventSource(apiUrl(`/api/jobs/${jobId}/events`));
    eventSource.onmessage = (event) => {
      try { onStatus(JSON.parse(event.data) as JobStatusResponse); } catch { /* fall back to polling */ }
    };
    eventSource.onerror = () => { eventSource?.close(); void poll(); };
    void poll();
  });
}

export async function cancelServerJob(jobId: string): Promise<void> {
  await fetch(apiUrl(`/api/jobs/${jobId}`), { method: 'DELETE' });
}

export function serverVideoUrl(jobId: string): string {
  return apiUrl(`/api/jobs/${jobId}/video`);
}

export async function exportServerFrame(html: string, htmlFile: File | null, settings: Settings, time: number): Promise<Blob> {
  const form = new FormData();
  if (htmlFile) form.append('htmlFile', htmlFile, htmlFile.name);
  else form.append('htmlText', html);
  form.append('settings', JSON.stringify({ ...settings, renderMode: 'server' }));
  form.append('time', String(time));
  const response = await fetch(apiUrl('/api/frame'), { method: 'POST', body: form });
  if (!response.ok) {
    let message = `Server returned HTTP ${response.status}.`;
    try { message = ((await response.json()) as { error?: string }).error || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return response.blob();
}
