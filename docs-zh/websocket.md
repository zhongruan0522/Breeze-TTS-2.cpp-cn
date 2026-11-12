# WebSocket API

HTTP 端点已经支持流式输出音频，并且会在客户端断开时停止生成，所以 WebSocket 存在的意义在于分块 HTTP 做不到的事情：文本随到随喂、中途调整演绎方式、打断而不拆除连接，以及让一个会话跨越多行文本持续存在。

cpp-httplib 不支持 WebSocket，也不会在协议升级后交出 socket，所以这里是直接在它自己的监听器上实现的 RFC 6455。这就是为什么它是第二个端口而不是一条路由。

## 连接

端口默认为 HTTP 端口加一。`--ws-port` 可以移动它，`--ws-port -1` 则关闭它。`GET /health` 会报告最终端口，客户端无需被告知即可自行发现：

```json
{"status":"ok","sample_rate":24000,"ws_port":8081}
```

```
ws://127.0.0.1:8081
```

**文本帧是 JSON 控制消息，二进制帧是音频。** WebSocket 在帧协议层就已经区分了两者，所以音频不需要任何封装，也不需要 base64。音频是 `ready` 消息中指定采样率的无头有符号 16 位小端单声道 PCM，与 HTTP 响应体完全一致。

## 你发送的消息

| `type` | 字段 | 含义 |
| --- | --- | --- |
| `start` | `voice_id`, `instruction`, `ref_text`, `cfg_scale`, `seed`, `temperature`, `top_k`, `split_chars` | 打开会话。参考声音只为整个会话编码一次。 |
| `text` | `text` | 追加文本。完整的句子在完成时立即朗读，其余部分等待。 |
| `flush` | `text` | 把所有已缓冲内容连同这段文本作为一个片段朗读，无论是否以句末结尾。适用于客户端已自行拆分文本的情况。 |
| `instruction` | `instruction` | 对其后排队的每个片段变更演绎方式。 |
| `cancel` | | 在句子中途停止，并丢弃所有已缓冲内容。 |
| `end` | `text` | 追加最后的文本，朗读全部内容，然后报告 `done`。 |

`start` 接收的是 `voice_id`，而不是文件。参考音频片段通过 HTTP 上传到 `POST /v1/voices`，由它返回一个 id。见 [voices.md](voices.md)。省略 `voice_id` 则进入由 `instruction` 驱动的声音设计模式。

## 你接收的消息

| `type` | 字段 | 含义 |
| --- | --- | --- |
| `ready` | `sample_rate`, `format` | 连接已建立。发送 `start`。 |
| `started` | `voice_id` | 会话已打开。 |
| `speaking` | `text` | 即将生成的片段。 |
| `queued` | | 所有生成槽位都被占用。在等待，而非被拒绝。 |
| `instruction_set` | | 新的演绎方式从此处之后发送的文本开始生效。 |
| `cancelled` | | 生成被打断。 |
| `done` | | 所有已缓冲内容都已朗读完毕。 |
| `error` | `message` | 请求有问题。 |

## 一个会话

```json
-> {"type":"start","voice_id":"harbour","seed":7}
<- {"type":"started","voice_id":"harbour"}
-> {"type":"text","text":"The harbour was quiet that morning. "}
<- {"type":"speaking","text":"The harbour was quiet that morning."}
<- <binary audio>
-> {"type":"instruction","instruction":"Speak in an urgent, alarmed whisper."}
<- {"type":"instruction_set"}
-> {"type":"end","text":"Then the alarm went off."}
<- {"type":"speaking","text":"Then the alarm went off."}
<- <binary audio>
<- {"type":"done"}
```

## 文本随到随喂

文本会被缓冲并按句子边界排出，所以没有构成完整句子的片段会被保留而不朗读。把 LLM 的输出原样随流发送，每个句子就会自然成为一个片段，无需额外工作。

如果缓冲在 `split_chars` 之内没有等到句末就继续增长，它会改在空格处断开，所以没有标点的文本同样会被朗读。`flush` 会强制朗读所有等待中的内容。它默认取服务器的 `--split-chars`，但与 HTTP 端点不同，它无法关闭，因为排出缓冲需要一个目标长度。在这里 `0` 会回退到 600。

没有参考片段时，开头的片段会兼任其后所有内容的参考，所以它的长度被限制在正常片段长度附近。过长的第一个片段会让模型更晚开始跳句。

## 中途变更演绎方式

`instruction` 消息作用于在其**之后**排队的每个片段。每个片段都会记住自己入队时生效的指令，因此已经在等待的片段，以及正在生成的片段，都会按各自入队时的演绎方式完成。这意味着夹在两句话之间发出的演绎指令，会精确落在紧随其后的那个句子上，即使文本到达的速度快于 GPU 朗读的速度、队列里已经积压了多个片段也是如此。

效果是真实的，但它是一种助推，而不是彻底的转变。同一句话、同一 seed，在单独生成的片段上测量：

| 指令 | RMS | 频谱质心 |
| --- | --- | --- |
| `Speak clearly and naturally.` | 0.1438 | 1733 Hz |
| `Speak in a breathy, hushed whisper.` | 0.1126 | 1895 Hz |

更安静也更明亮，这正是耳语应有的效果。使用克隆的参考声音时，模型会有意保护参考声音的音色，所以指令移动的是演绎方式，而不是重建声音。没有参考的声音设计会话响应得更强烈。

## 打断

`cancel` 会在当前片段进行到一半时停止，而不是等它完成，并清空仍在缓冲中的内容。已经发送的音频依然有效，客户端可以保留并播放已收到的部分。

会话保持打开。继续发送文本，它会以同一个声音接着朗读。

## 并发

服务器按其 `--parallel` 设置同时生成尽可能多的流，默认为一路，使用引导的会话算作两路。与占满时返回 `409` 的 HTTP 端点不同，socket 会话会**排队等待**，期间报告 `queued`。每个片段各自占用槽位，所以各连接在片段之间交错执行，而不是某一路在整个段落期间阻塞其他连接。见 [performance.md](performance.md#running-several-streams)。

每个连接在独立的线程上读取和生成，这正是 `cancel` 和 `instruction` 能在音频仍在生成时到达的原因。

## 安全性

socket 上没有身份验证、没有来源检查、没有速率限制。它绑定到 `--host`，默认为 `127.0.0.1`。绑定到 `0.0.0.0` 等于把 GPU 无限制地交给网络上的任何人。对外暴露之前，请把它放在一个负责终结 TLS 并处理身份验证的反向代理之后。

## 客户端示例

```python
import asyncio, json, websockets

async def speak(lines):
    async with websockets.connect("ws://127.0.0.1:8081", max_size=None) as ws:
        await ws.recv()  # ready
        await ws.send(json.dumps({"type": "start", "voice_id": "harbour", "seed": 7}))

        async def send():
            for line in lines:
                await ws.send(json.dumps({"type": "text", "text": line}))
            await ws.send(json.dumps({"type": "end", "text": ""}))

        asyncio.create_task(send())
        audio = bytearray()
        async for msg in ws:
            if isinstance(msg, bytes):
                audio.extend(msg)
            elif json.loads(msg)["type"] in ("done", "error"):
                break
        return bytes(audio)
```
