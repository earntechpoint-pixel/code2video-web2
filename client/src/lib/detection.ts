import type { DetectionResult } from '../types';

export function detectRenderMode(code: string): DetectionResult {
  const normalized = code.replace(/<!--([\s\S]*?)-->/g, '').replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '$1');
  const canvasDetected = /<canvas\b/i.test(code);
  const drawDetected = /(?:window\.draw|globalThis\.draw)\s*=\s*function\b|(?:window\.draw|globalThis\.draw)\s*=\s*\([^)]*\)\s*=>|function\s+draw\s*\(/i.test(normalized);

  if (canvasDetected && drawDetected) {
    return {
      canvasDetected,
      drawDetected,
      recommendedMode: 'canvas',
      reason: 'A canvas and a global draw(t) function were detected. Browser rendering is deterministic and stays local.',
    };
  }

  if (code.trim()) {
    return {
      canvasDetected,
      drawDetected,
      recommendedMode: 'server',
      reason: drawDetected
        ? 'A draw(t) function was found without a detected canvas. Full-page rendering is safer.'
        : 'This looks like a DOM/CSS/SVG page or does not expose draw(t), so use server rendering.',
    };
  }

  return {
    canvasDetected: false,
    drawDetected: false,
    recommendedMode: null,
    reason: 'Add HTML code or upload an .html file to enable render-mode detection.',
  };
}
