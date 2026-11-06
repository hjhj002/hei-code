/** 对话消息 */
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

/** AI 回复的流式回调 */
export interface StreamCallbacks {
    /** 每收到一段文字就调用 */
    onChunk: (chunk: string) => void;
    /** 流结束 */
    onDone: (fullText: string) => void;
    /** 出错 */
    onError: (error: Error) => void;
  }

/** AI Provider 统一接口 */
export interface AIProvider {
    /** Provider 名称 */
    readonly name: string;
  
    /**
     * 流式对话
     * @param messages 完整对话历史
     * @param callbacks 流式回调
     * @param signal 中断信号（可选）
     */
    chat(
      messages: ChatMessage[],
      callbacks: StreamCallbacks,
      signal?: AbortSignal,
    ): Promise<void>;
  }
  