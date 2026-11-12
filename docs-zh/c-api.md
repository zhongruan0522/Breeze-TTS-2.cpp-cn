# C API

共享库暴露了一个小型 C ABI，声明在 [include/breeze/breeze.h](../include/breeze/breeze.h)。它是任何语言绑定的预期入口。

用 `-DBREEZE_BUILD_SHARED=ON`（默认开启）来构建它。产物在 MSVC 上是 `breeze.dll`，mingw 上是 `libbreeze.dll`，Linux 上是 `libbreeze.so`，macOS 上是 `libbreeze.dylib`。

在 mingw 上，该库静态链接编译器运行时，因此唯一的非系统依赖是随 GPU 驱动提供的 `vulkan-1.dll`。

## 头文件

```c
#include "breeze/breeze.h"
```

所有内容都是 `extern "C"`，可以安全地在 C 或 C++ 中包含。

## 类型

### `breeze_context`

不透明句柄，持有已加载的模型、计算后端和分词器。创建一个要分配数 GB 内存，所以只创建一次，并在进程生命周期内保留它。

### `breeze_audio_cb`

```c
typedef int (*breeze_audio_cb)(const float * samples, int n_samples, void * user);
```

每当一块音频就绪时，在调用线程上被调用。`samples` 指向 `n_samples` 个单声道 float，取值范围 -1 到 1，采样率为模型采样率。缓冲区只在本次调用期间有效，如果需要保留请复制它。

返回 `0` 继续生成。返回其他任何值则提前停止；正在处理中的帧会完成，`breeze_generate` 正常返回。

`user` 由 `breeze_generate` 原样透传。

### `breeze_request`

```c
typedef struct {
    const char * text;
    const char * instruction;
    const char * ref_text;
    const float * ref_audio;
    int   ref_audio_len;
    float cfg_scale;
    int   seed;
    int   max_new_tokens;
    int   split_chars;
    float temperature;
    int   top_k;
    float top_p;
    float repetition_penalty;
} breeze_request;
```

| 字段 | 含义 |
| --- | --- |
| `text` | 要朗读的文本。必填。UTF-8。 |
| `instruction` | 声音描述或演绎指导。`NULL` 使用 `Speak clearly and naturally.` |
| `ref_text` | `ref_audio` 的精确转写文本。克隆时必填，否则为 `NULL`。 |
| `ref_audio` | 模型采样率的单声道参考采样，或 `NULL`。 |
| `ref_audio_len` | `ref_audio` 中 float 的数量。 |
| `cfg_scale` | Classifier free guidance。`1.0` 禁用它并跳过第二次推理。 |
| `seed` | RNG 种子。相同的种子和输入会复现相同的音频。 |
| `max_new_tokens` | 每段的帧数上限。`0` 使用模型默认值 750 帧，约 60 秒。 |
| `split_chars` | 长文本切分后每段的大小。`0` 使用默认值 600。负数则一次性生成，这会受 `max_new_tokens` 限制，超过一分钟左右质量会明显下降。 |
| `temperature` | 采样温度。`0` 保持构建 GGUF 时的设定。 |
| `top_k` | 采样 top-k。`0` 保持模型默认值。 |
| `top_p` | 采样 top-p。`0` 保持模型默认值。 |
| `repetition_penalty` | 重复惩罚。`0` 保持模型默认值。 |

填充前先把结构体清零，这样未来新增的字段会有合理的默认值：

```c
breeze_request req = {0};
req.text = "Hello there.";
req.cfg_scale = 1.0f;
req.seed = 42;
```

只提供 `ref_audio` 而不提供 `ref_text`（或反过来）会被拒绝。

## 函数

### `breeze_init`

```c
breeze_context * breeze_init(const char * gguf_path, int use_gpu);
```

加载 GGUF 模型。`use_gpu` 传 `1` 会先尝试 Vulkan，没有可用设备时回退到 CPU；传 `0` 强制使用 CPU。

失败时返回 `NULL`；调用 `breeze_last_error` 获取原因。

### `breeze_free`

```c
void breeze_free(breeze_context * ctx);
```

释放模型和后端。传入 `NULL` 调用也是安全的。

### `breeze_sample_rate`

```c
int breeze_sample_rate(breeze_context * ctx);
```

输出采样率（Hz），从模型元数据读取。当前为 24000。请使用这个值而不是硬编码，并在传入参考音频之前把它重采样到相同采样率。

### `breeze_generate`

```c
int breeze_generate(breeze_context * ctx, const breeze_request * req,
                    breeze_audio_cb cb, void * user);
```

运行完整流水线，音频在生成的同时流式传给 `cb`。成功返回 `0`，失败返回非零。

该调用会阻塞直到生成完成。音频以块的形式到达，从 1 帧（80 ms）开始逐渐增长到 25 帧（2 秒），最后一个块除外，它包含剩余的全部内容。

### `breeze_generate_wav`

```c
int breeze_generate_wav(breeze_context * ctx, const breeze_request * req,
                        const char * out_path);
```

与 `breeze_generate` 相同，但会缓冲全部音频并写入 16 位 PCM WAV。成功返回 `0`。

### `breeze_last_error`

```c
const char * breeze_last_error(void);
```

当前线程最近一次失败的消息。指针在该线程下一次失败的调用之前保持有效。

## 线程安全

`breeze_context` **不可**重入。每个 context 同一时间只能有一个生成任务。用互斥锁保护它，或者如果内存允许，为每个 worker 创建一个 context，因为每个都持有自己的一份权重副本。

对不同 context 并发调用 `breeze_init` 和 `breeze_free` 是安全的。`breeze_last_error` 是线程本地的。

## 流式输出到实时设备

`breeze_generate` 在块被声码器处理完成时回调，因此可以直接驱动声音设备。如果这样做，有两点需要注意。

回调在调用线程上运行，生成会阻塞到回调返回为止，所以不要在回调里做任何耗时的事情。把数据复制进环形缓冲区，让音频设备在自己的线程上消费它。

环形缓冲区的大小要按生产时间来定，而不是按块数量。块的大小逐渐增大，而队列在下一个块生成期间持续被消费，所以它需要容纳比生成一个块耗时更多的音频。在 RTX 3060 的 Q8_0 上这是超过一秒。相关分析和测量见 [server.md](server.md#streaming-without-stutter)，适用于任何客户端，不只是浏览器端。

这里的块大小是库的默认值。`breeze_request` 没有对应的字段，所以 C 使用者无法像 `breeze-cli` 和 `breeze-server` 那样调整增长曲线；改为在客户端缓冲上做补偿。

## 完整示例

```c
#include "breeze/breeze.h"
#include <stdio.h>

static int on_audio(const float * s, int n, void * user) {
    FILE * f = (FILE *) user;
    for (int i = 0; i < n; i++) {
        float v = s[i] < -1.0f ? -1.0f : (s[i] > 1.0f ? 1.0f : s[i]);
        short pcm = (short) (v * 32767.0f);
        fwrite(&pcm, sizeof pcm, 1, f);
    }
    return 0;
}

int main(void) {
    breeze_context * ctx = breeze_init("breeze-tts-2-q4_k.gguf", 1);
    if (!ctx) {
        fprintf(stderr, "%s\n", breeze_last_error());
        return 1;
    }

    breeze_request req = {0};
    req.text = "The build finished without a single warning.";
    req.instruction = "A calm narrator with a warm tone.";
    req.cfg_scale = 1.0f;
    req.seed = 42;

    FILE * raw = fopen("out.pcm", "wb");
    int rc = breeze_generate(ctx, &req, on_audio, raw);
    fclose(raw);

    if (rc != 0) fprintf(stderr, "%s\n", breeze_last_error());
    breeze_free(ctx);
    return rc;
}
```

如果不想随程序分发 DLL，可以改为针对静态核心库编译：

```
gcc example.c -Iinclude -Lbuild -lbreeze_core -lggml -lstdc++ -o example
```
