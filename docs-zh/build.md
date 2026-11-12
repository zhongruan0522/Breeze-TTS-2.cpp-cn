# 构建

## 环境要求

| 工具 | 说明 |
| --- | --- |
| CMake | 3.19 或更新版本 |
| C++17 编译器 | mingw-w64（winlibs UCRT）、MSVC、gcc 或 clang |
| Vulkan SDK | 仅 GPU 后端需要，提供着色器编译用的 `glslc`。 |
| Ninja | 可选，但比默认生成器快得多 |
| Python 3.9+ | 仅用于把权重转换为 GGUF |

Vulkan 后端可以在任何暴露 Vulkan 1.2 的驱动上运行，涵盖 Windows 和 Linux 上的 NVIDIA、AMD 与 Intel。

## 克隆

ggml 后端是一个子模块，所以需要递归克隆：

```
git clone --recursive https://github.com/<owner>/Breeze-TTS-2.cpp
cd Breeze-TTS-2.cpp
```

如果已经克隆但没有加 `--recursive`：

```
git submodule update --init --recursive
```

## 配置与构建

GPU（Vulkan）：

```
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```

仅 CPU：

```
cmake -B build-cpu -G Ninja -DCMAKE_BUILD_TYPE=Release -DBREEZE_VULKAN=OFF
cmake --build build-cpu -j
```

## CMake 选项

| 选项 | 默认值 | 效果 |
| --- | --- | --- |
| `BREEZE_VULKAN` | `ON` | 以 Vulkan 后端构建 ggml。 |
| `BREEZE_CUDA` | `OFF` | 以 CUDA 后端构建 ggml。需要 CUDA toolkit，Windows 上需要 MSVC。 |
| `BREEZE_BUILD_CLI` | `ON` | 构建 `breeze-cli`。 |
| `BREEZE_BUILD_SERVER` | `ON` | 构建 `breeze-server`。 |
| `BREEZE_BUILD_SHARED` | `ON` | 构建共享 C 库。 |
| `BREEZE_MP3` | `ON` | 让 server 使用 `third_party/shine` 子模块为 OpenAI 风格请求编码 MP3。关闭该项或缺少子模块时，这些请求会改用 WAV。 |

### Vulkan 还是 CUDA

Vulkan 仍是默认选项。它在 Q4_K 上略快，在 F16 上持平，而且不需要 toolkit。以下数据在解锁张量核心上限的 RTX 3060 12 GB 上测得，按每帧音频（80 ms）计。Q4_K 和 Q8_0 行是 4 个种子的平均值：

| 模型 | `cfg_scale` | 后端 | 骨干网络 | 深度解码器 | 声码器 | 每帧总计 | 实时率 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q4_K | 1 | Vulkan | 7.12 ms | 23.66 ms | 2.38 ms | 33.16 ms | 2.41x |
| Q4_K | 1 | CUDA | 10.23 ms | 24.20 ms | 3.37 ms | 37.80 ms | 2.12x |
| Q4_K | 3 | Vulkan | 10.91 ms | 32.65 ms | 2.42 ms | 45.98 ms | 1.74x |
| Q4_K | 3 | CUDA | 16.44 ms | 27.33 ms | 3.41 ms | 47.18 ms | 1.70x |
| Q8_0 | 1 | Vulkan | 9.06 ms | 28.83 ms | 2.39 ms | 40.28 ms | 1.99x |
| Q8_0 | 3 | Vulkan | 13.07 ms | 35.10 ms | 2.56 ms | 50.74 ms | 1.58x |
| F16 | 1 | Vulkan | 13.06 ms | 40.95 ms | 2.41 ms | 56.42 ms | 1.42x |
| F16 | 1 | CUDA | 12.86 ms | 42.12 ms | 3.03 ms | 58.01 ms | 1.38x |

CUDA 过去远远落后，只有约 0.6x，原因有两个，而且都已修复：

- **CUDA graphs 从未被编译进去。** ggml 默认不启用它们，除非由 llama.cpp 构建，所以 `BREEZE_CUDA` 现在会把它们打开。深度解码器每帧重放一张固定图，这把它从 55 ms 降到了 23 ms。设置 `GGML_CUDA_DISABLE_GRAPHS=1` 可以对比。
- **CUDA 的 `conv_transpose_1d` 内核是逐采样循环。** 在 100 帧解码上它要花约 1.6 s。声码器现在用矩阵乘法加重叠相加来上采样，这把 CUDA 上每帧从 62 ms 降到 7 ms，Vulkan 上从 12 ms 降到 6 ms。随后在两次 flush 之间保留其状态，又把两者分别降到约 3.5 ms 和 2.3 ms。

骨干网络是两者仍然存在差距的地方，因为它每帧都要构建一张新图，而 CUDA 无法重放。目前只有深度解码器能完全受益于图。

张量核心的速度——包括解锁的显卡——只能体现在大批量矩阵乘法上：骨干网络 prefill 和声码器。深度解码与骨干网络解码每次只在跳过张量核心的路径上乘一到两行，并且受限于从内存读取权重。这就是为什么在任一后端上更小的深度类型都是最快的选择：F16 在深度部分每帧花约 42 ms，而 F16 配 Q4_K 深度解码器约 25 ms。

选择模型、运行多路流和调优见 [performance.md](performance.md)。

## 构建产物

| 目标 | 说明 |
| --- | --- |
| `breeze-cli` | 一次性合成并输出 WAV |
| `breeze-server` | 带可选 Web UI 的 HTTP 服务器 |
| `breeze-quantize` | 把 F16 GGUF 转换为 Q8_0、Q6_K、Q4_K、Q3_K 或 Q2_K |
| `libbreeze` | 共享 C 库，见 [c-api.md](c-api.md) |
| `libbreeze_core` | 静态库，如果你更想直接链接 |

Web UI 在构建时由 `cmake/embed_webui.cmake` 编译进 `breeze-server`，它把 [webui](../webui) 中的文件转成一个生成的头文件。修改源码并重新构建即可生效。

## 运行时后端选择

两个应用都会向 ggml 询问它构建时所带的任何 GPU 后端，如果没有则回退到 CPU。传 `--cpu` 可以完全跳过 GPU。启动行会显示所选的后端：

```
backend: Vulkan0, sample rate: 24000
```

## mingw 相关细节

mingw 构建静态链接编译器运行时，因此二进制文件只依赖系统 DLL 加上 `vulkan-1.dll`。你可以把它们复制到没有安装 mingw 的机器上，它们也能运行。

OpenMP 在 mingw 上被禁用，因为没有静态的 `libgomp`，而动态链接会把 `libgomp-1.dll` 依赖泄漏进共享库。ggml 的 CPU 后端会回退到自己的线程池，所以仍然是多线程运行。

## 故障排除

**`third_party/ggml is missing`** 表示子模块没有初始化。运行 `git submodule update --init --recursive`。

**`third_party/shine is missing so mp3 requests will get wav`** 是 MP3 编码器的同类问题，它是在 ggml 之后才加入的。在此之前克隆的仓库需要运行一次 `git submodule update --init --recursive` 来获取它。

**Vulkan shader generation crashes with `0xC0000139`** 在 Windows 上出现于其他程序把不兼容的 `libstdc++-6.dll` 放到了 `PATH` 前面。Tesseract OCR 是常见的元凶。把你的 mingw `bin` 目录放到最前面：

```powershell
$env:PATH = "C:\path\to\mingw64\bin;" + $env:PATH
```

**No Vulkan device found** 通常意味着 GPU 驱动过旧，或者在没有 GPU 直通的容器或远程会话中运行。这不是致命的；模型会改为在 CPU 上加载，只是比较慢。

生成期间出现 **Out of video memory**：改用更小的量化。Q4_K 大约需要 3 GB 显存，而 F16 约需 7 GB。见 [models.md](models.md)。

如果仍然太多，比如要在 6 GB 显卡上与本地 LLM 并存，`--te-cpu`（C API 和 Python 绑定用 `BREEZE_TE_CPU=1`）会把 T5Gemma2 文本编码器保留在系统内存中并在 CPU 上运行。它对每段文本只运行一次，所以代价是每段文本前的一次延迟，而不是更慢的流。在 RTX 2060 上用 Q4_K 加 Q2_K 深度解码器，峰值显存从 2725 MB 降到 1811 MB，首个音频从约 0.2 s 增加到 0.75 s（编码器在 6 线程上耗时约 0.5 s）。不要把它与 `--parallel` 组合使用，每次编码都会暂停其他流。3060 上的数据和更多细节见 [performance.md](performance.md#short-on-video-memory)。
