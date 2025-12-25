# AI SDK Provider Management
(Content from https://ai-sdk.dev/docs/ai-sdk-core/provider-management)

## Custom Providers
You can create a custom provider using `customProvider`.

### Example: custom model settings
```typescript
import {
  gateway,
  customProvider,
  defaultSettingsMiddleware,
  wrapLanguageModel,
} from 'ai';

export const openai = customProvider({
  languageModels: {
    'gpt-5.1': wrapLanguageModel({
      model: gateway('openai/gpt-5.1'),
      middleware: defaultSettingsMiddleware({
        settings: {
          providerOptions: {
            openai: {
              reasoningEffort: 'high',
            },
          },
        },
      }),
    }),
  },
  fallbackProvider: gateway,
});
```

## Provider Registry
You can create a provider registry with multiple providers and models using `createProviderRegistry`.

### Setup
```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createProviderRegistry, gateway } from 'ai';

export const registry = createProviderRegistry({
  gateway,
  anthropic,
  openai,
});
```

### Example: Use language models
```typescript
import { generateText } from 'ai';
import { registry } from './registry';

const { text } = await generateText({
  model: registry.languageModel('openai:gpt-5.1'),
  prompt: 'Invent a new holiday and describe its traditions.',
});
```
