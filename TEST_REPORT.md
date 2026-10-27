# Hydro 独立评测机本地测试报告

测试日期：2026 年 10 月 27 日

当前镜像已加入 Java 21 和 PyPy 3，完成 **56/56 项真实主站评测、9/9 项客户端策略检查**。真实评测包含 3 项默认配置和 53 项题型、资源用例；其中 Java 新增 8 项、PyPy 新增 7 项，全部符合预期。另有 4 个混合并发提交全部 AC，观察到最多 2 个任务同时处理。

## 语言和版本

| 语言 | 实际版本 | Hydro 语言键 |
| --- | --- | --- |
| C / C++ | GCC / G++ 15.3.0 | `c`、`cc` 及其标准变体 |
| Java 21 | OpenJDK 21.0.12.1，包含 javac、jar | `java` |
| Python 3 | CPython 3.13.15 | `py.py3` |
| PyPy 3 | PyPy 7.3.20，Python 3.11.13，JIT 开启 | `py.pypy3` |

语言环境来自固定的 Nixpkgs 提交 `1f607aa79b6356ed45d3cd3c8079c196e79efa2c`，保留原有 GCC 与 CPython 版本。主站使用官方 Java、PyPy 编译和运行命令；评测机白名单增加对应语言键。

## 实际验证

| 范围 | 结果 |
| --- | --- |
| Java 21 | AC、WA、CE、RE、TLE、文件 IO 和交互题均符合预期 |
| Java 21 特性 | `Runtime.version().feature()` 为 21；SequencedCollection API 与虚拟线程程序为 AC |
| PyPy 3 | AC、WA、CE、RE、TLE、文件 IO 和交互题均符合预期 |
| PyPy 类型与 JIT | 程序确认解释器为 PyPy，`translation.jit` 为真，结果为 AC |
| 沙箱语言探针 | C、C++、CPython、PyPy 执行通过；Java 编译、普通 jar 打包及执行通过 |
| 原有资源限制 | 时间、内存边界与 AC/WA/CE/RE/TLE/MLE/OLE 均符合预期 |
| 官方输出计量 | 8 MiB 内存下输出 12 MiB 得到 MLE；16 MiB 标准流限额下写入正确的 20 MiB 文件得到 AC |
| 栈空间 | 沙箱栈限额为 unlimited；4096 层、每层 16 KiB 的实际触页递归为 AC，峰值 66304 KiB |
| 其他题型 | 特殊判题、交互、双进程通信、单文件/ZIP 提交答案、客观题和子任务计分通过 |
| 混合并发 | Java、PyPy、Java、CPython 四个提交全部 AC，任务并发与配置相符 |
| 语言过滤 | 未安装的 Go 任务等待 12 秒未被领取，随后取消 |

## Java 打包适配

初始沙箱探针中 javac 编译成功，但 jar 在默认 `/tmp` 创建临时文件，再移到独立的 `/w` 挂载时，快速复制调用返回 `Operation not permitted`，导致 Main.jar 未生成。

验证将 jar 临时目录设为工作目录后，同一 seccomp 沙箱内的编译、打包和执行均成功。最终镜像通过 Nix 的高优先级 jar 启动器完成这项适配；正式回归使用普通 jar 命令，主站无需手工添加参数。适配仅涉及打包临时目录，选手程序的 JVM 栈、堆及运行参数沿用主站配置，沙箱过滤保持开启。

## 沿用的评测策略

- 保留 OLE 映射和优先策略，包括输出文件回收失败时保留已明确报告的 OLE。
- stdout、stderr 沿用官方文件采集方式，采集数据和 `/w`、`/tmp` 文件参与任务内存计量。
- 不额外传入 `-output-limit`，沙箱单文件大小限额实测为 268435456 字节，独立于 `stdio_size`。
- 默认和示例配置为 `stdio_size: 256m`、`rerun: 2`；显式配置覆盖保持有效。

## 环境与复现

| 项目 | 本轮环境 |
| --- | --- |
| 宿主机 | Apple Silicon，Docker Desktop |
| 评测环境 | QEMU 完整 x86_64 虚拟机，2 vCPU、3 GiB 内存 |
| 内核和 Docker | Linux 6.1.0-54-cloud-amd64，Docker 20.10.24+dfsg1 |
| Hydro | 独立 Hydro 5.0.7 与 MongoDB 7 容器 |
| 客户端 / 沙箱 | HydroJudge 4.0.6 / go-judge 1.13.3 |
| 本地镜像 | hydrojudge:4.0.6-local，linux/amd64 |
| 镜像索引 ID | `sha256:9d1e7f058d18c390e02be9e74661916f58bf4c2a8f70e129cac9ac0c500cbd4e` |
| 实际运行配置 ID | `sha256:e713e0fdd6eef3aad28dac87a2b429b07a6e698b52e78b6653ebd4004b7fa130` |

沙箱 seccomp 开启，cgroup v2 的 CPU、memory、pids 控制器可用。默认配置用例省略 stdio_size、rerun，入口实际生成 256m、2。资源套件显式使用 stdio_size=16m 缩小数据，单文件上限仍为 256 MiB。模拟环境的临时主站将 C/C++、PyPy 编译时限设为 60 秒，Java 设为 120 秒；正式部署仍由主站语言配置决定。

机器可读结果见 [本轮数据](tests/results/2026-10-27-java21-pypy.json)，复现步骤见 [测试说明](tests/integration/README.md)。

## 验证边界与历史

这些测试验证完整 x86 Linux 内核下的功能，不能代替目标原生 amd64 机器的性能、计时精度和负载校准。未覆盖远端转评、Hack、数据生成、多轮交互、所有比较器及大规模跨节点并发。Java/PyPy 的内存限制和所有标准库 API 未做完整组合测试。

加入新语言前的官方采集版本结果见 [41 项基线数据](tests/results/2026-10-27-official-file-collection.json)。更早的管道采集策略见 [历史报告](tests/results/2026-10-27-pipe-collection.md) 和 [历史数据](tests/results/2026-10-27-amd64-vm.json)，不作为当前镜像的验证证据。
