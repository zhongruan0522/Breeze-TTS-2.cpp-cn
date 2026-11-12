# 用 ctypes 从 Python 绑定

没有 Python 包。共享库暴露的是纯 C ABI，所以 `ctypes` 就够了。本页是一份可以直接粘贴到项目里使用的参考。

先阅读 [c-api.md](c-api.md)，了解每个函数的实际功能。

## 加载库

从 Python 3.8 开始，Windows 在解析 DLL 依赖时会忽略 `PATH`。请用 `os.add_dll_directory` 指定库所在的文件夹。

```python
import ctypes
import os
import platform
from pathlib import Path


def load(lib_dir):
    lib_dir = Path(lib_dir).resolve()
    system = platform.system()
    if system == "Windows":
        names = ["breeze.dll", "libbreeze.dll"]
    elif system == "Darwin":
        names = ["libbreeze.dylib"]
    else:
        names = ["libbreeze.so"]

    if hasattr(os, "add_dll_directory"):
        os.add_dll_directory(str(lib_dir))

    for name in names:
        path = lib_dir / name
        if path.exists():
            return ctypes.CDLL(str(path))
    raise FileNotFoundError(f"no breeze library in {lib_dir}")
```

mingw 构建静态链接编译器运行时，因此唯一的外部依赖是来自 GPU 驱动的 `vulkan-1.dll`。

## 声明

```python
class BreezeRequest(ctypes.Structure):
    _fields_ = [
        ("text", ctypes.c_char_p),
        ("instruction", ctypes.c_char_p),
        ("ref_text", ctypes.c_char_p),
        ("ref_audio", ctypes.POINTER(ctypes.c_float)),
        ("ref_audio_len", ctypes.c_int),
        ("cfg_scale", ctypes.c_float),
        ("seed", ctypes.c_int),
        ("max_new_tokens", ctypes.c_int),
        ("split_chars", ctypes.c_int),
    ]


AUDIO_CB = ctypes.CFUNCTYPE(
    ctypes.c_int, ctypes.POINTER(ctypes.c_float), ctypes.c_int, ctypes.c_void_p
)


def bind(lib):
    lib.breeze_init.restype = ctypes.c_void_p
    lib.breeze_init.argtypes = [ctypes.c_char_p, ctypes.c_int]
    lib.breeze_free.argtypes = [ctypes.c_void_p]
    lib.breeze_sample_rate.restype = ctypes.c_int
    lib.breeze_sample_rate.argtypes = [ctypes.c_void_p]
    lib.breeze_generate.restype = ctypes.c_int
    lib.breeze_generate.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(BreezeRequest), AUDIO_CB, ctypes.c_void_p
    ]
    lib.breeze_generate_wav.restype = ctypes.c_int
    lib.breeze_generate_wav.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(BreezeRequest), ctypes.c_char_p
    ]
    lib.breeze_last_error.restype = ctypes.c_char_p
    return lib
```

`breeze_init` 必须声明为 `c_void_p` 而不是保持默认的 `c_int`，否则 64 位句柄会被截断，进程会在第一次使用它的调用时崩溃。

## 最小封装

```python
import numpy as np


class Breeze:
    def __init__(self, model, lib_dir, use_gpu=True):
        self.lib = bind(load(lib_dir))
        self.ctx = self.lib.breeze_init(str(model).encode(), int(use_gpu))
        if not self.ctx:
            raise RuntimeError(self.lib.breeze_last_error().decode(errors="replace"))
        self.sample_rate = self.lib.breeze_sample_rate(self.ctx)

    def close(self):
        if self.ctx:
            self.lib.breeze_free(self.ctx)
            self.ctx = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _request(self, text, instruction, ref_audio, ref_text, cfg_scale, seed, max_new, split_chars):
        req = BreezeRequest()
        req.text = text.encode()
        req.instruction = (instruction or "Speak clearly and naturally.").encode()
        req.ref_text = (ref_text or "").encode()
        req.cfg_scale = float(cfg_scale)
        req.seed = int(seed)
        req.max_new_tokens = int(max_new)
        req.split_chars = int(split_chars)
        keep = None
        if ref_audio is not None:
            keep = np.ascontiguousarray(ref_audio, dtype=np.float32)
            req.ref_audio = keep.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
            req.ref_audio_len = len(keep)
        return req, keep

    def generate(self, text, instruction=None, ref_audio=None, ref_text=None,
                 cfg_scale=1.0, seed=42, max_new=0, split_chars=0, on_chunk=None):
        req, keep = self._request(text, instruction, ref_audio, ref_text,
                                  cfg_scale, seed, max_new, split_chars)
        out = []

        def cb(samples, n, _user):
            block = np.ctypeslib.as_array(samples, shape=(n,)).copy()
            out.append(block)
            if on_chunk is not None:
                on_chunk(block)
            return 0

        c_cb = AUDIO_CB(cb)
        rc = self.lib.breeze_generate(self.ctx, ctypes.byref(req), c_cb, None)
        del keep
        if rc != 0:
            raise RuntimeError(self.lib.breeze_last_error().decode(errors="replace"))
        return np.concatenate(out) if out else np.zeros(0, dtype=np.float32)
```

两个容易踩的坑：

- 在整个调用期间保留对 `AUDIO_CB` 对象的引用。如果 Python 在 C 还持有指针时就回收了它，进程会崩溃。
- 同样要保留对参考音频数组的引用。`ctypes` 只保存裸指针，并不拥有缓冲区。

## 用法

```python
import soundfile as sf

with Breeze("breeze-tts-2-q4_k.gguf", "build") as tts:
    audio = tts.generate(
        "The build finished without a single warning.",
        instruction="A calm narrator with a warm tone.",
        seed=42,
    )
    sf.write("out.wav", audio, tts.sample_rate)
```

在块到达时流式写入声音设备：

```python
import sounddevice as sd

with Breeze("breeze-tts-2-q4_k.gguf", "build") as tts:
    stream = sd.OutputStream(samplerate=tts.sample_rate, channels=1, dtype="float32")
    stream.start()
    tts.generate("Streaming straight to the speakers.", on_chunk=stream.write)
    stream.stop()
```

声音克隆，先把参考音频重采样到模型采样率：

```python
import librosa

ref, _ = librosa.load("reference.wav", sr=tts.sample_rate, mono=True)
audio = tts.generate(
    "It is good to hear your voice again.",
    ref_audio=ref,
    ref_text="This is the exact transcript of the reference audio.",
)
```

## 提前停止

从回调返回非零值即可停止生成。当前帧会完成，`breeze_generate` 正常返回。

```python
def cb(samples, n, _user):
    out.append(np.ctypeslib.as_array(samples, shape=(n,)).copy())
    return 1 if sum(len(b) for b in out) >= limit else 0
```

## 线程

context 不可重入，所以要用锁把调用串行化。`breeze_generate` 会阻塞，并且只在你的回调运行期间持有 GIL，所以其他 Python 线程在计算期间仍能继续推进。

如果想要真正的并行，运行一个带 `--parallel` 的 `breeze-server`，它在多个流之间共享权重和一个 GPU 批处理，见 [performance.md](performance.md#running-several-streams)。这里的每个额外 context 都会加载自己的一份权重副本。

## 其他语言

同样的 ABI 可以用于任何支持 FFI 的环境。需要移植的部分是：不透明指针句柄、按自然 C 对齐的八字段请求结构体，以及一个接受 `(const float *, int, void *)` 并返回 `int` 的回调。
