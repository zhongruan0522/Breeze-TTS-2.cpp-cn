# 声音

克隆需要先让参考音频片段通过编解码器处理，才能据此生成任何内容。这次编码是首段音频到来前等待时间中最大的单项开销，而且每次结果都相同，因此值得做一次并保存下来。

在 RTX 3060 上、Q8_0 模型、参考音频时长 5.4 s 的测量结果：

| 参考音频提供方式 | 参考编码 | 首段音频等待时间 |
| --- | --- | --- |
| 上传的 WAV | 548 ms | 906 ms |
| 缓存的声音 | 0 ms | 276 ms |

请求的其他方面没有任何变化。两种方式下相同种子生成的音频逐字节一致，因此这只是省去了重复的工作。

## 两种声音

**缓存**声音存放在内存中。当一个片段在提交时不带名称时就会产生，以片段及其转录文本的哈希为键，服务器重启后消失。同一片段提交两次会返回相同的 id 并跳过编码，因此每次启动都注册的客户端只有第一次有开销。上传到 `/v1/audio/speech` 的原始片段同样会进入这个缓存：处理器对上传内容及其转录文本做哈希，命中时复用已存储的编码，因此单纯的重复上传每个片段只需支付一次编码开销。

**保存**的声音是文件。它们以名称创建，写入 voices 文件夹为 `<name>.breeze`，在启动时加载，且永不过期。CLI、服务器和 Web UI 读取同一个文件夹，因此在一个工具中创建的声音会出现在其他工具里。

## 创建保存的声音

通过 CLI：

```
breeze-cli model.gguf \
  --ref-audio reference.wav \
  --ref-text "This is the exact transcript of the reference audio." \
  --save-voice harbour
```

```
wrote voices/harbour.breeze (67 frames, 5.36 s)
```

通过 HTTP，在注册时附带一个 `name`：

```
curl -X POST http://127.0.0.1:8137/v1/voices \
  -F "ref_audio=@reference.wav" \
  --form-string "ref_text=This is the exact transcript of the reference audio." \
  --form-string "name=harbour"
```

在 Web UI 中，填写参考音频字段，在 SAVE AS 旁输入名称，然后按 SAVE VOICE。它会立即出现在每个面板的下拉列表中。

三种方式都可以同时附带描述，参见 [描述与元数据](#descriptions-and-metadata)。

名称允许字母、数字、连字符和下划线，最多 64 个字符。名称会成为文件名，因此再宽松一些就会让请求写到文件夹之外。

## 使用声音

凡是接受参考音频片段的地方，都改为接受声音 id。

```
breeze-cli model.gguf --voice harbour --text "It is good to hear your voice again."
```

```
curl -X POST http://127.0.0.1:8137/v1/audio/speech \
  --form-string "text=It is good to hear your voice again." \
  --form-string "voice_id=harbour" \
  -o clone.pcm
```

转录文本随声音一起保存，因此不需要 `ref_text`。如果仍然发送，则会在该请求中覆盖存储的副本。

未知的 id 返回 `404`，而不是静默回退到声音设计。否则声音 id 中的一个拼写错误会生成完全不同的声音，看起来像模型出了问题。

## 列出与移除

```
breeze-cli model.gguf --list-voices
```

```
harbour                    5.36 s  The harbour lights came on one by one as the evening tide began to turn.
                                   Calm older narrator, slow and warm.
young_woman                4.00 s  The harbour lights came on one by one as the evening tide began to turn.
```

带描述的声音会在第二行显示描述。

这条命令不加载模型，因此立即返回。

`GET /v1/voices` 以 JSON 返回相同的信息，包括缓存的声音：

```json
[{"id":"harbour","frames":67,"seconds":5.36,"encode_ms":0,"saved":true,"ref_text":"...",
  "description":"Calm older narrator, slow and warm.","metadata":{"accent":"british"}}]
```

`GET /v1/voices/<id>` 以相同的结构返回单个声音，或返回 `404`。

`DELETE /v1/voices/<id>` 把声音从内存中移除，并返回 `{"deleted":"harbour","file_kept":true}`。它刻意**不**删除文件，因此保存的声音会在下次重启时重新出现。要彻底移除一个声音，需要你自己删除 `.breeze` 文件。

## 描述与元数据

每个声音都可以携带一个可选描述（纯文本，最多 4096 字节），以及最多 32 个自己的额外字段（名称和值成对）。这些内容都不影响生成。它们的存在是为了让你能区分自己的声音，也让其他工具能够筛选它们。

保存时设置描述：

```
breeze-cli model.gguf --ref-audio reference.wav --ref-text "..." \
  --save-voice harbour --description "Calm older narrator, slow and warm."
```

```
curl -X POST http://127.0.0.1:8137/v1/voices \
  -F "ref_audio=@reference.wav" \
  --form-string "ref_text=This is the exact transcript of the reference audio." \
  --form-string "name=harbour" \
  --form-string "description=Calm older narrator, slow and warm." \
  --form-string 'metadata={"accent":"british","source":"audiobook sample"}'
```

以已有名称保存时，会保留其描述和字段，除非新请求发送了自己的内容。

之后可以通过 `PATCH /v1/voices/<id>` 修改，它接受 JSON：

```
curl -X PATCH http://127.0.0.1:8137/v1/voices/harbour \
  -H "Content-Type: application/json" \
  -d '{"description":"Calm older narrator.","metadata":{"accent":"scottish","source":null}}'
```

只有你发送的内容会被修改。`metadata` 会合并到已有字段中，设置为 `null` 或空字符串的字段会被移除。`"description": null` 或 `""` 会清空描述。响应是更新后的声音，结构与 `GET` 相同。表单字段也可以，`metadata` 以 JSON 字符串发送。

字段名允许字母、数字、点、连字符和下划线，最多 64 个字符，`description` 为保留名。值是最多 1024 字节的字符串。违反任何限制的请求返回 `400` 且不做任何修改。

对于保存的声音，`.breeze` 文件会立即重写。缓存声音的描述只保存在内存中，因此和声音本身一样会在重启后丢失。

在 Web UI 中，**VOICE LIBRARY** 标签页列出每个声音及其转录文本。编辑描述，用 **+ FIELD** 和 **X** 添加或移除字段，然后按 **SAVE CHANGES**（或在描述框中按 Ctrl+Enter）。**USE** 会在克隆标签页中选中该声音。每当该声音被选中时，描述也会显示在 SAVED VOICE 下拉列表下方，并且每个面板的保存行都有一个可选的描述框。

## `.breeze` 文件

一个小型二进制容器，保存编码后的码和转录文本。大约每秒参考音频 800 字节，因此一个普通片段只有几 KB。

| 偏移 | 大小 | 内容 |
| --- | --- | --- |
| 0 | 4 | 魔数 `BRZV` |
| 4 | 4 | 格式版本，1 或 2 |
| 8 | 4 | 编码码时所用的采样率 |
| 12 | 4 | 码本数量 |
| 16 | 4 | 帧数 |
| 20 | 4 | 转录文本长度（字节） |
| 24 | n | 转录文本，UTF-8 |
| 24+n | | 仅版本 2：描述与字段，见下文 |
| | frames × codebooks × 4 | 码，小端 int32，按帧优先 |

版本 2 在转录文本之后插入：4 字节的描述长度和描述内容、4 字节的字段数量，然后对每个字段依次是 4 字节的名称长度、名称、4 字节的值长度和值。所有字符串都是 UTF-8，所有长度都是小端序。

没有描述且没有字段的声音仍按版本 1 写入，因此不使用元数据的文件在 v0.1.2 及更旧版本中仍可读取。版本 2 的文件需要本版本或更新的构建。编辑先写入临时文件，再替换原文件，因此保存失败不会损坏已有的声音。

启动时会对照已加载的模型检查码本数量。为其他模型创建的声音会被跳过并给出警告，而不是被当作垃圾数据加载。

这些是码，不是音频。它们无法播放，并且与构建模型时所用的编解码器绑定，因此应把它们视为可以从原始 WAV 重建的缓存，而不是归档格式。请保留 WAV 文件。

## 存放位置

默认文件夹是工作目录旁边的 `voices`。两个可执行程序都接受 `--voices-dir <path>` 来指定其他位置。文件夹在第一次保存声音时按需创建。
