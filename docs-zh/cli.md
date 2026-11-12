# CLI

`breeze-cli` 运行一次请求并写出一个 WAV 文件。

```
breeze-cli <model.gguf> --text <text> [options]
```

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `--text <s>` | 必填 | 要朗读的文本，UTF-8。 |
| `--instruction <s>` | `Speak clearly and naturally.` | 声音描述或演绎指导。 |
| `--ref-audio <wav>` | 无 | 用于克隆的参考音频。会被重采样为模型采样率的单声道。 |
| `--ref-text <s>` | 无 | 参考音频的精确转写文本。使用 `--ref-audio` 时必填。 |
| `--voice <name>` | 无 | 使用已保存的声音而不是 `--ref-audio`。见 [voices.md](voices.md)。 |
| `--save-voice <name>` | 无 | 把 `--ref-audio` 编码成可复用的声音文件后退出。 |
| `--description <s>` | 无 | 可选描述，随 `--save-voice` 一起保存。之后可在 Web UI 或通过 HTTP 编辑，见 [voices.md](voices.md#descriptions-and-metadata)。 |
| `--list-voices` | | 列出已保存的声音后退出，不加载模型。 |
| `--voices-dir <path>` | `voices` | 已保存声音的存放位置。 |
| `--cfg-scale <f>` | `1.0` | Classifier free guidance。`1.0` 禁用它。 |
| `--seed <n>` | `42` | RNG 种子。 |
| `--temp <f>` | 模型默认值 | 采样温度。`0` 保持 GGUF 自身的值。 |
| `--top-k <n>` | 模型默认值 | 采样 top-k。`0` 保持模型默认值。 |
| `--top-p <f>` | 模型默认值 | 采样 top-p。`0` 保持模型默认值。 |
| `--rep-penalty <f>` | 模型默认值 | 重复惩罚。`0` 保持模型默认值。 |
| `--max-new <n>` | 模型默认值 (750) | 帧数上限。一帧是 80 ms。 |
| `--split-chars <n>` | `600` | 把长文本切分成大约这么多字符的段。`0` 表示一次性生成。 |
| `--output <wav>` | `output.wav` | 输出路径。 |
| `--chunk-first <n>` | `1` | 首个流式块的帧数。 |
| `--chunk-max <n>` | `25` | 块增长到的最大帧数。 |
| `--timings` | 关闭 | 打印分阶段的延迟明细。 |
| `--cpu` | 关闭 | 强制使用 CPU 后端。 |
| `--te-cpu` | 关闭 | 在 CPU 上运行文本编码器，并把其权重保存在系统内存中。节省约 1 GB 显存。每段文本前增加约 0.7 s 延迟，带 guidance 时约 1.3 s。见 [performance.md](performance.md#short-on-video-memory)。`BREEZE_TE_THREADS` 设置其线程数（默认为核心数的一半）。 |
| `-h`, `--help` | | 打印用法。 |

音频流式生成时以 `generated N.NN s` 的形式打印进度。

在 Windows 上，二进制文件以 UTF-8 模式运行，所以无论系统语言设置是什么，命令行上的中文或任何其他非 ASCII 文本和文件路径都会完整地传给模型。这需要 Windows 10 版本 1903 或更新。更旧的版本会以系统代码页把文本交给程序，无法表示的字符会变成 `?`，所以在那些版本上请改用 [server](server.md) 发送非 ASCII 文本，那里以 UTF-8 到达。

## 延迟

`--timings` 报告时间花在哪里：

```
time to first audio 190 ms over 9 flushes
  reference encode       0.0 ms
  prompt build          42.0 ms
  backbone prefill      39.5 ms
  first vocoder         45.9 ms  (1 frames)
  backbone decode      712.3 ms  (9.37 ms/frame)
  depth decode        1924.3 ms  (25.32 ms/frame)
  vocoder              279.0 ms  (3.67 ms/frame)
  76 frames, 6.08 s audio
```

深度解码器占大头，因为它每帧要运行 15 次顺序的单 token 推理。它们作为一张图提交给 GPU，但每次推理仍然要等待前一次选出的码。相比之下，其他环节都很小。

音频以逐渐增大的块刷出，从 1 帧开始以便尽早开始播放，然后增长到 25 帧。声码器在两次刷出之间保留状态，只解码新帧，所以小块的代价很小。

`--chunk-first` 和 `--chunk-max` 调整这一增长曲线，把它们与 `--timings` 搭配使用可以观察在特定设备上的效果。默认值是测得的最快设置，再调大 `--chunk-max` 已无收益。GPU 驱动会在第一次运行时构建流水线，所以跑两次，以第二次为准。测量数据见 [performance.md](performance.md)，客户端需要如何处理结果见 [server.md](server.md)。

## 示例

普通合成：

```
breeze-cli breeze-tts-2-q4_k.gguf \
  --text "The build finished without a single warning." \
  --output out.wav
```

根据描述设计一个声音：

```
breeze-cli breeze-tts-2-f16.gguf \
  --text "Welcome aboard. Your journey begins now." \
  --instruction "A warm, thoughtful young woman with a clear, calm delivery." \
  --cfg-scale 1 \
  --output design.wav
```

克隆一个声音。转写文本必须与参考音频完全一致，包括标点，否则克隆质量会严重下降：

```
breeze-cli breeze-tts-2-f16.gguf \
  --text "It is good to hear your voice again after all this time." \
  --ref-audio reference.wav \
  --ref-text "This is the exact transcript of the reference audio." \
  --output clone.wav
```

克隆一个声音并指导演绎方式：

```
breeze-cli breeze-tts-2-f16.gguf \
  --text "We need to discuss what happened last night." \
  --instruction "Speak slowly with a restrained, serious tone." \
  --ref-audio reference.wav \
  --ref-text "This is the exact transcript of the reference audio." \
  --cfg-scale 1 \
  --output direction.wav
```

## 选项说明

**`--cfg-scale`** 会把流水线跑两遍，一次有条件、一次无条件，然后按 `uncond + scale * (cond - uncond)` 合并 logits。深度解码器把两个分支合并进一张图，所以实际开销约为 23%，而不是你预期的翻倍，生成速度仍然快于播放。参考实现默认为 `1.0`，这会完全跳过第二次推理。更高的值会更强烈地贴合 instruction；超过大约 2 之后输出会出现可闻的刺耳感，所以只有在声音无视描述时才调高。

**`--seed`** 在给定模型和输入下完全决定输出。采样使用 temperature 0.9 和 top-k 50，所以不同种子会得到真正不同的演绎效果。生成几个再挑最好的一个很正常。

**`--max-new`** 限制的是帧数，不是字符数。按每秒 12.5 帧计算，默认的 750 是 60 秒。模型会在语音结束 token 处自行停止，所以这是防止生成失控的保险，而不是长度控制。它按段生效，而不是对整个请求。

**`--split-chars`** 才是真正的长度控制。超出预算的文本会按句子边界切分并逐段生成，每段都以第一段为条件，这样声音保持稳定。中文字符的计重高于拉丁字符，因为读起来耗时更长。

切分不只是形式。要求一次性生成几分钟的文本时，模型能保持音色但会丢失文本，大约超过一分半后就漂移成乱码词。如果各段听起来不连贯就调大预算，如果句子丢失就调小，设 `0` 可以关闭切分。

**`--ref-audio`** 接受读取器能理解的任何 WAV，并转换为模型采样率的单声道。五到十五秒的干净语音效果最好。背景噪声和音乐会连同声音一起被克隆。

## 参考音频质量

克隆会复制它听到的一切。在安静房间里用耳麦录制的参考音频克隆效果良好。带有房间回声、风扇声或背景音乐的参考音频，会产生把这些瑕疵带入每一次生成的声音，无论怎么调 `--cfg-scale` 都无法修复。
