# hei-code 开发路线图（重写版）

> 目标：从 0 到 1，用 TypeScript + Ink(React) 实现一个 Claude Code 风格的终端编程智能体。
> 本质 = 大模型 API + 工具调用 + 自己写的 agent 循环。
>
> **与旧版的区别**：旧版主线基于 `@anthropic-ai/sdk`；新版按仓库现状重写——`.env` 指向
> SiliconFlow（OpenAI 兼容协议）+ Qwen，主线改为 **fetch 手写 SSE 对接 OpenAI 兼容协议**，
> Anthropic 协议作为可选里程碑。两者都挂在同一个 `AIProvider` 接口下（`src/ai/types.d.ts` 已定义）。

## 技术栈与现状

| 层 | 选型 |
|---|---|
| 语言/运行时 | TypeScript + Node 18+，`tsx` 直接运行（`pnpm start` / `pnpm dev`） |
| 终端 UI | Ink（用 React 写终端界面） |
| AI 接入 | 自写 `AIProvider` 抽象 + 工厂，`.env` 的 `AI_PROVIDER` 切换 mock / openai / anthropic |
| 模型服务 | SiliconFlow `https://api.siliconflow.cn/v1`（OpenAI 兼容），同套代码换 key 也能接 DeepSeek 官方 API |

`.env` 已有字段：`OPENAI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`、`AI_PROVIDER=mock`。

## 总路线图

| 里程碑 | 目标 | 核心概念 |
|---|---|---|
| 0. 底座 ✅ | Ink UI 壳 + AIProvider 接口定义 | 组件、依赖倒置 |
| 1. Mock Provider | 不联网跑通 UI → AI 链路 | 工厂模式、流式回调、AbortSignal |
| 2. OpenAI 兼容 Provider | 接入 SiliconFlow 真实模型 | SSE 解析、多轮历史、请求中断 |
| 3. Agent 循环（核心） | 模型用 Bash 工具自主执行命令 | `finish_reason`、`tool_calls` 回填、循环上限 |
| 4. 文件工具 | 模型能读写改代码 | 工具 schema 设计、错误回传给模型 |
| 5. 工程化 | 系统提示词、危险命令确认、token 统计、上下文管理 | 权限模型、usage、裁剪 |
| 6.（可选）Anthropic Provider | 同一接口换 Anthropic 协议实现 | 两种协议的格式差异 |

每步先做验收标准，跑通了再进下一步。

## 目标目录结构

```
src/
  index.tsx                 # App：渲染历史、流式回复、调度 agent
  component/                # 已有：Input / FileExplorer
  ai/
    types.d.ts              # 已有：ChatMessage / StreamCallbacks / AIProvider
    providers/
      mock.ts               # M1
      openai.ts             # M2（OpenAI 兼容，fetch + SSE）
      index.ts              # getProvider() 工厂：读 AI_PROVIDER 返回实现
    agent.ts                # M3：agent 循环
    tools/
      bash.ts               # M3
      files.ts              # M4（read_file / write_file / edit_file）
      index.ts              # executeTool() 分发表
```

---

## 里程碑 0：底座（已完成）

- [x] Ink UI：消息历史、输入框（支持中文/粘贴）、`/open <路径>` 文件浏览器
- [x] `src/ai/types.d.ts`：`ChatMessage` / `StreamCallbacks` / `AIProvider` 接口
- [ ] 从里程碑 1 开始做

---

## 里程碑 1：Mock Provider —— 不联网先跑通链路

**验收标准**：

1. `AI_PROVIDER=mock`，终端输入一句话 → mock 回复逐字流式出现在界面上
2. 多轮对话：user / assistant 分开显示，历史保留
3. 回复期间按 Ctrl+C 能中断

**关键点**：

**1. 目录**：新建 `src/ai/providers/mock.ts` 和 `src/ai/providers/index.ts`。

**2. 工厂**：`getProvider()` 读 `process.env.AI_PROVIDER`，switch 返回对应实现。UI 里只依赖 `AIProvider` 接口，不知道具体是 mock 还是真模型——这就是为什么接口要放前面。

**3. Mock 实现骨架**：

```typescript
export class MockProvider implements AIProvider {
  readonly name = "mock";

  async chat(messages: ChatMessage[], cb: StreamCallbacks, signal?: AbortSignal) {
    const last = messages[messages.length - 1]?.content ?? "";
    const reply = `（mock）你说：${last}`;
    const chars = [...reply];                 // 按码点切，中文不会被切坏
    for (const ch of chars) {
      if (signal?.aborted) return cb.onDone(chars.join(""));  // 中断：把已输出的部分交回
      cb.onChunk(ch);
      await sleep(30);                        // 模拟打字机节奏
    }
    cb.onDone(reply);
  }
}
```

**4. UI 接线**（改 `index.tsx`）：`history` 从 `string[]` 改成 `ChatMessage[]`；加一个
`streaming` state 存正在输出的半截回复；提交时把新 user 消息和流式回复一起渲染。
AbortController 每次对话建一个，Ctrl+C 时 abort。

**学习点**：UI 与 AI 解耦。之后把 mock 换成真模型，UI 一行都不用改。

---

## 里程碑 2：OpenAI 兼容 Provider —— 接入真实模型

**验收标准**：

1. `AI_PROVIDER=openai`，输入消息能得到 Qwen 的真实流式回复
2. 多轮对话：模型记得上文（API 无状态，每轮重发完整历史）
3. Ctrl+C 能中断请求（AbortController）

**关键点**：

**1. 不装 SDK，用 fetch 手写 SSE**（理解协议本身比会用 SDK 更重要）：

```typescript
const res = await fetch(`${process.env.AI_BASE_URL}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({ model: process.env.AI_MODEL, messages, stream: true }),
  signal,                                   // 中断由 AbortSignal 传递
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

const decoder = new TextDecoder();
let buf = "", full = "";
for await (const chunk of res.body!) {
  buf += decoder.decode(chunk, { stream: true });   // stream:true 处理中文半字节
  const lines = buf.split("\n");
  buf = lines.pop()!;                       // 最后一行可能不完整，留下次拼
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;   // SSE 只认 data 行
    const data = t.slice(5).trim();
    if (data === "[DONE]") continue;        // 结束标记
    const delta = JSON.parse(data).choices?.[0]?.delta?.content;
    if (delta) { full += delta; cb.onChunk(delta); }
  }
}
cb.onDone(full);
```

**2. SSE 协议要点**：每个事件是 `data: {...}\n\n`；`delta.content` 是增量文本（可能为
`null`，比如传 `role` 或将来传 tool_calls 时）；`[DONE]` 表示流结束。

**3. 多轮**：`ChatMessage[]` 的 `{role, content}` 格式与 OpenAI 兼容协议正好一致，直接序列化即可。API 无状态——每一轮都要把完整历史重新发过去。

**坑**：

- 别用 `await res.text()` 拿流式响应（会等全部结束，等于没流式）
- `JSON.parse` 失败时别崩——跳过坏行或收集错误信息

---

## 里程碑 3：Agent 循环（整个项目的核心）

给模型一个 Bash 工具：它能执行命令、看到输出、继续行动，直到任务完成。

**验收标准**：

1. 对模型说"看看当前目录有什么"→ 它调用 Bash 执行 `ls`，你把结果回传 → 它最终用文字总结
2. 一个任务触发多次工具调用也能跑完（比如先 `ls` 再 `cat`）
3. 有最大循环次数保护，不会无限循环烧钱

**关键点**：

**1. 接口演化**：现有 `AIProvider.chat` 只有流式回调，承载不了 `tool_calls`。这一步你要
扩展接口，比如加一个非流式方法 `complete(messages, opts?: { tools? })`，返回完整
assistant 消息（含 `tool_calls`）和 `finish_reason`。mock 也要跟着实现（见第 5 点）。

**2. 工具定义**（JSON Schema，传给 `tools` 参数）：

```typescript
{
  type: "function",
  function: {
    name: "bash",
    description: "执行终端命令。当需要运行命令、查看文件、安装依赖、运行测试等时使用。",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "要执行的 shell 命令" } },
      required: ["command"],
    },
  },
}
```

**description 写得好坏直接决定模型会不会正确用这个工具**——写清楚"什么时候用、参数什么意思"。

**3. 循环骨架**（OpenAI 兼容格式，先用非流式跑通，简单）：

```typescript
async function runAgent(messages, tools) {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const { message, finishReason } = await provider.complete(messages, { tools });
    messages.push(message);                       // { role:"assistant", content, tool_calls } 原样回填

    if (finishReason !== "tool_calls") return message.content;

    for (const tc of message.tool_calls ?? []) {
      let output;
      try {
        output = await executeTool(tc.function.name, JSON.parse(tc.function.arguments));
      } catch (e) {
        output = `错误: ${e.message}`;            // 错误回给模型，而不是崩溃退出
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: output });
    }
  }
  return "（达到最大轮数，已停止）";
}
```

**4. Bash 执行**（`src/ai/tools/bash.ts`）：用 `child_process.exec`，带 `timeout` 和输出
截断（比如 30 秒 / 30KB），把 **stdout + stderr + exit code** 都放进 tool_result——模型需要
这些信息判断下一步。

**5. 测试技巧**：先让 mock provider 按"剧本"返回假的 `tool_calls`（比如消息里带"工具"
二字就假装要调 bash），不花一分钱 API 费就能测通整个循环，再切真模型。

**坑**：

- assistant 消息必须带 `tool_calls` 原样回填，丢了会 400
- `role:"tool"` 的 `tool_call_id` 必须和对应 `tool_call` 的 `id` 一一对应
- `arguments` 是 JSON **字符串**，要 `JSON.parse`；parse 失败把错误信息回给模型，它自己会修正

---

## 里程碑 4：文件工具

给模型加上 `read_file` / `write_file` / `edit_file`，它就从"能跑命令"变成"能改代码"。

**验收标准**：

1. 说"读一下 package.json 并总结这个项目"→ 模型调用 read_file 并正确总结
2. 说"把 index.tsx 里的标题改成 XXX"→ 模型用 edit_file 完成，文件真的被修改
3. 说"新建一个 hello.txt 写点东西"→ write_file 生效

| 工具 | schema 要点 | 实现要点 |
|---|---|---|
| `read_file` | `path`（+可选 `offset`/`limit`） | 限制读取大小（比如 100KB），防止大文件撑爆上下文 |
| `write_file` | `path`, `content` | 覆盖写；路径是相对 cwd 还是绝对路径要写进 description |
| `edit_file` | `path`, `old_string`, `new_string` | 精确字符串替换；找不到 `old_string` 时返回错误让模型重试 |

**学习点**：

- 工具输入校验：路径不存在、文件太大时，返回**错误信息**而不是抛异常——模型能据此自我纠正
- 观察模型怎么"选择"工具：description 改一个词，行为可能完全不同

---

## 里程碑 5：工程化

| 项目 | 做法 |
|---|---|
| 系统提示词 | 定义人设与工具使用规则（"你是终端编程助手…改代码前先读文件…出错先看 stderr"），作为 `messages[0]` 的 `role:"system"` 发送 |
| 危险命令确认 | 在 `executeTool` 的 bash 分支先正则拦截（`rm -rf /`、`git push --force`、`curl \| sh`…），命中则打印命令问用户 y/n，拒绝就把"用户拒绝执行"回给模型。**参考 `hook/danger-guard.py` 的拦截规则**——注意那个 Python 脚本是给真实 Claude Code 用的 hook，你自己的 agent 需要在 TS 里自己实现一遍 |
| Token 统计 | 非流式响应直接读 `usage.prompt_tokens / completion_tokens`；流式时 usage 在最后一个 chunk（部分服务需要 `stream_options: { include_usage: true }`），拿不到就只在非流式模式显示 |
| 上下文管理 | 消息超过 N 条或总字数超限时裁剪：保留 system + 最近若干条，防止 token 无限增长 |
| 流式最后回复 | 循环里非流式请求，但最后一轮（不再有 tool_calls）可以改回 `chat()` 流式输出——体验从"干等"变成逐字打印 |

---

## 里程碑 6（可选）：Anthropic Provider

用同一个 `AIProvider` 接口实现 Anthropic 协议（装 `@anthropic-ai/sdk`），对比两种协议：

| | OpenAI 兼容 | Anthropic |
|---|---|---|
| 工具定义 | `{ type:"function", function:{...} }` | `{ name, description, input_schema }` |
| 工具调用 | `message.tool_calls[]`，arguments 是 JSON 字符串 | content 里的 `tool_use` 块，input 已是对象 |
| 工具结果 | `{ role:"tool", tool_call_id }` | user 消息里的 `tool_result` 块 |
| 循环结束判断 | `finish_reason === "tool_calls"` | `stop_reason === "tool_use"` |

做完这步，你会真正理解 provider 抽象的价值：两套协议、一套 UI 和 agent 循环。

---

## 常见坑（FAQ）

| 坑 | 原因与解法 |
|---|---|
| 回填历史后报 400 | assistant 消息必须原样回填完整 `tool_calls`，不能只存 text |
| `tool_call_id` 对不上 | 必须来自对应 `tool_call` 块的 `id`，一一配对 |
| `arguments` 解析失败 | 它是 JSON 字符串；parse 失败把错误回给模型，它会重试 |
| 流式里 `delta.content` 为 null | 正常——该 chunk 可能只传 role 或 tool_calls |
| 中文出现半个字/乱码 | `TextDecoder` 要传 `{ stream: true }`，且缓冲区按行切、留尾行 |
| SSE 解析丢数据 | 事件按空行分隔；只处理 `data:` 行；`[DONE]` 是结束标记 |
| 模型不用你的工具 | 检查 description 是否写清楚"什么时候用、参数什么意思" |
| 模型陷入循环反复调工具 | 设 `MAX_TURNS` 上限；把历史执行记录也放进 tool_result 帮助它判断 |
| Ink 里流式更新卡住 | 回调里 `setState` 更新即可；组件卸载时记得 abort + 清 interval |
| 非流式请求超时 | `max_tokens` 大时改流式，或给 fetch 加超时 |

## 参考文档

- SiliconFlow API 文档：https://docs.siliconflow.cn/
- OpenAI chat completions 参考：https://platform.openai.com/docs/api-reference/chat
- OpenAI 函数调用指南：https://platform.openai.com/docs/guides/function-calling
- SSE（MDN）：https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- Ink：https://github.com/vadimdemedes/ink
- Anthropic 工具调用（里程碑 6 用）：https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
