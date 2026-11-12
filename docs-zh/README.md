# 文档

| 文档 | 内容 |
| --- | --- |
| [build.md](build.md) | 工具链要求、CMake 选项、后端选择、故障排查 |
| [models.md](models.md) | 下载权重、GGUF 转换、量化、张量布局 |
| [cli.md](cli.md) | `breeze-cli` 的参数与使用配方 |
| [server.md](server.md) | HTTP 端点、请求与响应格式、流式输出、WebUI |
| [websocket.md](websocket.md) | 流式会话、增量文本、实时演绎指令变更、打断 |
| [voices.md](voices.md) | 参考声音的缓存与保存、`.breeze` 格式 |
| [voice-conversion.md](voice-conversion.md) | 用另一个声音重新演绎一段录音、`breeze-convert` |
| [performance.md](performance.md) | 新变化、选择模型、运行多路流、调优与测量 |
| [c-api.md](c-api.md) | `breeze.h` C API、生命周期、回调、线程安全 |
| [ctypes.md](ctypes.md) | 用 `ctypes` 从 Python 绑定共享库 |
| [architecture.md](architecture.md) | 四个模型阶段，以及 C++ 实现如何对应参考实现 |

## 快速概览

Breeze-TTS-2 分四个阶段生成语音：

1. T5Gemma2 **文本编码器**把提示转换为条件序列。
2. Qwen3 **骨干网络**以自回归方式预测码本 0，每次一帧，帧率为每秒 12.5 帧。
3. 一个小型**深度解码器**为每一帧填充码本 1 到 15。
4. **声码器**把 16 个码本转换回 24 kHz 波形。

每帧为 1920 个采样，所以一帧编码对应 80 ms 音频。

## 三种生成模式

| 模式 | 参考音频 | 指令 | 模板 |
| --- | --- | --- | --- |
| 声音设计 | 无 | 描述声音 | `tts_instruction` |
| 声音克隆 | 有 | `Speak clearly and naturally.` | `ref_edit_tata` |
| 声音指向 | 有 | 描述演绎方式 | `ref_edit_tata` |

模式根据是否提供了参考音频自动确定，所以 API 中任何地方都没有模式开关。

此外还有**声音转换**，它是一种不同的操作，而不是第四种模式。它以你已有的录音而非文本作为输入，保留其词语和节奏，替换说话者。见 [voice-conversion.md](voice-conversion.md)。
