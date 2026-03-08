import { mapFinishReason } from "./openaiToAnthropic.js";

/**
 * Async generator that reads an OpenAI SSE stream and yields
 * Anthropic-format SSE event strings.
 *
 * Each yielded string is a complete SSE block (ready to write to reply.raw).
 */
export async function* translateOpenAIToAnthropicSSE(
  body: ReadableStream<Uint8Array>,
  messageId: string,
  model: string
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let hasEmittedStart = false;
  let contentIndex = 0;

  function sseBlock(eventType: string, data: unknown): string {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    lineBuffer += decoder.decode(chunk, { stream: true });

    const lines = lineBuffer.split("\n");
    // Keep incomplete last line in buffer
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      } catch {
        continue;
      }

      const choices = parsed["choices"] as Array<Record<string, unknown>> | undefined;
      const choice = choices?.[0];
      if (!choice) continue;

      const delta = choice["delta"] as Record<string, unknown> | undefined;
      const deltaContent = delta?.["content"];
      const finishReason = choice["finish_reason"] as string | null | undefined;

      // Emit preamble events before first content
      if (!hasEmittedStart) {
        hasEmittedStart = true;

        yield sseBlock("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });

        yield sseBlock("content_block_start", {
          type: "content_block_start",
          index: contentIndex,
          content_block: { type: "text", text: "" },
        });

        yield sseBlock("ping", { type: "ping" });
      }

      // Emit text delta
      if (typeof deltaContent === "string" && deltaContent.length > 0) {
        yield sseBlock("content_block_delta", {
          type: "content_block_delta",
          index: contentIndex,
          delta: { type: "text_delta", text: deltaContent },
        });
      }

      // Emit finish events
      if (finishReason != null && finishReason !== "") {
        const usage = parsed["usage"] as Record<string, unknown> | undefined;

        yield sseBlock("content_block_stop", {
          type: "content_block_stop",
          index: contentIndex,
        });

        yield sseBlock("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: mapFinishReason(finishReason),
            stop_sequence: null,
          },
          usage: {
            output_tokens: Number(usage?.["completion_tokens"] ?? 0),
          },
        });

        yield sseBlock("message_stop", { type: "message_stop" });
      }
    }
  }

  // Handle any remaining buffer content
  if (lineBuffer.trim().startsWith("data:")) {
    const jsonStr = lineBuffer.trim().slice(5).trim();
    if (jsonStr && jsonStr !== "[DONE]") {
      // Attempt parse — ignore on failure
      try {
        JSON.parse(jsonStr);
      } catch {
        // ignore
      }
    }
  }

  // Ensure we always close gracefully if stream ended without finish_reason
  if (hasEmittedStart) {
    yield sseBlock("content_block_stop", {
      type: "content_block_stop",
      index: contentIndex,
    });
    yield sseBlock("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 0 },
    });
    yield sseBlock("message_stop", { type: "message_stop" });
  }
}

/**
 * Async generator that reads an OpenAI SSE stream and yields
 * OpenAI Responses API format SSE event strings.
 */
export async function* translateOpenAIToResponsesSSE(
  body: ReadableStream<Uint8Array>,
  responseId: string,
  model: string
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let hasEmittedStart = false;
  let outputIndex = 0;

  function sseBlock(eventType: string, data: unknown): string {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    lineBuffer += decoder.decode(chunk, { stream: true });

    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      } catch {
        continue;
      }

      const choices = parsed["choices"] as Array<Record<string, unknown>> | undefined;
      const choice = choices?.[0];
      if (!choice) continue;

      const delta = choice["delta"] as Record<string, unknown> | undefined;
      const deltaContent = delta?.["content"];
      const finishReason = choice["finish_reason"] as string | null | undefined;

      if (!hasEmittedStart) {
        hasEmittedStart = true;

        yield sseBlock("response.created", {
          type: "response.created",
          response: {
            id: responseId,
            object: "realtime.response",
            model,
            output: [],
            status: "in_progress",
          },
        });

        yield sseBlock("response.output_item.added", {
          type: "response.output_item.added",
          response_id: responseId,
          output_index: outputIndex,
          item: {
            id: `item_${outputIndex}`,
            object: "realtime.item",
            type: "message",
            role: "assistant",
            content: [],
          },
        });
      }

      if (typeof deltaContent === "string" && deltaContent.length > 0) {
        yield sseBlock("response.text.delta", {
          type: "response.text.delta",
          response_id: responseId,
          output_index: outputIndex,
          content_index: 0,
          delta: deltaContent,
        });
      }

      if (finishReason != null && finishReason !== "") {
        const usage = parsed["usage"] as Record<string, unknown> | undefined;

        yield sseBlock("response.text.done", {
          type: "response.text.done",
          response_id: responseId,
          output_index: outputIndex,
          content_index: 0,
        });

        yield sseBlock("response.output_item.done", {
          type: "response.output_item.done",
          response_id: responseId,
          output_index: outputIndex,
        });

        yield sseBlock("response.completed", {
          type: "response.completed",
          response: {
            id: responseId,
            object: "realtime.response",
            model,
            status: "completed",
            usage: {
              input_tokens: Number(usage?.["prompt_tokens"] ?? 0),
              output_tokens: Number(usage?.["completion_tokens"] ?? 0),
              total_tokens: Number(usage?.["total_tokens"] ?? 0),
            },
          },
        });
      }
    }
  }
}
