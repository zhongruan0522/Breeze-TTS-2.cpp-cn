# 服务器 API

`breeze-server` 是一个基于 cpp-httplib 构建的单二进制 HTTP 服务器。它加载一个模型，通过 HTTP 对外提供服务，并在音频生成的同时流式输出原始 PCM，而不是等待整段音频完成。

| 端点 | 用途 |
| --- | --- |
| `GET /health` | 存活探测、采样率、WebSocket 端口 |
| `POST /v1/audio/speech` | 生成语音，流式返回。也接受 OpenAI 风格的 JSON，参见 [OpenAI 兼容请求](#openai-兼容请求) |
| `POST /v1/audio/convert` | 用另一个声音重新演绎一段录音，参见 [voice-conversion.md](voice-conversion.md) |
| `POST /v1/voices` | 注册或保存一个参考音色，参见 [voices.md](voices.md) |
| `GET /v1/voices` | 列出已缓存和已保存的音色 |
| `GET /v1/voices/<id>` | 单个音色，含其描述与元数据 |
| `PATCH /v1/voices/<id>` | 修改音色的描述与元数据，参见 [voices.md](voices.md#descriptions-and-metadata) |
| `DELETE /v1/voices/<id>` | 从内存中丢弃一个音色 |

一个独立的 WebSocket 监听器负责处理增量文本、流中途的演绎指令变更以及打断。它在 [websocket.md](websocket.md) 中有说明。

## 启动服务器

```
breeze-server <model.gguf> [--host H] [--port P] [--webui] [--cpu]
                           [--chunk-first N] [--chunk-max N] [--verbose]
                           [--voices-dir PATH] [--ws-port P] [--split-chars N]
                           [--cors [ORIGINS]] [--no-warmup] [--parallel N]
                           [--talk] [--llm URL] [--tyger URL]
```

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `--host` | `127.0.0.1` | 绑定的网络接口。用 `0.0.0.0` 接受远程连接。 |
| `--port` | `8080` | TCP 端口。 |
| `--webui` | 关 | 同时在 `/` 提供浏览器 UI。 |
| `--cpu` | 关 | 强制使用 CPU 后端而非 Vulkan。 |
| `--te-cpu` | 关 | 在 CPU 上运行文本编码器并将其权重保存在系统内存中，可节省约 1 GB 显存。每段文本会增加约 0.7 s 的耗时，带 guidance 时约 1.3 s。不要与 `--parallel` 同时使用，它会暂停其他流。参见 [performance.md](performance.md#short-on-video-memory)。 |
| `--chunk-first` | `1` | 首个流式块中最少的帧数。当 GPU 太忙、来不及以此帧数保持领先时，它会自行上调。 |
| `--chunk-max` | `25` | 块逐渐爬升到的帧数上限。 |
| `--verbose` | 关 | 在每个请求结束后输出各阶段耗时明细。 |
| `--voices-dir` | `voices` | 启动时加载已保存 `.breeze` 音色的文件夹。参见 [voices.md](voices.md)。 |
| `--ws-port` | HTTP 端口 + 1 | 流式会话使用的端口。`-1` 表示禁用。参见 [websocket.md](websocket.md)。 |
| `--split-chars` | `600` | 长文本默认按该长度切分。`0` 表示一次性整段送入。单个请求仍可覆盖此值。 |
| `--cors` | 关 | 允许来自其他源的浏览器页面调用 API。不带参数时允许任意源；给出逗号分隔的列表则只允许列表中的源。参见 [跨源请求](#跨源请求)。 |
| `--no-warmup` | 关 | 跳过启动时的预热。见下文。 |
| `--parallel` | `1` | 同时生成的流数。使用 guidance 的流算作两个。参见 [performance.md](performance.md#running-several-streams)。 |
| `--talk` | 关 | 在 `/talk` 提供语音通话演示。参见 [语音通话演示](#语音通话演示)。 |
| `--llm` | 带 `--talk` 时为 `http://127.0.0.1:1234/v1` | 演示页面获取回复所用的 OpenAI 兼容服务器，通过 `/llm/` 透传。 |
| `--tyger` | `ws://127.0.0.1:8765/ws` | 演示页面用于话轮转换（turn taking）的 tyger-server WebSocket。 |

```
breeze-server breeze-tts-2-q4_k.gguf --port 8137 --webui
```

在开始监听之前，服务器会对 `--parallel` 设定允许的每种流组合（带 guidance 与不带 guidance）各跑一次短促的一次性生成，并解码几种大小的音频块。这一步会建立首次真实请求本需临时搭建的 GPU 流水线。这样，启动后的第一个请求在 RTX 3060 上约 200 到 350 ms 即可出首段音频，后续请求约 80 ms。`--parallel 1` 时它给启动增加约 3 s，`--parallel 4` 时约 8 s。`--no-warmup` 可跳过它。

## 控制台输出

每个请求会打印一个随音频流式输出而填充的进度条，然后打印一段汇总。

```
gen  design, 291 chars, cfg 1.0, seed 7
 87%|████████████████████▉   | 15.1/17.4s [00:11<00:01, 16.2 fps, 1.30x]
100%|████████████████████████| 19.4/19.4s [00:15, 16.1 fps, 1.29x]
     242 frames in 11 flushes, first audio 588 ms
```

总时长是根据文本估算的，因为模型自行决定何时停止，所以进度条可能提前到 100%，也可能超出估算继续走。最后一行会用真实数字重写它。`fps` 是每秒生成的帧数，对比每秒 12.5 帧音频，所以末尾那个数字就是实时率，任何高于 `1.00x` 的值都意味着比播放更快。

`--parallel` 大于 1 时不显示移动的进度条，因为多个流会互相覆盖。每个请求仍会打印最终进度条和汇总。

HTTP 端口和 WebSocket 端口都没有鉴权，也没有速率限制。不要把它们直接暴露到互联网上；请放在能同时处理两者的反向代理之后。

## 跨源请求

内置的 Web UI 与 API 同源，所以它什么都不需要。而从其他任何地方提供的页面（例如 Vite 开发服务器或独立前端）会被浏览器拦截，除非服务器发送 CORS 头。服务器默认不发送。用 `--cors` 打开：

```
breeze-server model.gguf --cors
breeze-server model.gguf --cors http://localhost:5173,https://app.example.com
```

不带参数时，该参数会对所有源应答 `Access-Control-Allow-Origin: *`。给出列表时，只有当请求的 `Origin` 与某个条目完全一致（含协议和端口）时才会回显它，并加上 `Vary: Origin` 以便缓存区分各应答。不在列表中的源得不到 CORS 头，浏览器会拒绝该响应。

`X-Sample-Rate` 和 `X-Sample-Format` 列在 `Access-Control-Expose-Headers` 中，因此跨源页面可以像内置 UI 一样读取采样率。预检 `OPTIONS` 请求（浏览器在对 `/v1/voices/<id>` 发起 `DELETE` 和 `PATCH` 之前发送）会以 `204` 应答并缓存一天。

WebSocket 端口不受影响。浏览器不对 WebSocket 应用 CORS，无论此参数如何，套接字都接受来自任何页面的连接，正如 [websocket.md](websocket.md) 所述。

## 流式播放不卡顿

两个数字决定一条流能否顺畅播放，它们的失败方式各不相同。把其中一个调对并不能让你免于另一个。

### 实时率

实时率是每秒墙钟时间产出的音频秒数。高于 1.0 时模型跑赢播放；低于 1.0 时再多缓冲也无济于事，因为客户端消耗的速度比服务器填充的速度快。

请在你自己的硬件上实测，而不是凭假设：

```
curl -s -o out.pcm -w "%{time_total}\n" \
  --form-string "text=<a sentence long enough to take several seconds>" \
  http://127.0.0.1:8137/v1/audio/speech
```

音频秒数是 `bytes / 2 / 24000`，所以实时率就是它除以 `time_total`。在 RTX 3060 上，使用默认参数时长片段在 Q4_K 下约 2.4x，Q8_0 下约 2x。繁忙的 GPU 仍会侵蚀这一数字，其他流也会，参见 [performance.md](performance.md#running-several-streams)。

guidance 的代价没有看起来那么大。`cfg_scale` 高于 1 会增加一次前向传播，但深度解码器把两个分支合批进同一张计算图，所以 16 秒的段落在 `cfg_scale` 3 下实测为 Q4_K 1.74x、Q8_0 1.59x，仍远高于实时。声音克隆还会增加一次约 650 ms 的一次性参考编码，它体现在首段音频的等待时间上，而不是实时率上。

如果你的实测接近或低于 1.0，任何客户端设置都救不了它。换成更小的量化、调低 `--parallel`，或使用更快的设备。提高 `--chunk-max` 在这里已不再有帮助。用 `--depth` 量化深度解码器也有帮助，但它会损伤高频，且损伤随长段落累积，请对照 [models.md](models.md) 中的数据权衡。

### 队列深度

在实时率看起来正常的机器上，真正导致卡顿的是它。

客户端的队列被持续消耗，却按块一次性补满，所以队列深度必须超过生成一个完整块所需的时间。在 `--chunk-max 40` 下，一个块是 3.2 s 的音频，生成大约要 2 s，于是只持有 0.5 s 音频的客户端会因等待而耗尽，即便平均速率绰绰有余。

服务器现在自行处理了其中大部分。它假定每个块一到达就开始播放，并跟踪这些音频何时耗尽。如果等待填满当前块会导致客户端无音频可播，它会提前把已有的帧发出去，并在缓冲重新建立之前保持较小的块大小。只有当短块播放的时间长于生成和解码它所需的时间时才会这样做，否则一串极小的块只会进一步落后而非追上。这个判断所依据的时间还包括共享 GPU 的其他流。

在 RTX 3060、Q8_0 下的实测（早推送功能加入时），客户端从第一个数据包就开始播放且不做任何缓冲，以 `cfg_scale` 3（最慢的常见情形）读取一段 21 秒的段落：

| `--chunk-max` | 之前 | 早推送 | 加上单计算图深度解码器 |
| --- | --- | --- | --- |
| 25 | 5 处空隙，222 ms 静音 | 无 | 无 |
| 40 | 6 处空隙，308 ms | 1 处空隙，73 ms | 无 |
| 60 | 7 处空隙，442 ms | 1 处空隙，18 ms | 无 |

不带 guidance 时所有配置都没有空隙。早推送在 guidance 下损失了百分之几的吞吐量（默认配置下 1.17x 对 1.22x），而更快的深度解码器以 1.33x 更多地赢回来了。当前版本以这种方式读取 16 秒段落可达 1.59x 且无空隙。

老规则仍然给出最大的裕量：**缓冲的音频要多于最慢一个块的生成时间。** 内置 UI 预缓冲 1.25 s。只是现在它重要得多了，完全不能缓冲的客户端大多也能应付过去。

注意预缓冲与延迟的区别。把第一个块推迟半秒开始并不会建立缓冲，只是把起点后移；队列里仍然只有一个块。要累积块，直到你真正持有 N 秒音频，再把它们背靠背播放。内置 UI 就是这么做的，并把 N 作为缓冲滑块暴露出来。

### 调整块爬升

音频以整帧为单位分块送入声码器，每秒 12.5 帧。第一个块决定了客户端要等多久才听到声音，所以块从小开始，每次推送增长三分之一，直到达到 `--chunk-max`。

声码器在两次推送之间保留状态，只解码新帧，所以小块现在很便宜，提高上限不再带来任何收益。在 RTX 3060、Q8_0 下对一段 18 秒的片段实测：

| `--chunk-max` | 推送次数 | 声码器每帧耗时 |
| --- | --- | --- |
| 8 | 31 | 2.90 ms |
| 25 | 15 | 2.17 ms |
| 50 | 13 | 2.16 ms |

如果客户端想要更小的缓冲，调低才是有用的方向。降到 8 会损失约 2% 的总速度。

`--chunk-first` 是下限，默认的 1 帧是启动最快的设置。当 GPU 太忙时，服务器会自行上调第一个块。在 Q8_0 的 `breeze-cli` 中，设为 4 使首段音频从 278 ms 变为 394 ms，每帧只省下 0.14 ms。

把两个参数设为相同值会禁用爬升，以固定大小流式输出。其余内容见 [performance.md](performance.md#tuning-settings)。

### 小结

- 保持 `--chunk-max` 为默认值，或者在你想要更小的客户端缓冲时调低它。
- 服务器会在客户端即将耗尽时提前发送，所以小缓冲就够了。在 guidance 下约 1 s 仍给出最大的裕量。
- 按填充量预缓冲，而不是按延迟。
- 如果无论缓冲多少都卡顿，先检查实时率。

## `GET /health`

存活探测。模型加载完毕并就绪后即返回。

```
curl http://127.0.0.1:8137/health
```

```json
{"status":"ok","sample_rate":24000,"ws_port":8081}
```

服务器在加载完成前不接受连接，所以一次成功响应也意味着模型已就绪。启动后请轮询此端点，而不是猜测延迟。

`ws_port` 是流式套接字最终使用的端口，禁用时为 `0`，这样客户端可以发现它，而不需要事先配置。

## `POST /v1/audio/speech`

生成语音并流式返回。

接受 `multipart/form-data`（上传参考音频时必需）或 `application/x-www-form-urlencoded`。

### 字段

| 字段 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `text` | string | 必填 | 要朗读的文本，UTF-8。 |
| `instruction` | string | `Speak clearly and naturally.` | 音色描述或演绎指令。 |
| `ref_audio` | file | 无 | 用于声音克隆的参考 WAV。任意采样率或声道数；会被重采样为模型采样率的单声道。完全相同的重复上传（字节与转写文本都相同）会复用内存哈希缓存中的参考编码，而不会重新编码；参见 [voices.md](voices.md)。 |
| `ref_text` | string | 空 | `ref_audio` 的精确转写文本。只要提供 `ref_audio` 就必须填写。 |
| `voice_id` | string | 无 | 一个已保存或已缓存的音色，用它克隆而无需上传音频片段。跳过参考编码。参见 [voices.md](voices.md)。 |
| `cfg_scale` | float | `1.0` | 分类器无关引导（classifier free guidance）。`1.0` 表示禁用。 |
| `seed` | int | `42` | 随机数种子。 |
| `temperature` | float | 模型默认 | 采样温度。`0` 保持构建 GGUF 时所用的值。 |
| `top_k` | int | 模型默认 | 采样的 top-k。`0` 保持模型默认。 |
| `top_p` | float | 模型默认 | 采样的 top-p。`0` 保持模型默认。 |
| `repetition_penalty` | float | 模型默认 | 重复惩罚。`0` 保持模型默认。 |
| `split_chars` | int | `--split-chars` | 长文本按句子边界切成约该大小的片段并逐段生成。`0` 表示一次性生成。 |
| `max_new_tokens` | int | 模型默认 | 每个片段的帧数上限，每秒 12.5 帧。`0` 使用模型默认值 750。 |

每个采样相关字段都把 `0` 视为"使用模型默认"，所以省略它们的行为与之前完全一致，而不会强制为零。

`text` 没有长度限制。超出预算的部分会被切分并逐段生成，每段都以第一段为条件，因此音色不会中途改变。一次生成数分钟的内容是 `split_chars 0` 的做法，而模型早在帧数用尽之前就跟不上文本了，所以除非有理由，否则请保持切分开启。用 `--split-chars 0` 启动服务器会对所有未自行设置该值的请求关闭切分。

### 响应

`200 OK`，chunked 响应体。

| 头部 | 值 |
| --- | --- |
| `Content-Type` | `audio/pcm` |
| `Transfer-Encoding` | `chunked` |
| `X-Sample-Rate` | `24000` |
| `X-Sample-Format` | `s16le` |
| `Cache-Control` | `no-store` |

响应体是**无文件头**的有符号 16 位小端单声道 PCM。它不是 WAV 文件。需要的话请自行封装，或使用直接输出 WAV 的 CLI。

块大约每生成 2 秒音频到达一次，所以播放可以在生成远未结束时就开始。

### 错误

| 状态码 | 响应体 | 原因 |
| --- | --- | --- |
| `400` | `{"error":"text is required"}` | `text` 缺失或为空。 |
| `404` | `{"error":"unknown voice_id"}` | 没有该名称的已缓存或已保存音色。 |
| `409` | `{"error":"busy"}` | 所有生成槽位都被占用。 |

服务器持有一个模型，默认一次只服务一个请求。`--parallel` 可以提高这个数目，使用 guidance 的请求占两个槽位，参见 [performance.md](performance.md#running-several-streams)。放不下的请求会立即被 `409` 拒绝而不是排队，因此客户端应当带退避地重试。WebSocket 端点选择排队而不是拒绝，这是会话类应用更适合它的原因之一。

由于响应是流式的，发生在**首个块之后**的失败无法更改状态码。连接会提前关闭，因此请把被截断的响应体当作错误处理。

### 示例

文本字段请用 `--form-string` 发送，不要用 `-F`。`curl` 会把以 `(` 开头的值当作 multipart 组的开始，所以 `-F "text=(sigh) ..."` 会发出一个空字段，模型最终会把 multipart 边界字符串朗读出来。

声音设计：

```
curl -X POST http://127.0.0.1:8137/v1/audio/speech \
  --form-string "text=Welcome aboard. Your journey begins now." \
  --form-string "instruction=A warm, thoughtful young woman with a clear, calm delivery." \
  --form-string "cfg_scale=1" \
  --form-string "seed=42" \
  -o speech.pcm
```

声音克隆：

```
curl -X POST http://127.0.0.1:8137/v1/audio/speech \
  --form-string "text=It is good to hear your voice again." \
  -F "ref_audio=@reference.wav" \
  --form-string "ref_text=This is the exact transcript of the reference audio." \
  -o clone.pcm
```

声音指向，即克隆加指令：

```
curl -X POST http://127.0.0.1:8137/v1/audio/speech \
  --form-string "text=We need to discuss what happened last night." \
  --form-string "instruction=Speak slowly with a restrained, serious tone." \
  -F "ref_audio=@reference.wav" \
  --form-string "ref_text=This is the exact transcript of the reference audio." \
  --form-string "cfg_scale=1" \
  -o direction.pcm
```

直接播放 `curl` 输出的原始流：

```
curl -sN -X POST http://127.0.0.1:8137/v1/audio/speech --form-string "text=Hello there." \
  | ffplay -f s16le -ar 24000 -ac 1 -nodisp -autoexit -
```

转换为 WAV：

```
ffmpeg -f s16le -ar 24000 -ac 1 -i speech.pcm speech.wav
```

## OpenAI 兼容请求

`POST /v1/audio/speech` 也接受 OpenAI 语音 API 的 JSON 请求体，因此为它构建的应用（如 SillyTavern 或官方 OpenAI SDK）可以原封不动地指向本服务器。`Content-Type` 头决定你得到哪一种行为：`application/json` 得到此处描述的行为，表单提交则得到上面的原生行为。

```
curl http://127.0.0.1:8137/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"tts-1","input":"Hello from Breeze.","voice":"narrator","response_format":"mp3"}' \
  -o speech.mp3
```

使用 Python SDK：

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8137/v1", api_key="unused")
with client.audio.speech.with_streaming_response.create(
    model="tts-1", voice="narrator", input="Streaming from the OpenAI SDK.",
) as r:
    r.stream_to_file("speech.mp3")
```

### 字段

| 字段 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `input` | string | 必填 | 要朗读的文本，UTF-8。 |
| `voice` | string 或 `{"id": ...}` | 无 | 一个已保存或已缓存的音色，与 `voice_id` 接受的 id 相同。省略它则改为基于 `instructions` 进行声音设计。 |
| `instructions` | string | `Speak clearly and naturally.` | 设计音色时作为音色描述，克隆音色时作为演绎指令。 |
| `response_format` | string | `mp3` | `mp3`、`wav` 或 `pcm`。`opus`、`aac` 和 `flac` 会被接受但以 WAV 发送。 |
| `stream_format` | string | `audio` | `audio` 流式传输文件本身，`sse` 把它包装进服务器发送事件。 |
| `model` | string | 忽略 | 接受它是为了让总是发送该字段的客户端继续工作。 |
| `speed` | number | 忽略 | 模型没有语速控制。 |

原生字段 `cfg_scale`、`seed`、`temperature`、`top_k`、`top_p`、`repetition_penalty`、`max_new_tokens` 和 `split_chars` 可作为额外的 JSON 字段接受，含义与默认值同上。

OpenAI 自带的音色名（如 `alloy` 或 `nova`）并未内建，服务器不认识的名称会返回 `404`。如果客户端坚持使用这些名称，请用 `POST /v1/voices` 以它们命名保存音色（参见 [voices.md](voices.md)），之后它们就和其他音色一样可用。

### 格式

| `response_format` | 发送形式 | `Content-Type` |
| --- | --- | --- |
| `mp3` | MP3，80 kbps 单声道，48 kHz | `audio/mpeg` |
| `wav` | 16 位单声道 WAV，24 kHz | `audio/wav` |
| `pcm` | 无文件头 s16le 单声道，24 kHz，与原生端点及 OpenAI 自家的 `pcm` 相同 | `audio/pcm` |
| `opus`、`aac`、`flac` | WAV | `audio/wav` |

所有格式都在生成过程中流式传输，因此播放可以从第一个块就开始。WAV 头会先发出，其长度字段被设为最大值，因为长度尚不可知。浏览器和 ffmpeg 都能读到流的末尾。

MP3 用 [shine](https://github.com/toots/shine) 编码，它从 `third_party/shine` 子模块构建。音频会先上采样到 48 kHz，因为 Chrome 和 Edge 拒绝 shine 写出的 24 kHz 帧，所以 MP3 响应上的 `X-Sample-Rate` 是 48000。没有该功能的构建，或以 `-DBREEZE_MP3=OFF` 配置的构建，在请求 `mp3` 时也会发送 WAV。每个请求的控制台行会说明实际发出的内容，例如 `openai wav for opus`。

### 服务器发送事件

使用 `"stream_format": "sse"` 时，响应为 `text/event-stream`。每个块以 `speech.audio.delta` 事件到达，携带文件在 `response_format` 格式下的下一段字节（base64 编码），最后以 `speech.audio.done` 事件结束。

```
data: {"type":"speech.audio.delta","audio":"//NIxAAAAAAAAAAAAFhpbmcAAAAPAAAA..."}

data: {"type":"speech.audio.done","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}
```

解码这些 delta 并拼接起来，得到的文件与普通请求返回的完全相同。token 计数始终为零。

### 错误

这条路径上的错误使用 OpenAI 的错误格式，因此客户端会显示具体消息而不是裸状态码。

```json
{"error":{"message":"input is required","type":"invalid_request_error","param":null,"code":null}}
```

| 状态码 | 原因 |
| --- | --- |
| `400` | 请求体不是 JSON 对象、`input` 缺失，或某个字段类型错误或取值未知。 |
| `404` | `voice` 不是已保存或已缓存的音色。 |
| `409` | 所有生成槽位都被占用。OpenAI SDK 会自行重试。 |

`Authorization` 头被忽略，任何 API key 都可用。这也意味着仍然没有鉴权，参见上面的警告。

### SillyTavern

打开 TTS 扩展，选择 **OpenAI Compatible** 作为提供方并填写：

| 设置 | 值 |
| --- | --- |
| Provider Endpoint | `http://127.0.0.1:8137/v1/audio/speech` |
| API Key | 任意，会被忽略。 |
| Model | 任意，会被忽略。 |
| Available Voices | 你想要的音色 id，逗号分隔，如 `narrator,harbour`。`GET /v1/voices` 返回的列表包含全部。 |

默认音色列表是 OpenAI 的名称，在你替换它之前都会返回 `404`。语速不起作用。SillyTavern 请求的是 MP3，它得到的也正是 MP3。

## 流式客户端示例

```python
import struct
import urllib.request

body, boundary = build_multipart({"text": "Streaming from python."})
req = urllib.request.Request(
    "http://127.0.0.1:8137/v1/audio/speech",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
)

with urllib.request.urlopen(req) as r:
    rate = int(r.headers["X-Sample-Rate"])
    tail = b""
    while chunk := r.read(8192):
        chunk = tail + chunk
        n = len(chunk) // 2
        tail = chunk[n * 2:]
        samples = struct.unpack(f"<{n}h", chunk[:n * 2])
        play(samples, rate)
```

在两次读取之间缓冲可能残留的奇数尾巴字节，因为块边界可能落在一个采样的中间。

## Web UI

`--webui` 挂载一个深色粗野主义风格的单页 UI，对应参考的 Gradio 演示。

| 路由 | 提供 |
| --- | --- |
| `GET /` | `index.html` |
| `GET /style.css` | 样式表 |
| `GET /app.js` | 客户端脚本 |

它有三个标签页，对应三种生成模式，并且都提交到同一个 `/v1/audio/speech` 端点。

**边生成边播放**默认开启。UI 增量读取响应体，并在每个 PCM 块到达时通过 Web Audio API 调度播放，所以大约一秒后就能开始播放，而不必等整段音频渲染完。一个运行中的计数器显示已产出多少音频，如果队列曾耗尽还会附加一次重缓冲计数。生成结束后，同样的 PCM 会被封装成 WAV blob，供播放器和下载链接使用。

**缓冲**是 UI 开始播放前持有的音频量，而不是它等待多久。块会不断累积，直到队列达到该值，然后背靠背播放。默认的 1.25 s 覆盖了此处的默认参数；如果你调高了 `--chunk-max` 或看到重缓冲，就调高它；如果你想要更快的启动且实时率有余量，就调低它。如果队列真的耗尽了，UI 会在该片段剩余部分自行扩大缓冲，而不是反复卡顿。

关掉该开关则会先缓冲整个响应，再用 `<audio>` 元素回放，如果你想要拖动进度条试听结果而不是尽可能早地听到声音，这是更好的选择。

这些资源在构建时由 `cmake/embed_webui.cmake` 从 [webui](../webui) 文件夹编译进二进制文件，所以没有需要部署的静态目录。编辑那里的文件并重新构建即可生效。

## 语音通话演示

`--talk` 在 `/talk` 提供一个语音通话页面。你选一个角色，它接起电话，你就可以和它当面交谈。它还需要另外两个东西在运行：

- [tyger-server](https://github.com/HoppouAI/tyger.cpp)，用于语音识别和话轮转换。它判断你什么时候说完、什么时候在打断，以及什么时候插入一句"嗯哼"比较合适。
- 任意 OpenAI 兼容的聊天服务器，例如 LM Studio、Ollama 或 llama.cpp 的 server，用于生成回复。页面通过本服务器的 `/llm/` 调用它，所以聊天服务器不需要 CORS。

```
tyger-server -m models/tyger-q8_0.gguf --port 8765
breeze-server breeze-tts-2-q4_k.gguf --talk --llm http://127.0.0.1:1234/v1
```

然后打开 http://127.0.0.1:8080/talk。戴耳机效果最好，因为除了浏览器自带的能力外，页面本身没有回声消除。

页面通过你打开它的那个地址访问一切。语音套接字连接到该主机，聊天服务器经由本服务器的 `/llm/` 转发，而像默认值那样的回环 `--tyger` 地址也会被替换为该主机。要从其他设备使用它，请以 `--host 0.0.0.0` 启动两个服务器。浏览器只允许在 https 或 localhost 上使用麦克风，所以从其他设备访问时页面必须通过 https 提供，例如放在反向代理之后。在 https 之后，套接字会自动切换到 `wss://`。

| 路由 | 提供 |
| --- | --- |
| `GET /talk` | 页面本身 |
| `GET /talk/config` | 页面所需的 WebSocket 端口、tyger 地址和采样率 |
| `GET, POST /llm/...` | 透传到 `--llm` 服务器，流式返回 |

聊天服务器的回复直接流式送入一个 [WebSocket](websocket.md) 会话。第一个分句以 `flush` 发出，让语音在整句话说完之前就开始，其余部分随后以 `text` 跟进。当你打断角色时，会话被取消，只有你实际听到的部分会进入聊天记录，并以"..."结尾，让模型知道自己被打断了。

一切都在页面的 Settings 中设置并保存在浏览器里：

- **角色。** 名字、颜色、性格和可选的开场白。声音可以是一个已保存的音色，也可以是用于声音设计的描述。已保存的音色每次通话听起来都一样；设计的音色每次会稍有不同。页面还可以从文件或录音克隆新音色，并用 tyger 转写。
- **说话规则。** 追加在每个角色的性格之后。默认值让回复简短随意，用"..."表示停顿，并允许 `(laugh)` 或 `(sigh)` 这样的发声事件标签，让声音真的能笑出来。
- **话轮转换。** 回复前等待多久、能否打断以及多容易打断，还有附和（backchannel）。tyger 自身的打断分数会漏掉"等等，先别急"这类短促的打断，所以对着角色连续说约一秒也能让它停下。当一次打断其实只是"嗯哼"或什么都没有时，角色会从停下的地方继续。附和是每次通话用角色音色一次性生成的短语；没有已保存音色时，它们从第一次回复之后开始，从该回复克隆。它们也可以由聊天模型根据你正在说的内容撰写，这样更贴切，但每句要花约一秒。
- **声音。** 语音模型的 guidance 与温度。
- **屏幕共享。** 通话中的 Share screen 按钮让角色看到你的屏幕，就像视频通话一样。共享期间，你说的每句话都附带一张最新的屏幕画面，且只发送最新一张，因此聊天记录保持纯文本。它需要一个接受图像的聊天模型。如果你的模型不支持，页面会说明，角色会在没有画面的情况下回答。画面大小设置权衡的是小字可读性与每次回复前的等待时间。
- **对话。** 选择哪个聊天模型、温度、回复长度、托管服务器的 API key，以及是否跳过推理模型的思考步骤。
