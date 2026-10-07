import { useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLES } from './samples';
import type { ConsoleEntry, DetectionResult, JobStatusResponse, LoopCheckResult, RenderMode, Settings } from './types';
import { detectRenderMode } from './lib/detection';
import { injectBridge, postBridgeMessage } from './lib/bridge';
import { frameCount, validateSettings } from './lib/settings';
import { renderCanvasInBrowser } from './render/canvasRenderer';
import { cancelServerJob, createServerJob, exportServerFrame, monitorServerJob, serverVideoUrl } from './render/serverRenderer';
import './styles.css';

const DEFAULT_CODE = SAMPLES[0]?.code || '';

function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  return `${Math.max(0, seconds).toFixed(0)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function resolutionLabel(settings: Settings): string {
  if (settings.width === 1280 && settings.height === 720) return '1280 × 720 (HD)';
  if (settings.width === 1920 && settings.height === 1080) return '1920 × 1080 (Full HD)';
  if (settings.width === 2560 && settings.height === 1440) return '2560 × 1440 (2K)';
  if (settings.width === 3840 && settings.height === 2160) return '3840 × 2160 (4K)';
  return 'Custom';
}

export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [inputTab, setInputTab] = useState<'paste' | 'upload'>('paste');
  const [htmlFile, setHtmlFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<Settings>({ width: 1280, height: 720, fps: 30, duration: 4, quality: 'medium', renderMode: 'auto', loopCheck: true });
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState<JobStatusResponse | null>(null);
  const [localFrameProgress, setLocalFrameProgress] = useState({ done: 0, total: 0, startedAt: 0 });
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState(0);
  const [resultLoop, setResultLoop] = useState<LoopCheckResult | null>(null);
  const [resultMode, setResultMode] = useState<Exclude<RenderMode, 'auto'> | null>(null);
  const [resultSettings, setResultSettings] = useState<Settings | null>(null);
  const [serverJobId, setServerJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceWarning, setSourceWarning] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cancelRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);

  const detection = useMemo<DetectionResult>(() => detectRenderMode(code), [code]);
  const effectiveMode: Exclude<RenderMode, 'auto'> = settings.renderMode === 'auto' ? (detection.recommendedMode || 'server') : settings.renderMode;
  const srcDoc = useMemo(() => injectBridge(code), [code]);
  const totalFrames = frameCount(settings.duration, settings.fps);
  const percentage = rendering
    ? effectiveMode === 'canvas'
      ? (localFrameProgress.total ? (localFrameProgress.done / localFrameProgress.total) * 100 : 0)
      : (progress?.totalFrames ? (progress.framesDone / progress.totalFrames) * 100 : 0)
    : 0;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.data?.__code2video !== true) return;
      const message = event.data as { type?: string; level?: string; message?: string };
      const now = new Date().toLocaleTimeString();
      if (message.type === 'console') {
        const level = ['log', 'info', 'warn', 'error'].includes(message.level || '') ? message.level as ConsoleEntry['type'] : 'log';
        setConsoleEntries((items) => [...items.slice(-99), { type: level, message: message.message || '', time: now }]);
      } else if (message.type === 'error') {
        setConsoleEntries((items) => [...items.slice(-99), { type: 'error', message: message.message || 'Unknown JavaScript error.', time: now }]);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    setCurrentTime(0);
    setPlaying(false);
    setConsoleEntries([]);
    setResultUrl(null);
    setResultSize(0);
    setResultLoop(null);
    setResultMode(null);
    setResultSettings(null);
    setError(null);
    setSourceWarning(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, [code]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCurrentTime((value) => {
        const next = value + 0.05;
        if (next >= settings.duration) return 0;
        return next;
      });
    }, 50);
    return () => window.clearInterval(id);
  }, [playing, settings.duration]);

  useEffect(() => {
    if (!iframeRef.current || effectiveMode !== 'canvas') return;
    postBridgeMessage(iframeRef.current, 'setTime', { time: currentTime });
  }, [currentTime, effectiveMode]);

  const loadSample = (index: number) => {
    const sample = SAMPLES[index];
    if (!sample) return;
    setInputTab('paste');
    setHtmlFile(null);
    setCode(sample.code);
    setError(null);
  };

  const onHtmlFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.html')) {
      setError('Please choose an .html file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('HTML file exceeds the 5 MB limit.');
      return;
    }
    setHtmlFile(file);
    setCode(await file.text());
    setError(null);
  };

  const updateSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  const handleFrameExport = async () => {
    setError(null);
    try {
      const errors = validateSettings(settings);
      if (errors.length) throw new Error(errors.join(' '));
      if (effectiveMode === 'canvas') {
        const iframe = iframeRef.current;
        if (!iframe) throw new Error('Preview is not ready yet.');
        const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Preview frame timed out.')), 15_000);
          const handler = (event: MessageEvent) => {
            if (event.source !== iframe.contentWindow || event.data?.__code2video !== true || event.data.type !== 'frame') return;
            window.clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(event.data.bitmap as ImageBitmap);
          };
          window.addEventListener('message', handler);
          postBridgeMessage(iframe, 'drawFrame', { time: currentTime });
        });
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not create a 2D canvas context for PNG export.');
          context.drawImage(bitmap, 0, 0);
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode PNG.')), 'image/png'));
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'code2video-frame.png';
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } finally { bitmap.close(); }
      } else {
        const blob = await exportServerFrame(code, htmlFile, settings, currentTime);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'code2video-frame.png';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Frame export failed.');
    }
  };

  const handleRender = async () => {
    setError(null);
    setRendering(true);
    setProgress(null);
    setResultUrl(null);
    setResultSize(0);
    setResultLoop(null);
    setResultMode(null);
    setResultSettings(null);
    setServerJobId(null);
    cancelRef.current = false;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;

    try {
      const settingsErrors = validateSettings(settings);
      if (settingsErrors.length) throw new Error(settingsErrors.join(' '));
      if (effectiveMode === 'canvas') {
        if (!('VideoEncoder' in window) || !('VideoFrame' in window)) throw new Error('WebCodecs is not supported. Use Chrome/Edge or switch to Full page (server).');
        const iframe = iframeRef.current;
        if (!iframe) throw new Error('Preview iframe is not ready.');
        const startedAt = performance.now();
        setLocalFrameProgress({ done: 0, total: totalFrames, startedAt });
        const rendered = await renderCanvasInBrowser(iframe, settings, audioFile, {
          isCancelled: () => cancelRef.current,
          onProgress: (done, total, started) => setLocalFrameProgress({ done, total, startedAt: started }),
          onConsole: undefined,
          onWarning: (message) => setSourceWarning(message),
        });
        const url = URL.createObjectURL(rendered.blob);
        objectUrlRef.current = url;
        setResultUrl(url);
        setResultSize(rendered.blob.size);
        setResultLoop(rendered.loopCheck);
        setResultMode('canvas');
        setResultSettings({ ...settings });
      } else {
        const jobId = await createServerJob(code, htmlFile, audioFile, settings);
        setServerJobId(jobId);
        const status = await monitorServerJob(jobId, {
          isCancelled: () => cancelRef.current,
          onProgress: (next) => setProgress(next),
        });
        setResultUrl(serverVideoUrl(jobId));
        setResultSize(status.sizeBytes || 0);
        setResultLoop(status.loopCheck);
        setResultMode('server');
        setResultSettings({ ...settings });
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'Rendering failed.');
    } finally {
      setRendering(false);
    }
  };

  const handleCancel = async () => {
    cancelRef.current = true;
    if (serverJobId) await cancelServerJob(serverJobId).catch(() => undefined);
  };

  const downloadResult = () => {
    if (!resultUrl) return;
    const link = document.createElement('a');
    link.href = resultMode === 'server' && serverJobId ? `${resultUrl}${resultUrl.includes('?') ? '&' : '?'}download=1` : resultUrl;
    link.download = 'code2video.mp4';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">Code2Video Web</div>
          <div className="subtitle">Deterministic HTML / JavaScript animation → MP4</div>
        </div>
        <div className="pill">Max 4K · 120s</div>
      </header>

      <section className="section-card" aria-labelledby="input-title">
        <div className="section-heading"><span className="step">01</span><div><h2 id="input-title">Input</h2><p>Paste an animation or load a local HTML file.</p></div></div>
        <div className="tabs" role="tablist" aria-label="Input method">
          <button className={inputTab === 'paste' ? 'tab active' : 'tab'} onClick={() => setInputTab('paste')} role="tab" aria-selected={inputTab === 'paste'}>Paste code</button>
          <button className={inputTab === 'upload' ? 'tab active' : 'tab'} onClick={() => setInputTab('upload')} role="tab" aria-selected={inputTab === 'upload'}>Upload file</button>
        </div>
        {inputTab === 'paste' ? (
          <textarea className="code-input" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label="HTML animation code" />
        ) : (
          <label className="file-drop"><input type="file" accept=".html,text/html" onChange={(e) => void onHtmlFile(e.target.files?.[0])} /><strong>{htmlFile ? htmlFile.name : 'Choose an .html file'}</strong><span>5 MB maximum</span></label>
        )}
        <div className="sample-row">
          <span>Samples</span>
          {SAMPLES.map((sample, index) => <button key={sample.name} className="ghost-btn" onClick={() => loadSample(index)}>Load {sample.name}</button>)}
        </div>
      </section>

      <section className="section-card" aria-labelledby="preview-title">
        <div className="section-heading"><span className="step">02</span><div><h2 id="preview-title">Preview</h2><p>{detection.reason}</p></div></div>
        <div className="preview-frame">
          <iframe ref={iframeRef} title="Animation preview" sandbox="allow-scripts" srcDoc={srcDoc} />
        </div>
        <div className="preview-controls">
          <button className="primary-small" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause preview' : 'Play preview'}>{playing ? 'Pause' : 'Play'}</button>
          <input type="range" min="0" max={settings.duration} step="0.01" value={Math.min(currentTime, settings.duration)} onChange={(e) => { setPlaying(false); setCurrentTime(Number(e.target.value)); }} aria-label="Preview time" />
          <span className="time-label">{currentTime.toFixed(2)} / {settings.duration.toFixed(2)}s</span>
        </div>
        <div className="console-panel" aria-label="Animation console">
          <div className="console-head">Console <span>{consoleEntries.length} messages</span></div>
          <div className="console-body">
            {consoleEntries.length === 0 ? <div className="console-empty">Console output and JavaScript errors appear here.</div> : consoleEntries.map((entry, index) => <div className={`console-line ${entry.type}`} key={`${entry.time}-${index}`}><span>{entry.time}</span><strong>{entry.type}</strong><code>{entry.message}</code></div>)}
          </div>
        </div>
      </section>

      <section className="section-card" aria-labelledby="settings-title">
        <div className="section-heading"><span className="step">03</span><div><h2 id="settings-title">Settings</h2><p>Choose the exact export parameters.</p></div></div>
        <div className="settings-grid">
          <label>Resolution<select value={resolutionLabel(settings)} onChange={(e) => {
            const value = e.target.value;
            if (value === 'Custom') return;
            const map: Record<string, [number, number]> = { '1280 × 720 (HD)': [1280,720], '1920 × 1080 (Full HD)': [1920,1080], '2560 × 1440 (2K)': [2560,1440], '3840 × 2160 (4K)': [3840,2160] };
            const pair = map[value];
            if (pair) setSettings((s) => ({ ...s, width: pair[0], height: pair[1] }));
          }}><option>1280 × 720 (HD)</option><option>1920 × 1080 (Full HD)</option><option>2560 × 1440 (2K)</option><option>3840 × 2160 (4K)</option><option>Custom</option></select></label>
          <div className="custom-size"><label>Width<input type="number" min="160" max="3840" value={settings.width} onChange={(e) => updateSettings('width', Number(e.target.value))} /></label><label>Height<input type="number" min="90" max="2160" value={settings.height} onChange={(e) => updateSettings('height', Number(e.target.value))} /></label></div>
          <label>FPS<select value={settings.fps} onChange={(e) => updateSettings('fps', Number(e.target.value) as Settings['fps'])}><option value="24">24</option><option value="30">30</option><option value="60">60</option></select></label>
          <label>Duration (seconds)<input type="number" min="1" max="120" step="0.1" value={settings.duration} onChange={(e) => updateSettings('duration', Number(e.target.value))} /></label>
          <label>Quality<select value={settings.quality} onChange={(e) => updateSettings('quality', e.target.value as Settings['quality'])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label>Render mode<select value={settings.renderMode} onChange={(e) => updateSettings('renderMode', e.target.value as Settings['renderMode'])}><option value="auto">Auto</option><option value="canvas">Canvas (in-browser)</option><option value="server">Full page (server)</option></select></label>
        </div>
        <div className="detector-card"><div><strong>Recommended: {detection.recommendedMode === 'canvas' ? 'Canvas (in-browser)' : detection.recommendedMode === 'server' ? 'Full page (server)' : '—'}</strong><span>{detection.reason}</span></div><button className="ghost-btn" onClick={() => updateSettings('renderMode', detection.recommendedMode || 'server')}>Use recommendation</button></div>
        <label className="toggle-row"><input type="checkbox" checked={settings.loopCheck} onChange={(e) => updateSettings('loopCheck', e.target.checked)} /><span><strong>Loop check</strong><small>Compare draw(0) with draw(duration), downscaled to 160 × 90.</small></span></label>
        <label className="audio-picker">Optional audio <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} /> {audioFile ? <span>{audioFile.name}</span> : <span>No audio selected</span>}</label>
      </section>

      <section className="section-card render-card" aria-labelledby="render-title">
        <div className="section-heading"><span className="step">04</span><div><h2 id="render-title">Render</h2><p>Frames are rendered deterministically, never captured in real time.</p></div></div>
        {error && <div className="alert error" role="alert">{error}</div>}
        {sourceWarning && <div className="alert warn">{sourceWarning}</div>}
        {effectiveMode === 'canvas' && !('VideoEncoder' in window) && <div className="alert warn">WebCodecs is not available in this browser. Chrome/Edge is recommended, or switch to Full page (server).</div>}
        <button className="render-button" disabled={rendering || !code.trim()} onClick={() => void handleRender()}> {rendering ? 'Rendering…' : 'Render video'} </button>
        {rendering && <div className="progress-wrap"><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(100, percentage)}%` }} /></div><div className="progress-meta"><span>{Math.round(percentage)}% · {effectiveMode === 'canvas' ? `${localFrameProgress.done} / ${localFrameProgress.total} frames` : `${progress?.framesDone || 0} / ${progress?.totalFrames || totalFrames} frames`}</span><span>Elapsed {effectiveMode === 'canvas' ? formatSeconds(localFrameProgress.startedAt ? (performance.now() - localFrameProgress.startedAt) / 1000 : null) : formatSeconds(progress?.elapsedSeconds ?? null)} · ETA {effectiveMode === 'canvas' ? formatSeconds(localFrameProgress.done ? ((localFrameProgress.total - localFrameProgress.done) * ((performance.now() - localFrameProgress.startedAt) / 1000 / localFrameProgress.done)) : null) : formatSeconds(progress?.etaSeconds ?? null)}</span></div><button className="cancel-btn" onClick={() => void handleCancel()}>Cancel</button></div>}
        <button className="ghost-btn export-frame" onClick={() => void handleFrameExport()} disabled={rendering}>Export current frame as PNG</button>
      </section>

      <section className="section-card" aria-labelledby="result-title">
        <div className="section-heading"><span className="step">05</span><div><h2 id="result-title">Result</h2><p>Your finished MP4 and loop-check status.</p></div></div>
        {resultUrl ? <><video className="result-video" controls src={resultUrl} /> <div className="result-meta"><span>{resultSize ? formatBytes(resultSize) : 'Server-streamed MP4'}</span><span>{resolutionLabel(resultSettings || settings)}</span><span>{(resultSettings || settings).duration.toFixed(1)}s</span></div><button className="render-button" onClick={downloadResult}>Download MP4</button>{resultLoop && <div className={`loop-result ${resultLoop.passed ? 'ok' : 'bad'}`}><strong>{resultLoop.message}</strong><span>Mean absolute difference: {resultLoop.meanAbsoluteDifference.toFixed(2)} (threshold {resultLoop.threshold})</span></div>}</> : <div className="empty-result">Render a video to see the result here.</div>}
      </section>

      {(!detection.canvasDetected || !detection.drawDetected) && <section className="help-card"><h3>How to make Canvas mode deterministic</h3><p>Expose a global <code>window.draw(t)</code> function and render into a <code>&lt;canvas&gt;</code>. Use <code>t</code> as seconds from the start rather than frame-rate-dependent state.</p><pre>{`const canvas = document.querySelector('canvas');\nconst ctx = canvas.getContext('2d');\nconst TAU = Math.PI * 2;\nwindow.draw = (t) => {\n  const p = (t / 4) % 1; // 1 integer cycle per loop\n  ctx.clearRect(0, 0, canvas.width, canvas.height);\n  ctx.arc(640 + Math.cos(p * TAU) * 160, 360, 30, 0, TAU);\n  ctx.fill();\n};`}</pre></section>}

      <footer>Code2Video Web · sandboxed previews · deterministic export · no real-time capture</footer>
    </main>
  );
}
