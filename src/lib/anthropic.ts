import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export const MODEL = "claude-sonnet-4-5";

// Extracts the first JSON object/array found in a model response.
export function extractJson<T = any>(text: string): T {
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  const jsonStr = match ? match[1] || match[0] : text;
  return JSON.parse(jsonStr);
}
