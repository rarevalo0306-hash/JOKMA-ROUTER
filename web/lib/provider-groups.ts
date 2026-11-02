import type { Provider } from "./types.ts";

export const CHAT_PRESET_NAMES = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "deepseek",
  "together",
  "mistral",
  "dashscope",
  "openrouter",
] as const;

export const VIDEO_PRESET_NAMES = [
  "veo",
  "sora",
  "runway",
  "kling",
  "luma",
  "pika",
  "fal",
  "hailuo",
] as const;

const CHAT = new Set<string>(CHAT_PRESET_NAMES);
const VIDEO = new Set<string>(VIDEO_PRESET_NAMES);

export function providerTitle(provider: Provider): string {
  return provider.label?.trim() || provider.name;
}

export function isVideoProvider(provider: Provider): boolean {
  return provider.kind === "video" || provider.adapter === "video" || VIDEO.has(provider.name);
}

export function groupProviders(providers: Provider[]): {
  chat: Provider[];
  video: Provider[];
  rest: Provider[];
} {
  const byName = new Map(providers.map((provider) => [provider.name, provider]));
  const chat = CHAT_PRESET_NAMES.map((name) => byName.get(name)).filter(
    (provider): provider is Provider => provider !== undefined && !isVideoProvider(provider),
  );
  const video = VIDEO_PRESET_NAMES.map((name) => byName.get(name)).filter(
    (provider): provider is Provider => provider !== undefined,
  );
  const used = new Set<string>([...chat, ...video].map((provider) => provider.name));
  const rest = providers.filter((provider) => !used.has(provider.name) && !CHAT.has(provider.name) && !VIDEO.has(provider.name));
  return { chat, video, rest };
}

export function chatRoutableProviders(providers: Provider[]): Provider[] {
  return providers.filter((provider) => !isVideoProvider(provider));
}
