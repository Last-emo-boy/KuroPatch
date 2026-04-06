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
  maxIterations: number = 10,
): Promise<string> {
  const config = await getAIConfig();
  if (!config || !config.apiKey) {
    throw new Error('AI not configured. Go to Settings to add your API key.');
  }

  let fullText = '';
  let conversationMessages = [...messages];
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    let response: { text: string; toolCalls: ToolCall[] };

    if (config.type === 'anthropic') {
      response = await callAnthropicWithTools(config, systemPrompt, conversationMessages);
    } else {
      response = await callOpenAIWithTools(config, systemPrompt, conversationMessages);
    }

    // Emit any text
    if (response.text) {
      fullText += (fullText ? '\n' : '') + response.text;
      onEvent({ type: 'text', text: response.text });
    }

    // If no tool calls, we're done
    if (response.toolCalls.length === 0) {
      onEvent({ type: 'done' });
      return fullText;
    }

    // Execute tool calls
    const toolResults: ToolResult[] = [];
    for (const call of response.toolCalls) {
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

  onEvent({ type: 'done' });
  return fullText;
}

// ---- Anthropic with tools ----
async function callAnthropicWithTools(
  config: AIProviderConfig,
  systemPrompt: string,
  messages: AIMessage[],
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/messages`;

  const apiMessages = buildAnthropicMessages(messages);

  const body: any = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
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
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Anthropic API error (${resp.status}): ${errorText}`);
  }

  const data = await resp.json();

  let text = '';
  const toolCalls: ToolCall[] = [];

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

  return { text, toolCalls };
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
        const content = msg.toolResults.map((tr, i) => ({
          type: 'tool_result',
          tool_use_id: msg.toolCalls![i]?.id || tr.toolCallId || `unknown_${i}`,
          content: JSON.stringify(tr.result).slice(0, 4000),
        }));
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
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const apiMessages = buildOpenAIMessages(systemPrompt, messages);

  const body: any = {
    model: config.model,
    messages: apiMessages,
    tools: toolsForOpenAI(),
  };

  if (config.maxTokens) body.max_tokens = config.maxTokens;
  if (config.temperature !== undefined) body.temperature = config.temperature;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`OpenAI API error (${resp.status}): ${errorText}`);
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content || '';
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

  return { text, toolCalls };
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
      if (msg.toolResults && msg.toolCalls) {
        for (let i = 0; i < msg.toolResults.length; i++) {
          const tr = msg.toolResults[i];
          result.push({
            role: 'tool',
            tool_call_id: msg.toolCalls[i]?.id || tr.toolCallId || `unknown_${i}`,
            content: JSON.stringify(tr.result).slice(0, 4000),
          });
        }
      } else if (msg.toolResults) {
        for (let i = 0; i < msg.toolResults.length; i++) {
          const tr = msg.toolResults[i];
          result.push({
            role: 'tool',
            tool_call_id: tr.toolCallId || `unknown_${i}`,
            content: JSON.stringify(tr.result).slice(0, 4000),
          });
        }
      }
    }
  }

  return result;
}
