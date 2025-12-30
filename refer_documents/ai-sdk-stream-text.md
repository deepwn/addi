# AI SDK Stream Text
(Content from https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)

## API Signature

```typescript
import { streamText } from "ai"

const result = streamText({
  model: openai('gpt-4'),
  messages: messages,
});

for await (const textPart of result.textStream) {
  process.stdout.write(textPart);
}
```

### Parameters
- `model`: LanguageModel
- `messages`: Array of messages
- `tools`: Tools definition
- `onChunk`: Callback for chunks
- `onFinish`: Callback for finish

### Returns
- `textStream`: AsyncIterableStream<string>
- `fullStream`: AsyncIterable<TextStreamPart>
- `usage`: Promise<LanguageModelUsage>
