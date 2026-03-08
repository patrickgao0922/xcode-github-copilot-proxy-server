import { z } from "zod";

// ── Anthropic input schema ─────────────────────────────────────────────────

const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ImageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.unknown(),
});

const ContentBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ImageBlockSchema,
]);

const AnthropicMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
});

export const AnthropicRequestSchema = z.object({
  model: z.string(),
  messages: z.array(AnthropicMessageSchema),
  system: z.string().optional(),
  max_tokens: z.number().int().positive(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  stop_sequences: z.array(z.string()).optional(),
});

export type AnthropicRequest = z.infer<typeof AnthropicRequestSchema>;

// ── OpenAI output types ────────────────────────────────────────────────────

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens: number;
  stream: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string[];
}

// ── Translation ────────────────────────────────────────────────────────────

function flattenContent(
  content: string | z.infer<typeof ContentBlockSchema>[]
): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      return "[image omitted]";
    })
    .join("");
}

export function anthropicToOpenai(req: AnthropicRequest): OpenAIChatRequest {
  const messages: OpenAIChatMessage[] = [];

  if (req.system) {
    messages.push({ role: "system", content: req.system });
  }

  for (const msg of req.messages) {
    messages.push({
      role: msg.role,
      content: flattenContent(msg.content),
    });
  }

  const out: OpenAIChatRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    stream: req.stream ?? true,
  };

  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.stop_sequences !== undefined && req.stop_sequences.length > 0) {
    out.stop = req.stop_sequences;
  }

  return out;
}
