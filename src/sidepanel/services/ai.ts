// ============================================================
// AI Provider Adapter with Tool-Use Support
// AI can call tools → we execute them → feed results back → loop
// ============================================================
import { getAIConfig } from '../../shared/storage';
import type { AIProviderConfig } from '../../shared/types';
import { toolsForAnthropic, toolsForOpenAI } from '../../shared/tools';
import type { ToolCall, ToolResult } from '../../shared/tools';

export interface AIMessage {
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface AIStreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  text?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
}

type OnEvent = (event: AIStreamEvent) => void;

export async function callAIWithTools(
  systemPrompt: string,
  messages: AIMessage[],
  executeTool: (call: ToolCall) => Promise<ToolResult>,
  onEvent: OnEvent,
  maxIterations: number = 25,
  signal?: AbortSignal,
): Promise<string> {
  const config = await getAIConfig();
  if (!config || !config.apiKey) {
    throw new Error('AI not configured. Go to Settings to add your API key.');
  }

  let fullText = '';
  let conversationMessages = [...messages];
  let iterations = 0;

  while (iterations < maxIterations) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    iterations++;

    let response: { text: string; toolCalls: ToolCall[]; stopReason?: string };

    if (config.type === 'anthropic') {
      response = await callAnthropicWithTools(config, systemPrompt, conversationMessages, signal);
    } else {
      response = await callOpenAIWithTools(config, systemPrompt, conversationMessages, signal);
    }

    // Emit any text
    if (response.text) {
      fullText += (fullText ? '\n' : '') + response.text;
      onEvent({ type: 'text', text: response.text });
    }

    // Detect max_tokens truncation
    if (response.stopReason === 'max_tokens' || response.stopReason === 'length') {
      onEvent({ type: 'text', text: '\n\n⚠️ *Response was truncated due to token limit. The AI may have been cut off mid-sentence.*' });
    }

    // If no tool calls, we're done
    if (response.toolCalls.length === 0) {
      onEvent({ type: 'done' });
      return fullText;
    }

    // Execute tool calls
    const toolResults: ToolResult[] = [];
    for (const call of response.toolCalls) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onEvent({ type: 'tool_call', toolCall: call });
      const result = await executeTool(call);
      toolResults.push(result);
      onEvent({ type: 'tool_result', toolResult: result });
    }

    // Add assistant message + tool results to conversation
    conversationMessages.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
    });
    conversationMessages.push({
      role: 'tool_result',
      content: '',
      toolCalls: response.toolCalls, // carry IDs for message builders
      toolResults,
    });
  }

  // Max iterations reached — warn user instead of silent exit
  onEvent({ type: 'text', text: `\n\n⚠️ *Reached maximum tool call limit (${maxIterations} iterations). You can continue the conversation to pick up where I left off.*` });
  onEvent({ type: 'done' });
  return fullText;
}

// ---- Anthropic with tools ----
async function callAnthropicWithTools(
  config: AIProviderConfig,
  systemPrompt: string,
  messages: AIMessage[],
  signal?: AbortSignal,
): Promise<{ text: string; toolCalls: ToolCall[]; stopReason?: string }> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/messages`;

  const apiMessages = buildAnthropicMessages(messages);

  const body: any = {
    model: config.model,
    max_tokens: config.maxTokens ?? 8192,
    system: systemPrompt,
    messages: apiMessages,
    tools: toolsForAnthropic(),
  };

  if (config.temperature !== undefined) body.temperature = config.temperature;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(classifyApiError('Anthropic', resp.status, errorText));
  }

  const data = await resp.json();

  let text = '';
  const toolCalls: ToolCall[] = [];
  const stopReason = data.stop_reason; // 'end_turn', 'tool_use', 'max_tokens'

  for (const block of data.content || []) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: block.input || {},
      });
    }
  }

  return { text, toolCalls, stopReason };
}

function buildAnthropicMessages(messages: AIMessage[]): any[] {
  const result: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const content: any[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.args,
          });
        }
      }
      result.push({ role: 'assistant', content });
    } else if (msg.role === 'tool_result') {
      if (msg.toolResults && msg.toolCalls) {
        const content = msg.toolResults.map((tr, i) => {
          const toolUseId = msg.toolCalls![i]?.id || tr.toolCallId || `unknown_${i}`;
          const imgUrl = extractImageDataUrl(tr.result);
          if (imgUrl) {
            // Multimodal: include image in tool_result content array
            const base64 = imgUrl.replace(/^data:image\/\w+;base64,/, '');
            const mediaType = imgUrl.match(/^data:(image\/\w+);/)?.[1] || 'image/png';
            return {
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                { type: 'text', text: JSON.stringify(stripImageData(tr.result)).slice(0, 4000) },
              ],
            };
          }
          return {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify(tr.result).slice(0, 4000),
          };
        });
        result.push({ role: 'user', content });
      } else if (msg.toolResults) {
        const content = msg.toolResults.map((tr, i) => ({
          type: 'tool_result',
          tool_use_id: tr.toolCallId || `unknown_${i}`,
          content: JSON.stringify(tr.result).slice(0, 4000),
        }));
        result.push({ role: 'user', content });
      }
    }
  }

  return result;
}

// ---- OpenAI / OpenAI-compatible with tools ----
async function callOpenAIWithTools(
  config: AIProviderConfig,
  systemPrompt: string,
  messages: AIMessage[],
  signal?: AbortSignal,
): Promise<{ text: string; toolCalls: ToolCall[]; stopReason?: string }> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const apiMessages = buildOpenAIMessages(systemPrompt, messages);

  const body: any = {
    model: config.model,
    messages: apiMessages,
    tools: toolsForOpenAI(),
  };

  if (config.maxTokens) body.max_tokens = config.maxTokens;
  else body.max_tokens = 8192;
  if (config.temperature !== undefined) body.temperature = config.temperature;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(classifyApiError('OpenAI', resp.status, errorText));
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content || '';
  const stopReason = choice?.finish_reason; // 'stop', 'tool_calls', 'length'
  const toolCalls: ToolCall[] = [];

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      try {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments || '{}'),
        });
      } catch {
        // skip malformed tool calls
      }
    }
  }

  return { text, toolCalls, stopReason };
}

function buildOpenAIMessages(systemPrompt: string, messages: AIMessage[]): any[] {
  const result: any[] = [{ role: 'system', content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const m: any = { role: 'assistant', content: msg.content || null };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        m.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      result.push(m);
    } else if (msg.role === 'tool_result') {
      const toolResults = msg.toolResults || [];
      const toolCalls = msg.toolCalls || [];
      const pendingImages: string[] = [];

      for (let i = 0; i < toolResults.length; i++) {
        const tr = toolResults[i];
        const imgUrl = extractImageDataUrl(tr.result);
        if (imgUrl) pendingImages.push(imgUrl);
        result.push({
          role: 'tool',
          tool_call_id: toolCalls[i]?.id || tr.toolCallId || `unknown_${i}`,
          content: JSON.stringify(stripImageData(tr.result)).slice(0, 4000),
        });
      }

      // OpenAI: tool role can't carry images, so inject as a follow-up user message
      if (pendingImages.length > 0) {
        const imageContent: any[] = pendingImages.map(url => ({
          type: 'image_url',
          image_url: { url, detail: 'high' },
        }));
        imageContent.push({ type: 'text', text: 'Above is the screenshot from the tool result. Analyze it to answer the query.' });
        result.push({ role: 'user', content: imageContent });
      }
    }
  }

  return result;
}

function classifyApiError(provider: string, status: number, body: string): string {
  const short = body.slice(0, 200);
  if (status === 401) return `Invalid API key. Check your ${provider} key in Settings.`;
  if (status === 403) return `Access denied by ${provider}. Your key may lack permissions.`;
  if (status === 429) return `Rate limited by ${provider}. Wait a moment and try again.`;
  if (status === 404) return `Model not found. Check the model name in Settings.`;
  if (status === 400 && /context.*length|too.*long|token/i.test(body)) return `Conversation too long for this model. Start a new chat or use a model with more context.`;
  if (status === 400) return `${provider} rejected the request: ${short}`;
  if (status === 500 || status === 502 || status === 503) return `${provider} server error (${status}). Try again later.`;
  return `${provider} error (${status}): ${short}`;
}

// ---- Multimodal helpers ----

/** Extract __imageDataUrl from a tool result (nested in result or at top level) */
function extractImageDataUrl(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as any;
  // Direct field
  if (r.__imageDataUrl) return r.__imageDataUrl;
  // Nested in .result (from INJECT_JS wrapper)
  if (r.result?.__imageDataUrl) return r.result.__imageDataUrl;
  // dataUrl field from screenshot tools
  if (r.dataUrl && typeof r.dataUrl === 'string' && r.dataUrl.startsWith('data:image/')) return r.dataUrl;
  if (r.result?.dataUrl && typeof r.result.dataUrl === 'string' && r.result.dataUrl.startsWith('data:image/')) return r.result.dataUrl;
  return undefined;
}

/** Strip large base64 image data from result before serializing to JSON text */
function stripImageData(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = { ...(result as any) };
  if (r.__imageDataUrl) { r.__imageDataUrl = '[image included above]'; }
  if (r.dataUrl && typeof r.dataUrl === 'string' && r.dataUrl.startsWith('data:image/')) {
    r.dataUrl = `[image:${r.dataUrl.length} bytes]`;
  }
  if (r.result && typeof r.result === 'object') {
    r.result = stripImageData(r.result);
  }
  return r;
}
