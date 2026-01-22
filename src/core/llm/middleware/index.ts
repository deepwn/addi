import { ModelMessage } from 'ai';
import { Provider, Model } from '../../../common/types';

export interface LLMCallContext {
  provider: Provider;
  modelId: string;
  model?: Model;
  requestId?: string;
}

export interface LLMMiddleware {
  /**
   * Executed before the LLM call. Can modify messages or system instructions.
   */
  processMessages?(
    messages: ModelMessage[],
    context: LLMCallContext
  ): Promise<{ messages: ModelMessage[]; system?: string }>;

  /**
   * Executed during stream processing to modify or filter response parts.
   */
  processResponsePart?(part: any, context: LLMCallContext): any;
}
