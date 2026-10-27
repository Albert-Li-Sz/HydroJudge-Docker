# Hydro 独立评测机镜像

为现有 Hydro 主站提供独立评测机，仅支持 `linux/amd64`。镜像内运行 `hydrojudge` 和 `go-judge`，Nix 工具链提供 C、C++、Java 21、CPython 3 和 PyPy 3。

当前状态：镜像已在本地构建，并通过临时 Hydro 主站和完整 x86 虚拟机进行评测验证。测试结果和已知边界见 [测试报告](TEST_REPORT.md)。模拟环境无法代替目标 amd64 实体机的计时和内存计量验收。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 多阶段构建，固定基础镜像摘要，复制 Nix 工具链运行闭包及评测客户端 |
| `nix/default.nix` | 固定 Nixpkgs 提交，定义编译器和沙箱基础环境 |
| `package.json` 和 `package-lock.json` | 固定客户端和传递依赖 |
| `config/judge.yaml.example` | 主站地址、账号、语言及评测限制示例 |
| `config/mount.yaml` | 沙箱挂载、工作空间、临时空间及执行用户 |
| `runtime/` | 配置校验、启动管理及本地健康检查 |
| `patches/` | 对固定版本 HydroJudge 保留 OLE 状态，采集方式沿用官方实现 |
| `docker-compose.yml` | amd64 平台、特权模式、共享内存和缓存卷 |
| `scripts/build.sh` | 显式构建并加载 amd64 镜像的入口 |
| `RESEARCH.md` | 方案依据、来源链接及完整验收清单 |

## 版本配置

| 组件 | 当前配置 |
| --- | --- |
| 客户端 | `@hydrooj/hydrojudge` 4.0.6 |
| 沙箱 | `go-judge` 1.13.3，普通 amd64 构建 |
| Node.js 基础镜像 | `node:22-bookworm-slim`，固定镜像索引摘要 |
| Nix 构建镜像 | `nixos/nix`，固定镜像索引摘要 |
| Nixpkgs | `1f607aa79b6356ed45d3cd3c8079c196e79efa2c` |

| 语言 | 镜像内版本 | Hydro 语言键 |
| --- | --- | --- |
| C / C++ | GCC / G++ 15.3.0 | `c`、`cc` 及 C++ 标准变体 |
| Java 21 | OpenJDK 21.0.12.1（JDK Headless） | `java` |
| Python 3 | CPython 3.13.15 | `py.py3` |
| PyPy 3 | PyPy 7.3.20，兼容 Python 3.11.13 | `py.pypy3` |

沙箱二进制在构建时校验 SHA256。Nixpkgs 固定到源码提交，工具链最终版本由该提交决定；运行镜像只复制工具链运行依赖，不保留 Nix 包管理器或安装脚本。

构建阶段关闭 Nix 构建进程的 syscall 过滤，以兼容跨架构模拟构建；评测运行阶段仍要求 go-judge seccomp 开启，健康检查会拒绝关闭过滤的沙箱。

## 配置评测机

先在主站创建评测专用账号并赋予 `PRIV_JUDGE` 权限。创建本地配置：

```bash
cp config/judge.yaml.example config/judge.yaml
chmod 600 config/judge.yaml
```

编辑 `config/judge.yaml`，填写主站 URL、账号和密码。URL 需要包含 `http://` 或 `https://`，并以 `/` 结束。不能使用主站的 `localhost` 地址来指代另一台机器；容器中的 `127.0.0.1` 指向容器自身。

`hosts.main.lang` 是此评测机接收任务的语言列表。示例中的语言键需要与实际主站配置核对，且这些语言的编译和运行命令必须使用镜像内存在的工具。Java 21 使用 `java`，PyPy 3 使用 `py.pypy3`；镜像提供 `/usr/bin/java`、`javac`、`jar` 和 `/usr/bin/pypy3`，匹配 Hydro 的官方编译和运行路径。本镜像不包含 Go、Rust 或 Pascal，请勿将这些语言分派给它。

主站需要保留官方 `java`、`py.pypy3` 语言配置，编译与运行方式可参照 [Hydro 语言配置](https://github.com/hydro-dev/Hydro/blob/f5c2ac14e182b8f1238b1ee1a6e78e4fb0fdd816/packages/hydrooj/setting.yaml)。自定义语言键需要同步加入 `hosts.main.lang`。Java 安装的是完整的 JDK 21 Headless，包含编译器与打包工具。

镜像内的 `jar` 启动器将打包临时目录设为当前工作目录，避免 JDK 21 在独立的 `/tmp`、`/w` 挂载间移动文件时触发被沙箱拒绝的快速复制调用。该适配只作用于打包工具；主站官方 Java 命令、选手程序的 JVM 参数和沙箱过滤策略均可沿用。

实际编译命令、运行命令、编译时限和语言特定的资源选项由主站「控制面板 → 系统设置 → `hydrooj.langs`」提供；评测机的 `hosts.main.lang` 只筛选该评测机接收的语言键。客观题和提交答案题使用 `_`，需要由本评测机处理时必须保留该键。

示例配置和入口缺省配置采用官方 `--judge` 安装脚本生成的 `stdio_size: 256m`、`rerun: 2`；明确填写的值仍会保留。`rerun` 是单次提交内符合条件的超时测试点重跑预算。

[官方文档](https://docs.hydro.ac/zh/docs/Hydro/plugins/hydrojudge) 还提到独立评测机的本地 `langs.yaml`；本镜像固定的 HydroJudge `4.0.6` 在 `type: hydro` 连接中使用主站下发的语言配置，源码中未见该连接读取本地 `langs.yaml`。因此本镜像应以主站配置为准；[主站发送与过滤逻辑](https://github.com/hydro-dev/Hydro/blob/f5c2ac14e182b8f1238b1ee1a6e78e4fb0fdd816/packages/hydrooj/src/handler/judge.ts)和[客户端接收逻辑](https://github.com/hydro-dev/Hydro/blob/f5c2ac14e182b8f1238b1ee1a6e78e4fb0fdd816/packages/hydrojudge/src/hosts/hydro.ts)也可供参考。

主站默认的 C++ 配置启用 `address_space_limit`。超过地址空间限制时，内存分配可能先失败；若程序随后访问空指针，结果可能是 RE，而不是 MLE。是否启用该选项应由主站按比赛规则决定；若关闭，仍需验证 cgroup 内存限制和计量。

配置文件通过只读目录挂载提供。入口生成 `/run/hydrojudge/judge.yaml` 作为客户端实际配置，保留原文件，将沙箱地址固定为 `http://127.0.0.1:5050`，并为未指定的 secret 生成随机值。运行配置目录权限为 `0700`，配置文件权限为 `0600`。不要向运行容器注入 `OVERRIDE_CONFIG`，入口会清除它以保持校验后的配置生效。

实际凭据文件及 `.env` 已加入 `.gitignore`；`.dockerignore` 使用白名单，只允许构建所需文件进入上下文，不包含实际凭据。

可选的 Compose 设置：

```bash
cp .env.example .env
```

`.env` 只设置镜像名和共享内存大小，不用于保存主站密码。

## 构建镜像

可以直接使用发布到 GHCR 的 amd64 镜像。准备好 `config/judge.yaml` 后执行：

```bash
cp .env.release.example .env
docker compose pull judge
docker compose up -d --no-build
```

发布镜像为 `ghcr.io/albert-li-sz/hydrojudge-docker:0.1.0`，同时提供 `latest` 和提交 SHA 标签。`.env.release.example` 固定版本，便于明确升级和回退。

### 从源码构建

使用 Compose 构建本地镜像：

```bash
docker compose build
```

也可以使用显式指定 amd64 的脚本：

```bash
./scripts/build.sh
```

默认镜像名为 `hydrojudge:4.0.6-local`。脚本使用 `docker buildx build --platform linux/amd64 --load`，只生成 amd64 镜像。自定义名称时执行：

```bash
JUDGE_IMAGE=my-hydrojudge:local ./scripts/build.sh
```

Compose 会读取 `.env`；独立构建脚本读取 shell 中的 `JUDGE_IMAGE`，不会自动加载 `.env`。

首次构建需要下载基础镜像、Nixpkgs、工具链和 npm 依赖。构建机需要能访问 Docker 镜像源、GitHub、Nix 二进制缓存和 npm registry。`npm ci` 使用锁文件并跳过安装脚本；esbuild 的 Linux amd64 可选包已包含在锁文件中。

## 运行与维护

镜像完成构建并准备好真实配置后，再启动容器：

```bash
docker compose up -d --no-build
docker compose logs -f judge
```

Compose 设置 `privileged: true`、`shm_size: 1gb` 和无限栈限制，不发布沙箱端口。必须在可信的专用评测宿主机上按实际资源调整并发。

入口先校验配置和共享内存，再启动沙箱并检查 cgroup，最后启动客户端。任一关键进程退出都会结束容器，由 Compose 重启策略处理。Tini 负责信号和孤儿进程回收；评测日志写到容器标准输出，Docker 日志配置限制轮转大小。

本地健康检查确认两个进程存在、沙箱接口可用、seccomp 和必要的 cgroup 控制器开启。`healthy` 不代表已成功登录主站或完成评测；还需要在主站确认评测机在线并提交代表性程序。

停止容器：

```bash
docker compose down
```

缓存卷在容器重建或普通 `down` 后保留。不要在需要保留缓存时使用 `docker compose down -v`。

修改主站账号、语言或并发配置后，重启评测机：

```bash
docker compose restart judge
```

修改 `.env`、共享内存或卷挂载等 Compose 参数后，需要重新创建容器：

```bash
docker compose up -d --no-build --force-recreate
```

## 空间和并发设置

| 设置 | 位置 | 作用 |
| --- | --- | --- |
| `hosts.main.concurrency` | `config/judge.yaml` | 告知主站此连接的任务并发 |
| `parallelism` | `config/judge.yaml` | 客户端沙箱请求并发；入口也用它设置沙箱执行并发 |
| `singleTaskParallelism` | `config/judge.yaml` | 单个提交内的测试点并发 |
| `memoryMax` | `config/judge.yaml` | 客户端相关的默认内存设置，不能代替容器总内存预算 |
| `JUDGE_SHM_SIZE` | `.env` | 沙箱文件存储使用的 `/dev/shm` 容量 |
| `/w` 和 `/tmp` 的 `size` | `config/mount.yaml` | 每个沙箱的工作和临时 tmpfs 容量 |

默认读取挂载的 `/config/mount.yaml`；未提供该文件时使用镜像内置版本。修改挂载的文件后重启即可生效。`shm_size`、沙箱 tmpfs 和测试数据缓存是不同空间，需要分别调整。

默认启动配置将栈软、硬限制设为 `unlimited`；本地递归测试实际使用约 64 MiB 栈并通过。栈占用仍受题目内存和语言的地址空间限制约束；如果启用 HydroJudge 的 `strict_memory`，客户端还会将单次执行的栈限额设为该任务的内存限额。

对于需要缓存的输出流，`stdio_size` 分别限制标准输出和标准错误；某些不缓存的流使用 HydroJudge 固定的 4 MiB 收集上限。标准输出和标准错误沿用官方的文件采集方式，其内容可能计入任务的 cgroup 内存。若内存先耗尽，即使输出未超过 `stdio_size`，也可能得到 MLE。

启动参数沿用官方的单文件大小限制方式，不将 `stdio_size` 传给 `go-judge -output-limit`。固定版本 go-judge `1.13.3` 的单文件大小缺省为 256 MiB，独立于标准流采集上限；编译产物和文件 IO 输出也受这一限制。

镜像对官方 HydroJudge `4.0.6` 判题代码的定制仅限输出超限判定：沙箱明确报告输出超限时保留 OLE，避免输出文件回收失败将其覆盖为 RE；若标准输出或标准错误采集报告 `CollectSizeExceeded`，同样优先返回 OLE。输出采集、内存计量和文件大小限制沿用官方实现。

文件 IO 的 `/w` 和 `/tmp` 沿用官方 tmpfs 配置，写入其中的文件会计入程序的 cgroup 内存。文件大小接近或超过题目内存限制时，即使程序本身占用很少，也可能出现 MLE。

建议宿主机使用 Linux 5.19 或更新内核，并提供 memory、pids 及 CPU 计量相关的 cgroup 控制器。入口使用 `-no-fallback`，cgroup 配置失败时不退回其他计量模式。当前就绪检查也会拒绝缺少这些控制器的环境。

## 静态检查

以下命令不构建镜像、不启动容器：

```bash
bash -n runtime/entrypoint.sh scripts/build.sh
shellcheck runtime/entrypoint.sh scripts/build.sh
node --check runtime/prepare-config.cjs
node --check runtime/check-sandbox.cjs
node --check runtime/healthcheck.cjs
docker compose config --quiet
```

依赖锁文件通过以下命令生成，不安装 `node_modules`，不执行依赖安装脚本：

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

## 验证范围

本地测试覆盖真实主站连接、C/C++/Java 21/CPython/PyPy、AC、WA、CE、RE、TLE、MLE、OLE、特殊判题、交互题、输出题、客观题、子任务、栈空间、语言筛选和并发。结果及未覆盖项目见 [测试报告](TEST_REPORT.md)，完整计划见 [研究文档](RESEARCH.md)。

正式使用前需要在目标 amd64 Linux 宿主机验收时间、内存及进程数限制。本机若通过其他架构模拟 amd64，只能辅助检查兼容性，不能作为评测计量验收依据。

## 发布流程

GitHub Actions 的 `Publish amd64 image` 工作流在原生 amd64 Linux 上构建镜像，完成默认配置、全部题型和资源用例、混合并发、语言过滤及自定义输入验证后，再将同一镜像推送到 GHCR。镜像附带源码地址、完整提交 SHA 和版本标签。

发布新版本时更新 `package.json`、锁文件和 `.env.release.example` 中的版本，推送代码后手动运行该工作流。工作流保留不含登录凭据的测试记录和发布摘要。首次发布的新 GHCR 包需要在 Package settings 中设为 Public；发布验收还应确认匿名拉取、架构、摘要及源码提交标签。
