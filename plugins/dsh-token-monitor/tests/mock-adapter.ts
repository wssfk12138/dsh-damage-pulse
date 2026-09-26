import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'

type Response = StreamChunk[] | (() => StreamChunk[])

export interface MockAdapterOptions {
  efforts?: readonly { id: ReasoningEffortId; name: string }[]
  defaultEffort?: ReasoningEffortId
}

/** Minimal provider adapter used by the composition test to exercise the real host stack. */
export class MockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly responses: Response[]
  private readonly options: MockAdapterOptions

  constructor(responses: Response[], options: MockAdapterOptions = {}) {
    super()
    this.responses = [...responses]
    this.options = options
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: this.options.efforts
        ? { efforts: this.options.efforts, defaultEffort: this.options.defaultEffort }
        : undefined,
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.responses.shift()
    const chunks = typeof response === 'function' ? response() : response
    if (!chunks) throw new Error('MockAdapter ran out of scripted responses')
    yield* chunks
  }
}

export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

export function toolCallResponse(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const callId = ToolCallId(id)
  const argumentsText = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsText } },
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
