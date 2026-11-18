import type { Provider } from "@/lib/types";
import "./provider-brand.css";

const brands: Record<string, [file: string, color: string, background: string]> = {
  openai: ["openai", "#fafafa", "#292b32"],
  anthropic: ["anthropic", "#efb797", "#342624"],
  gemini: ["gemini-color", "", "#27283b"],
  groq: ["groq", "#ff9277", "#382829"],
  deepseek: ["deepseek", "#7fa1ff", "#20283f"],
  together: ["together", "#76adff", "#212b41"],
  mistral: ["mistral-color", "", "#352a21"],
  dashscope: ["qwen", "#bea9ff", "#302943"],
  openrouter: ["openrouter", "#d3c7f4", "#292638"],
  ollama: ["ollama", "#eeeaf8", "#2b2932"],
  veo: ["google-color", "", "#272b36"],
  sora: ["sora", "#eeeaf8", "#2b2932"],
  runway: ["runway", "#eeeaf8", "#2b2932"],
  kling: ["kling", "#96c1ff", "#222d3c"],
  luma: ["luma", "#d1b9fa", "#30293c"],
  pika: ["pika", "#ead197", "#352e24"],
  fal: ["fal", "#e6acfc", "#32253c"],
  hailuo: ["hailuo", "#f3ae9f", "#392825"],
};

export function Brand({ provider }: { provider: Provider }) {
  const brand = brands[provider.name] ?? (provider.adapter === "ollama" ? brands.ollama : undefined);
  if (!brand) return <span className="pv-brand pv-custom" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.1M7 16.5h.1" /></svg></span>;
  const [file, color, backgroundColor] = brand;
  const url = `/provider-icons/${file}.svg`;
  const style = color
    ? { backgroundColor: color, maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` }
    : { backgroundImage: `url(${url})` };
  return <span className="pv-brand" style={{ backgroundColor }} aria-hidden="true"><span style={style} /></span>;
}
