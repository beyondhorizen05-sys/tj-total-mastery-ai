import React from 'react';

export class WebGLBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

let cachedWebGL: boolean | null = null;
export function canRenderWebGL(): boolean {
  if (cachedWebGL !== null) return cachedWebGL;
  try {
    const canvas = document.createElement('canvas');
    cachedWebGL = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch { cachedWebGL = false; }
  return cachedWebGL;
}
