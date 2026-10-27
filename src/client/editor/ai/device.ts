/**
 * The browser's side of the model choice: probes that fill a `Device`
 * (models.ts). Each sends nothing anywhere: `LanguageModel.availability()`
 * and `navigator.gpu.requestAdapter()` are local questions.
 */
import type { DeviceHints, Gpu } from './models';

interface GpuAdapterLike {
  features: { has(name: string): boolean };
  /** A software adapter (SwiftShader): far too slow for a language model. */
  isFallbackAdapter?: boolean;
  info?: { isFallbackAdapter?: boolean; architecture?: string };
}

interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}

let gpuProbe: Promise<Gpu> | null = null;

/** WebGPU on this device, asked once per page (an adapter request is not free). */
export function probeGpu(): Promise<Gpu> {
  gpuProbe ??= (async (): Promise<Gpu> => {
    const gpu = (navigator as { gpu?: GpuLike }).gpu;
    if (gpu === undefined || typeof gpu.requestAdapter !== 'function') {
      return 'none';
    }
    try {
      const adapter = await gpu.requestAdapter();
      if (
        adapter === null ||
        adapter.isFallbackAdapter === true ||
        adapter.info?.isFallbackAdapter === true ||
        adapter.info?.architecture === 'swiftshader'
      ) {
        return 'no-adapter';
      }
      return adapter.features.has('shader-f16') ? 'f16' : 'f32';
    } catch {
      return 'no-adapter';
    }
  })();
  return gpuProbe;
}

export function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
    deviceMemory?: number;
  };
  return {
    mobile: nav.userAgentData?.mobile,
    memory: nav.deviceMemory,
    screen: { width: screen.width, height: screen.height },
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
  };
}
