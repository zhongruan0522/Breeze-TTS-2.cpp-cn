<div align="center">

# Breeze-TTS-2.cpp

**用 C++ 和 GGUF 实现的双语指令跟随文本转语音。**
声音设计、声音克隆、声音指向，以及实验性的声音转换，
在一块中端 GPU 上以快于实时的速度流式生成。

<a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-1f6feb?style=for-the-badge" alt="License"></a>
<img src="https://img.shields.io/badge/C%2B%2B-17-00599C?style=for-the-badge&logo=cplusplus&logoColor=white" alt="C++17">
<img src="https://img.shields.io/badge/Vulkan-AC162C?style=for-the-badge&logo=vulkan&logoColor=white" alt="Vulkan">
<a href="https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp"><img src="https://img.shields.io/badge/GGUF_weights-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black" alt="GGUF weights"></a>

[English](README.md) | 简体中文

</div>

一个对 [BreezeBlue/Breeze-TTS-2](https://huggingface.co/BreezeBlue/Breeze-TTS-2) 的 C++ / GGUF 重新实现，运行在 [ggml](https://github.com/ggml-org/ggml) 上。Vulkan 后端意味着它在 NVIDIA、AMD 和 Intel GPU 上都能工作，并在没有 GPU 时回退到 CPU。附带一个 CLI、一个带 Web UI 的流式 HTTP 与 WebSocket 服务器，以及一个供语言绑定用的纯 C 共享库。

支持英语和普通话，24 kHz，在 RTX 3060 上 Q8_0 大约 2 倍实时率，带引导时 1.6 倍，服务器可以同时跑几路流。

## 演示

声音设计、克隆、指向、发声事件标签，以及一段演唱录音上的声音转换。所有片段都在同一块 RTX 3060 上以快于实时的速度生成，没有经过挑选。

https://github.com/user-attachments/assets/b63e4664-497f-4bac-b9e2-50bf571df30a

## 性能

最近的版本借鉴了 [BreezeRT](https://breezeblue.ai/blog/breezert-ultra-low-latency-tts)，Breeze TTS 2 团队的低延迟运行时：先小后大逐步增长的块、编译成每帧一张计算图的深度解码器、CUDA graph 重放、保留状态且只解码新帧的声码器，以及多路流共享一个 GPU 批次。在此之上，声码器用一次矩阵乘法做上采样，这一点并非来自那篇博客，却是 CUDA 上单项最大的提速。

单路流在一张解锁了张量核心限制的 RTX 3060 12 GB 上的实时率，v0.1.5 与 v0.1.6 在相同种子下背靠背运行：

| 模型 | `cfg_scale` | v0.1.5 | v0.1.6 |
| --- | --- | --- | --- |
| Q4_K | 1 | 2.15x | 2.41x |
| Q4_K | 3 | 1.53x | 1.74x |
| Q8_0 | 1 | 1.78x | 1.99x |
| Q8_0 | 3 | 1.46x | 1.58x |

以上是 Vulkan 的数字。CUDA 在 Q4_K 下测得 2.12x，`cfg_scale` 3 下为 1.70x。

预热完成的服务器上首段音频约 80 ms，而 v0.1.5 大约是 180 ms。

在一台原装 RTX 3080 12 GB、未做解锁、相同版本与 Vulkan 下，4 个种子的中位数：

| 模型 | `cfg_scale` 1 | `cfg_scale` 3 |
| --- | --- | --- |
| Q4_K | 3.50x | 2.81x |
| Q6_K | 3.67x | 2.87x |
| Q8_0 搭配 Q4_K 深度解码器 | 3.72x | 2.83x |
| Q8_0 | 3.16x | 2.71x |
| F16 | 2.71x | 2.32x |

它的显存带宽远大于 3060，所以权重类型在那里影响小得多：Q8_0 只比 Q4_K 慢约 10%，连 F16 都远快于实时。

### 同时运行多路流

用 `--parallel 3` 启动服务器，它会把最多三路流放在一起生成，每帧共享一个 GPU 批次。同一张卡、客户端不做缓冲、各流相隔一秒启动时：

| 流数 | 模型 | 每路流速度 | 空隙 |
| --- | --- | --- | --- |
| 3 | Q8_0 | 1.24x 到 1.32x | 无 |
| 3 | Q8_0 搭配 Q4_K 深度解码器 | 1.42x 到 1.51x | 无 |
| 3 | Q4_K，CUDA | 1.38x 到 1.52x | 无 |
| 1 路带引导，2 路不带 | Q8_0 | 1.15x 到 1.28x | 无 |
| 2 路带引导 | Q8_0 | 1.16x 到 1.19x | 无 |
| 3 路带引导 | Q8_0 | 0.87x 到 0.95x | 约 3 s，跟不上播放 |

在 3080 上以上每一种都能跟上播放，包括最后一种，三路带引导的流约 1.5x。五路 Q8_0 流各自跑到 1.46x 到 1.68x 且没有空隙，`--parallel 6` 对任何模型都是安全的，见
[docs-zh/performance.md](docs-zh/performance.md#运行多路流)。

一路使用引导的流算两路，所以 `--parallel 4` 装得下除最后一种以外的所有组合。当所有槽位都被占用时，HTTP 路由返回 `409`，WebSocket 会话则排队等待。

### 调优

默认值就是测得的最快设置，所以大多数配置除了 `--parallel` 之外什么都不用改。选哪个模型、一张卡能装下多少路流、每个设置现在的作用，以及如何测量你自己的卡，都在
[docs-zh/performance.md](docs-zh/performance.md)。一个需要知道的改动：如果你在旧版本上调高过 `--chunk-max`，把它去掉，它不再有任何收益。

Vulkan 仍是默认后端，原因和各阶段数字见 [docs-zh/build.md](docs-zh/build.md)。

## 文档

<div align="center">

<a href="docs-zh/build.md"><img src="https://img.shields.io/badge/构建-2b3137?style=for-the-badge" alt="构建"></a>
<a href="docs-zh/models.md"><img src="https://img.shields.io/badge/模型-2b3137?style=for-the-badge" alt="模型"></a>
<a href="docs-zh/cli.md"><img src="https://img.shields.io/badge/CLI-2b3137?style=for-the-badge" alt="CLI"></a>
<a href="docs-zh/server.md"><img src="https://img.shields.io/badge/HTTP_服务器-2b3137?style=for-the-badge" alt="HTTP 服务器"></a>
<a href="docs-zh/websocket.md"><img src="https://img.shields.io/badge/WebSocket-2b3137?style=for-the-badge" alt="WebSocket"></a>
<br>
<a href="docs-zh/voices.md"><img src="https://img.shields.io/badge/已保存的声音-2b3137?style=for-the-badge" alt="已保存的声音"></a>
<a href="docs-zh/voice-conversion.md"><img src="https://img.shields.io/badge/声音转换-6e2b3a?style=for-the-badge" alt="声音转换"></a>
<a href="docs-zh/c-api.md"><img src="https://img.shields.io/badge/C_API-2b3137?style=for-the-badge" alt="C API"></a>
<a href="docs-zh/ctypes.md"><img src="https://img.shields.io/badge/Python-2b3137?style=for-the-badge" alt="Python"></a>
<a href="docs-zh/performance.md"><img src="https://img.shields.io/badge/性能-2b3137?style=for-the-badge" alt="性能"></a>
<a href="docs-zh/architecture.md"><img src="https://img.shields.io/badge/架构-2b3137?style=for-the-badge" alt="架构"></a>

</div>

## 功能

| 模式 | 你提供 | 你得到 |
| --- | --- | --- |
| **声音设计** | 对声音的文字描述 | 一个按描述虚构出的声音 |
| **声音克隆** | 一段参考音频及其转录文本 | 用该声音说出的新语音 |
| **声音指向** | 一段参考音频加一条指令 | 同一声音，语气或语速被调整 |
| **声音转换** | 一段要重新演绎的录音和一个目标声音 | 不同声音下的同一段演绎 |

## 下载

Windows 和 Linux (x64) 的预构建 Vulkan 版本在[发布页](https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases)。它们在 NVIDIA、AMD 和 Intel GPU 上开箱即用，除了较新的 GPU 驱动之外无需安装其他东西，没有 GPU 时回退到 CPU。解压，从[权重](#权重)一节拿一个模型，运行：

```
breeze-server breeze-tts-2-q8_0.gguf --webui
```

然后打开 http://localhost:8080/。CPU 侧需要 AVX2，2013 年以后的任何 x64 CPU 都具备。Linux 上需要安装 Vulkan loader，任何配好 GPU 驱动的桌面系统都已安装（Debian 和 Ubuntu 上是 `libvulkan1` 包）。

## 构建

```
git clone --recursive https://github.com/HoppouAI/Breeze-TTS-2.cpp
cd Breeze-TTS-2.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```

加 `-DBREEZE_VULKAN=OFF` 得到纯 CPU 构建。产物是 `breeze-cli`、`breeze-convert`、`breeze-server`、`breeze-quantize` 和共享库。见 [docs-zh/build.md](docs-zh/build.md)。

### Nix

装好 [Nix](https://nixos.org/)（打开 flake 支持）后，`nix develop` 进入上面所说的构建环境：CMake、Ninja、Vulkan SDK 和 Python 转换依赖，外加几个便捷命令。`nix develop .#cpu` 是纯 CPU 的 shell。

```
breeze-build         # 配置并构建（Vulkan）；传 --cpu 跳过 Vulkan
breeze-cli           # 运行 build/breeze-cli
breeze-server        # 运行 build/breeze-server
```

flake 还附带一个把 `breeze-server` 作为 systemd 服务运行的 NixOS 模块。从 Hub 目录选择的模型会下载到状态目录并在每次启动时做 sha256 校验，已保存的声音重启后仍在，Web UI 只差一个选项：

```nix
{
  inputs.breeze-tts.url = "github:HoppouAI/Breeze-TTS-2.cpp/feat/nix";
  # ...
  modules = [
    breeze-tts.nixosModules.default
    {
      hardware.graphics.enable = true;  # GPU 后端所需的 Vulkan 驱动组件
      services.breeze-tts = {
        enable = true;
        webui = true;
        model = "q8_0";   # 或者：customModel = "/path/to/your.gguf";
      };
    }
  ];
}
```

全部选项、状态目录布局与运维细节：[nix/README.md](nix/README.md)。

## 权重

<div align="center">

<a href="https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp"><img src="https://huggingface.co/datasets/huggingface/badges/resolve/main/model-on-hf-lg.svg" alt="Model on Hugging Face"></a>

</div>

预构建的 GGUF 在 Hub 的
[HoppouAI/Breeze-TTS-2.cpp](https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp)，也可以自己转换。下载必须包含 `audio_tokenizer/` 目录，声码器在那里。

```
pip install -r scripts/requirements.txt
python scripts/convert_hf_to_gguf.py /path/to/Breeze-TTS-2 -o breeze-tts-2-f16.gguf --dtype f16
build/breeze-quantize breeze-tts-2-f16.gguf breeze-tts-2-q4_k.gguf q4_k
```

| 变体 | 大小 | 大致显存 | 说明 |
| --- | --- | --- | --- |
| F16 | 5.9 GB | ~7 GB | 参考质量 |
| Q8_0 | 3.3 GB | ~4 GB | **推荐** |
| Q6_K | 2.9 GB | ~3.5 GB | |
| Q4_K | 2.4 GB | ~3 GB | 最小的稳妥选择 |
| Q8_0-dd4、Q8_0-dd2、Q4_K-dd2 | 2.3 到 3.4 GB | | 实验性，见下文 |

`-dd` 变体同时对深度解码器做量化，其他变体把它留在更高精度。在深度解码器构成瓶颈的硬件上，它们可能明显更快，因为它对每一帧音频要顺序运行 15 步。代价是深度码每帧都回馈进骨干网络，误差随长度累积：输出在开头还撑得住，连续生成大约 45 秒之后会变得沉闷单薄。短句没问题，长篇叙述不行。

## CLI

```
# 声音设计
build/breeze-cli breeze-tts-2-q8_0.gguf \
  --text "(sigh) Welcome aboard. Your journey begins now." \
  --instruction "A warm, thoughtful young woman with a clear, calm delivery." \
  --output design.wav

# 声音克隆
build/breeze-cli breeze-tts-2-q8_0.gguf \
  --text "It is good to hear your voice again." \
  --ref-audio reference.wav --ref-text "Exact transcript of the reference." \
  --output clone.wav

# 声音指向
build/breeze-cli breeze-tts-2-q8_0.gguf \
  --text "(clears throat) We need to talk." \
  --instruction "Speak slowly with a restrained, serious tone." \
  --ref-audio reference.wav --ref-text "Exact transcript of the reference." \
  --output direction.wav
```

编码参考音频是克隆中最慢的一步，而且是确定性的，所以用 `--save-voice name` 保存一次，之后用 `--voice name`。已保存的声音即时加载，CLI、服务器和 Web UI 都能用，把首段音频从约 900 ms 缩短到约 280 ms。见
[docs-zh/voices.md](docs-zh/voices.md)。

## 发声事件

圆括号中的内联标签产生非语音的声音。`(laugh)`、`(sigh)`、`(cough)` 和 `(clears throat)` 是可靠的那几个，中文侧还有 `[笑]` 和 `[叹气]`，但标签词表是**自由形式**的。模型是用描述性标签训练的，而不是一个固定的 token 列表，所以 `(whispering)`、`(gasp)` 或 `(nervous chuckle)` 之类常常也能用。

问题在于，默认的 `--cfg-scale 1.0` 下模型把标签当作建议，通常会忽略常见集合之外的内容。**发声事件一般需要 `--cfg-scale` 2 到 3 才会真正触发**，因为引导正是把输出推离平淡朗读的东西。这个范围会带来一些粗糙感，所以对需要发声事件的句子调高，普通语音再降回 1.0。

```
build/breeze-cli breeze-tts-2-q8_0.gguf \
  --text "(nervous chuckle) I am sure it is nothing to worry about." \
  --instruction "An anxious man trying to sound casual." \
  --cfg-scale 2.5 --output event.wav
```

## 声音转换（实验性）

`breeze-convert` 用另一个声音重新演绎一段已有录音。与朗读新文本的克隆不同，它保留原有的演绎：时间、措辞、节奏和重音都保留下来，只有说话者的身份改变。这不是上游模型的一部分。它源自编解码器把语义内容和声学细节分开的方式，因此是这个实现独有的，而且确实是实验性的。

```
build/breeze-convert breeze-tts-2-q8_0.gguf \
  --source recording.wav --text "Transcript of the recording." \
  --ref-audio target_voice.wav --ref-text "Exact transcript of the target clip." \
  --output converted.wav
```

在依赖它之前值得知道：

- 它默认接近贪心采样（`--temp 0.3 --top-k 1`），这是刻意的。放开采样会让源音色泄漏回结果，可测量地削弱目标身份。
- **音高是重新生成的，不是复制的。** 演唱会以目标声音自己的音域重新唱，而不是源音域，所以转换后的唱段可能与原曲相差一个五度。旋律能否保留因片段而异，要用耳朵判断。`--keep-acoustic 1` 或 `2` 直接从源音频复制最低的几个声学码本，能把更多原始轮廓带过来，代价是目标声音出来得不够干净。更高的值会崩坏，而且普通语音上连 1 都会引起颤音，所以除非源是演唱，保持 0。
- 大约实时速度，所以三分钟的录音大约要三分钟。
- `--text` 可选，但在这里影响最大。提供源转录文本能让骨干网络与强制码对齐。同一段演唱，不给文本时回来的是 "Does it pinch I? Send my tears"，提供歌词后则是 "drink it up, I have no fear"。

见 [docs-zh/voice-conversion.md](docs-zh/voice-conversion.md)。

## 服务器

```
build/breeze-server breeze-tts-2-q8_0.gguf --host 127.0.0.1 --port 8080 --webui
```

打开 http://localhost:8080/ 是 Web UI。HTTP API 流式输出单声道 24 kHz 有符号 16 位小端 PCM，与参考服务器一致。

```
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  --form-string "text=(clears throat) We need to talk." \
  --form-string "instruction=Speak slowly with a restrained, serious tone." \
  --form-string "voice_id=narrator" \
  --output out.pcm
```

文本字段用 `--form-string`，不要用 `-F`。以 `(` 开头的值会让 `curl` 构造一个 multipart 组而不是发送文本，一旦用到发声事件标签就会踩坑。

同一端点也接受 OpenAI 风格的 JSON，所以 SillyTavern 和 OpenAI SDK 可以把它当作即插即用的 TTS 提供方，MP3、WAV 或 PCM 流式返回，需要时还有服务器发送事件。见
[docs-zh/server.md](docs-zh/server.md#openai-兼容请求)。

HTTP 端口加一还有一个 WebSocket 服务器。它增量接收文本，边生成边流式返回音频，支持中途更改演绎指令或取消当前句，这正是由聊天模型驱动它时想要的。见 [docs-zh/websocket.md](docs-zh/websocket.md)。

`--talk` 在 `/talk` 添加一个语音通话演示：选一个角色，与它开口交谈。轮次与打断用
[tyger-server](https://github.com/HoppouAI/tyger.cpp)，回复用任何 OpenAI 兼容的聊天服务器。通话中还可以共享屏幕让角色看到，前提是聊天模型支持图像。见
[docs-zh/server.md](docs-zh/server.md#语音通话演示)。

> **两个端口都没有鉴权或限流。** 除非前面有别的东西在处理这些，否则保持绑定在 `127.0.0.1`。

## MCP 服务器

[breeze-tts-2-mcp](https://github.com/fortesoft-co/breeze-tts-2-mcp) 是一个 MCP 服务器，给讲 MCP 的代理提供完整的语音工具箱：带声音指向和发声事件的大声朗读（`speak`、`speechJobs`）、作为单一成品的多角色对话与旁白（`speakScript`）、从描述设计声音（`designVoice`），以及已保存声音[库](docs-zh/voices.md)的管理（`saveVoice`、`listVoices`、`deleteVoice`）。它通过 HTTP 驱动一个运行中的 `breeze-server`，并协调各客户端的本地音频播放。

安装：克隆仓库，`npm install && npm run build`，用 `BREEZE_TTS_URL` 指向服务器。一个 `breeze-speak` 二进制和一个 Agent Skills 包覆盖没有 MCP 宿主的调用方。在 Zed、Claude Code 或任何 stdio MCP 客户端中注册它、完整工具列表和全部环境选项，见[上游 README](https://github.com/fortesoft-co/breeze-tts-2-mcp)。

## 绑定

共享库暴露纯 C ABI，所以任何有 FFI 的语言都能驱动它。

```c
breeze_context * ctx = breeze_init("breeze-tts-2-q8_0.gguf", 1);
breeze_request req = {0};
req.text = "Hello there.";
req.cfg_scale = 1.0f;
req.seed = 42;
breeze_generate_wav(ctx, &req, "out.wav");
breeze_free(ctx);
```

每个字段都把 `0` 当作"使用模型默认值"，所以零初始化结构体是安全的，之后新增字段也依然安全。见 [docs-zh/c-api.md](docs-zh/c-api.md) 和 [docs-zh/ctypes.md](docs-zh/ctypes.md)。

在 mingw 上，库把编译器运行时静态链接进来，所以 GPU 驱动的 `vulkan-1.dll` 是唯一的外部依赖。

## 说明

- `--cfg-scale` 默认为 1.0，与参考实现一致。大于 1 会把整条流水线跑两遍，并更用力地推向指令。大约超过 3 就开始粗糙。
- 声码器来自随附的 `audio_tokenizer/`，而不是主 checkpoint 里的 Mimi 编解码器。参考实现在推理时从来不用那一个。
- 流式块从 80 ms 开始，增长到 2 秒。声码器在块之间保留状态，只解码新帧，结果与单次整体解码一致（除舍入外，在真实语音上低约 40 dB）。

## 许可证

源代码是 [Apache 2.0](LICENSE)。`third_party/shine` 中的 MP3 编码器是 LGPL 2.0 下的独立子模块。Breeze TTS 2 模型权重受 BreezeBlue Research and Non-Commercial License 约束。你有责任遵守权重许可，并为所用的任何参考音频或声音取得授权。
