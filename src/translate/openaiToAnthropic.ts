// ── Anthropic stop_reason mapping ─────────────────────────────────────────

type AnthropicStopReason = "end_turn" | "max_tokens" | "tool_use" | "stop_sequence";

function mapFinishReason(openaiReason: string | null | undefined): AnthropicStopReason {
  switch (openaiReason) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    default: return "end_turn";
  }
}

// ── Non-streaming translation ──────────────────────────────────────────────

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<{ type: "text"; text: string }>;
  stop_reason: AnthropicStopReason;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export function openaiToAnthropic(
  openaiResponse: Record<string, unknown>
): AnthropicResponse {
  const choices = openaiResponse["choices"] as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const message = choice?.["message"] as Record<string, unknown> | undefined;
  const content = String(message?.["content"] ?? "");
  const finishReason = choice?.["finish_reason"] as string | null | undefined;

  const usage = openaiResponse["usage"] as Record<string, unknown> | undefined;

  return {
    id: String(openaiResponse["id"] ?? `msg_${Date.now()}`),
    type: "message",
    role: "assistant",
    model: String(openaiResponse["model"] ?? ""),
    content: [{ type: "text", text: content }],
    stop_reason: mapFinishReason(finishReason),
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage?.["prompt_tokens"] ?? 0),
      output_tokens: Number(usage?.["completion_tokens"] ?? 0),
    },
  };
}

export { mapFinishReason };
