import { expect, test } from '@playwright/test';

const sample = `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101018}.box{position:absolute;left:0;top:320px;width:80px;height:80px;border-radius:40px;background:#fff;animation:slide 1s linear infinite}@keyframes slide{to{transform:translateX(1200px)}}</style></head><body><div class="box"></div></body></html>`;

test('@smoke Mode B renders a 1-second 720p sample', async ({ request }) => {
  const response = await request.post('/api/jobs', {
    multipart: {
      htmlText: sample,
      settings: JSON.stringify({ width: 1280, height: 720, fps: 24, duration: 1, quality: 'high', renderMode: 'server', loopCheck: true }),
    },
  });
  expect(response.status()).toBe(202);
  const { jobId } = await response.json() as { jobId: string };
  expect(jobId).toMatch(/^[0-9a-f-]{36}$/i);

  let status: { status: string; framesDone: number; totalFrames: number; videoReady: boolean } | null = null;
  for (let i = 0; i < 120; i++) {
    status = await (await request.get(`/api/jobs/${jobId}`)).json();
    if (status.status === 'done' || status.status === 'error' || status.status === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  expect(status?.status).toBe('done');
  expect(status?.framesDone).toBe(24);
  expect(status?.totalFrames).toBe(24);
  expect(status?.videoReady).toBe(true);

  const video = await request.get(`/api/jobs/${jobId}/video`);
  expect(video.ok()).toBe(true);
  expect(video.headers()['content-type']).toContain('video/mp4');
  expect((await video.body()).length).toBeGreaterThan(1000);
});
