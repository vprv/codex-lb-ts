/**
 * Adapter for Cherry Studio and other OpenAI Chat Completions clients.
 * Converts Chat Completions API requests/responses to/from Codex Responses API format.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface ChatCompletionsBody {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface CodexRequestBody {
  model: string;
  instructions?: string;
  input: Array<{
    role: string;
    content: Array<{ type: string; text: string }>;
  }>;
  store: boolean;
  stream: boolean;
}

/**
 * Converts OpenAI Chat Completions format to Codex Responses API format.
 */
export function chatCompletionsToCodex(body: ChatCompletionsBody): CodexRequestBody {
  const messages = body.messages ?? [];
  let instructions = "";
  const input: CodexRequestBody["input"] = [];

  for (const msg of messages) {
    const content = extractTextContent(msg.content);
    if (msg.role === "system") {
      instructions = instructions ? `${instructions}\n\n${content}` : content;
    } else {
      const role = msg.role === "assistant" ? "assistant" : "user";
      input.push({
        role,
        content: [{ type: "input_text", text: content }]
      });
    }
  }

  return {
    model: body.model,
    instructions: instructions || "You are a helpful assistant.",
    input,
    store: false,
    stream: body.stream ?? true
  };
}

function extractTextContent(
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "input_text" && typeof (part as { text?: string }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

/**
 * Transcodes Responses API SSE stream to Chat Completions SSE format.
 * Parses incoming SSE events and emits Chat Completions-compatible data lines.
 */
export function createResponseTranscoder(responseId: string): TransformStream<Uint8Array, Uint8Array> {
  let buffer = "";
  const state = { chatId: `chatcmpl-${responseId || crypto.randomUUID().slice(0, 24)}` };

  return new TransformStream({
    transform(chunk, controller) {
      buffer += new TextDecoder().decode(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line?.startsWith("event:")) continue;
        {
          const eventType = line.slice(6).trim();
          const dataLine = lines[i + 1];
          if (dataLine?.startsWith("data:")) {
            const dataStr = dataLine.slice(5).trim();
            if (dataStr === "[DONE]") continue;

            try {
              const data = JSON.parse(dataStr) as Record<string, unknown>;
              if (eventType === "response.created" && typeof data.id === "string") {
                state.chatId = `chatcmpl-${data.id.slice(-24)}`;
              }
              const out = transcodeEvent(eventType, data, state.chatId);
              if (out) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(out)}\n\n`));
              }
            } catch {
              // Pass through non-JSON or malformed data
            }
            i++;
          }
        }
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        const lines = buffer.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line?.startsWith("event:")) continue;
          {
            const eventType = line.slice(6).trim();
            const dataLine = lines[i + 1];
            if (dataLine?.startsWith("data:")) {
              const dataStr = dataLine.slice(5).trim();
              if (dataStr !== "[DONE]") {
                try {
                  const data = JSON.parse(dataStr) as Record<string, unknown>;
                  if (eventType === "response.created" && typeof data.id === "string") {
                    state.chatId = `chatcmpl-${data.id.slice(-24)}`;
                  }
                  const out = transcodeEvent(eventType, data, state.chatId);
                  if (out) {
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(out)}\n\n`));
                  }
                } catch {
                  /* ignore */
                }
              }
              i++;
            }
          }
        }
      }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    }
  });
}

function transcodeEvent(
  eventType: string,
  data: Record<string, unknown>,
  chatId: string
): Record<string, unknown> | null {
  if (eventType === "response.output_text.delta") {
    const delta = typeof data.delta === "string" ? data.delta : "";
    return {
      id: chatId,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
    };
  }
  if (eventType === "response.completed" || eventType === "response.output_text.done") {
    return {
      id: chatId,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
    };
  }
  return null;
}
