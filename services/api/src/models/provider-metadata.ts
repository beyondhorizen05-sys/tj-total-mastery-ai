/** Read factual model-catalog metadata; absent fields remain unknown. */
export function openRouterModelMetadata(m: any): {
  price_in_per_m: number | null;
  price_out_per_m: number | null;
  modalities: Array<'text' | 'image' | 'audio' | 'video'> | undefined;
  supports_streaming: boolean | undefined;
} {
  const price = (value: unknown): number | null => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null;
  };
  const inputs: unknown = m?.architecture?.input_modalities;
  const modalities = Array.isArray(inputs)
    ? inputs.filter((value): value is 'text' | 'image' | 'audio' | 'video' =>
      value === 'text' || value === 'image' || value === 'audio' || value === 'video') : undefined;
  return {
    price_in_per_m: price(m?.pricing?.prompt),
    price_out_per_m: price(m?.pricing?.completion),
    modalities,
    // The catalog does not consistently advertise streaming capability.
    supports_streaming: undefined,
  };
}
