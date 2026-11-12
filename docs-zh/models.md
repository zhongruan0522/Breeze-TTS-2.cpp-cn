# 模型

## 获取权重

上游检查点位于 [BreezeBlue/Breeze-TTS-2](https://huggingface.co/BreezeBlue/Breeze-TTS-2)。它大约有 6.5 GB，下载时必须包含 `audio_tokenizer/` 子目录，其中存放着声码器。没有它，转换器会拒绝运行。

```
huggingface-cli download BreezeBlue/Breeze-TTS-2 --local-dir ./Breeze-TTS-2
```

转换器期望的目录结构：

```
Breeze-TTS-2/
  config.json
  model-*.safetensors
  tokenizer.json
  audio_tokenizer/
    config.json
    model.safetensors
```

## 转换为 GGUF

```
pip install -r scripts/requirements.txt
python scripts/convert_hf_to_gguf.py ./Breeze-TTS-2 -o breeze-tts-2-f16.gguf --dtype f16
```

只需要 `numpy` 和 `gguf`。转换器使用内存映射读取器直接读取 safetensors，并手工解码 BF16，因此不依赖 torch，峰值内存也很低。

`--dtype f32` 会生成一个大小约为两倍的无量化模型。它可以用作调试参考，但不适合日常使用；实测它与 F16 的差异约为 78 dB SNR，人耳不可闻。

### 转换器做了什么

除了直接复制张量之外，它还应用了一些运行时所依赖的变换：

- **Gemma RMSNorm 偏移。** `T5Gemma2RMSNorm` 计算 `x_norm * (1 + w)`，而权重是以零为中心存储的。转换器把 `+1` 预先烘焙进每个 `te.*_norm.weight`，这样运行时就可以使用普通的 RMSNorm。
- **码本重建。** 量化器的码本以 `embedding_sum` 和 `cluster_usage` 存储。转换器预先计算 `embedding_sum / max(cluster_usage, 1e-5)`。
- **深度卷积核重打包。** ggml 卷积不支持分组卷积，因此 ConvNeXt 的深度卷积核以转置后的 `(K, C)` 形式存储，并在运行时以移位乘法的方式应用，而不是展开成块对角矩阵——那会白白多占 59 MB。
- **输出头转置。** `codebooks_head` 从 `(15, 1024, 2051)` 转置为 `(15, 2051, 1024)`，使每个切片都是即取即用的矩阵乘法权重。
- **精度固定。** 卷积核、嵌入、码本、归一化和偏置无论 `--dtype` 如何都保持 F32。Vulkan 卷积核拒绝 F16 输入，而这些逐元素参数又太小，不值得缩小。

检查点中的 Mimi 编解码器被完全跳过。参考实现在推理时从不使用它；它加载的是 `audio_tokenizer/`。

## 量化

```
breeze-quantize breeze-tts-2-f16.gguf breeze-tts-2-q4_k.gguf q4_k
```

接受 `f16`、`q8_0`、`q6_k`、`q4_k`、`q3_k` 或 `q2_k`。

| 变体 | 大小 | 大约显存占用 |
| --- | --- | --- |
| F16 | 5.9 GB | ~7 GB |
| Q8_0 | 3.3 GB | ~4 GB |
| Q6_K | 2.9 GB | ~3.5 GB |
| Q4_K | 2.4 GB | ~3 GB |

这个量化器刻意保守：

- 已以 F32 存储的张量保持不动，因此声码器在所有变体之间都是逐位一致的。对生成波形的网络做量化正是让 TTS 模型听起来沙哑粗糙的原因，所以这里从不这样做。
- 词元与音频嵌入最多降到 Q8_0。
- K 量化要求行长度能被 256 整除。不能整除的行会退回到 Q8_0，再退回到 F16。
- 1D 张量、归一化、偏置以及 3D 的码本输出头从不量化。

Q4_K 是合理的默认选择。质量损失落在骨干网络和文本编码器上，影响的主要是语句节奏而非音色。

### 单独量化深度解码器

`--depth` 为深度解码器指定独立的类型：

```
breeze-quantize breeze-tts-2-f16.gguf breeze-tts-2-q4_k-dd2.gguf q4_k --depth q2_k
```

这能廉价地换来吞吐量。深度解码器每帧要运行 15 次顺序的单词元传递，是生成中最大的单项开销。下表是在深度解码器改为每帧一张图之前测量的，当时它的大部分时间花在调度开销上。现在这些开销已经消失，剩下的主要是权重读取，所以每一行实际都比表中显示的更快，更小的深度类型应当能比表中所暗示的省下更多。在当前版本中，Q8_0 配 Q4_K 深度解码器在深度部分每帧耗时 23.86 ms。以下是在 RTX 3060 上跑五次取中位数、改动之前测得的结果：

| 模型 | 深度类型 | 大小 | 每帧深度耗时 | 每帧总耗时 | 实时倍率 |
| --- | --- | --- | --- | --- | --- |
| Q8_0 | Q8_0 | 3.3 GB | 42.96 ms | 64.20 ms | 1.25x |
| Q8_0 | Q4_K | 3.2 GB | 38.92 ms | 59.28 ms | 1.35x |
| Q8_0 | Q2_K | 3.1 GB | 35.21 ms | 55.53 ms | 1.44x |
| Q4_K | Q4_K | 2.4 GB | 39.20 ms | 58.64 ms | 1.30x |
| Q4_K | Q2_K | 2.3 GB | 36.89 ms | 55.71 ms | 1.44x |

把深度解码器降到 Q2_K，用大约 70 MB 换来约 15% 的吞吐量。

### 实际代价比表面看起来更大

短音频掩盖了损害。Q2_K 深度解码器念一个句子听起来没问题，但连续说话超过半分钟就会崩坏，先是发闷，然后变得单薄刺耳。在同一段文本和同一个随机种子下实测的 6 kHz 以上平均能量，中间两行之间唯一的区别就是深度解码器：

| 模型 | 深度类型 | 6 kHz 以上能量 |
| --- | --- | --- |
| F16 | F16 | 2.2% |
| Q8_0 | Q8_0 | 13% |
| Q8_0 | Q2_K | 0.5% |
| Q4_K | Q2_K | 1.9% |

这里发生了两件事。深度解码器预测码本 1 到 15，即骨干网络选出的粗码本之上的残差细节，因此量化它会直接削掉频谱顶部。更糟的是，它输出的每一帧都会作为下一个输入反馈回骨干网络，所以误差位于反馈回路之内，文本越长累积越多。这就是为什么它随时间退化而不是均匀劣化，也是为什么它在每段被切分的文本开头会恢复——那里的上下文是重新开始的。

想要短语句的吞吐量时可以用 `--depth`。对任何长内容或任何在意保真度的场景，让深度解码器保持与基础类型一致。全程 `Q8_0` 是安全的选择。

`q3_k` 和 `q2_k` 也可用于整个模型，但几乎没有什么理由去用它们。骨干网络受带宽限制，其退化是人耳可以听出来的。

## 张量命名

GGUF 张量名按阶段分组。

| 前缀 | 阶段 |
| --- | --- |
| `te.*` | T5Gemma2 文本编码器 |
| `bb.*` | Qwen3 骨干网络 |
| `dd.*` | 深度解码器 |
| `audio_embd.weight` | 音频嵌入，骨干网络与深度解码器共享 |
| `codec.enc.*`, `codec.enct.*` | 声码器编码器，仅用于声音克隆 |
| `codec.sq.*`, `codec.aq.*` | 编码器语义与声学量化器 |
| `codec.dq.*` | 解码器分裂残差量化器 |
| `codec.dpre.*`, `codec.dtf.*` | 解码器预卷积与 transformer |
| `codec.dup.*` | ConvNeXt 上采样块 |
| `codec.dhead.*`, `codec.dblk.*`, `codec.dfin.*` | 解码器块与输出头 |

元数据键位于 `breeze.` 之下，并按阶段分组，例如 `breeze.te.*`、`breeze.bb.*`、`breeze.dd.*`、`breeze.codec.*` 和 `breeze.codec.dec.*`。

## 采样默认值

存储在 GGUF 元数据中，与参考实现一致：

| 键 | 值 |
| --- | --- |
| `breeze.temperature` | 0.9 |
| `breeze.top_k` | 50 |
| `breeze.top_p` | 1.0 |
| `breeze.repetition_penalty` | 1.1 |
| `breeze.depth_temperature` | 0.9 |
| `breeze.depth_top_k` | 50 |
| `breeze.depth_top_p` | 1.0 |
| `breeze.max_new_tokens` | 750 |
