// Capacidad aproximada, sin confundir la versión de un modelo con sus parámetros.
export const SMALL_MODEL_WARNING = 'This model is small and often confuses tasks. Recommended: Qwen 3.5 9B or larger.';
export function modelCapacity(name, metadata = {}) {
  const named = String(name || '').match(/(?:^|[:/_-])(\d+(?:\.\d+)?)\s*b(?:$|[:/_-])/i);
  if (named) return { billions: Number(named[1]), source: 'nombre' };
  const params = String(metadata.parameterSize || '').match(/^\s*(\d+(?:\.\d+)?)\s*([bm])\s*$/i);
  if (params) return { billions: Number(params[1]) / (params[2].toLowerCase() === 'm' ? 1000 : 1), source: 'parámetros' };
  const quant = String(metadata.quantization || '').toUpperCase();
  const bits = /^Q([2-8])(?:_|$)/.exec(quant)?.[1] || ({ F16: 16, FP16: 16, BF16: 16, F32: 32, FP32: 32, NVFP4: 4 })[quant];
  // Un archivo quantizado no equivale a un número de parámetros. Con formato
  // conocido estimamos un límite superior (incluye metadatos); sin él, no adivinamos.
  if (bits && Number.isFinite(metadata.size) && metadata.size > 0) return { billions: metadata.size * 8 / Number(bits) / 1e9, source: 'tamaño estimado' };
  return null;
}
export function smallModelWarning(name, metadata) {
  const capacity = modelCapacity(name, metadata);
  return capacity && capacity.billions < 7 ? SMALL_MODEL_WARNING : '';
}
