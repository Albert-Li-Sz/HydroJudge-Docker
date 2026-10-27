# Hydro 独立评测机镜像

为现有 Hydro 主站提供独立评测机，仅支持 `linux/amd64`。镜像内运行 `hydrojudge` 和 `go-judge`，Nix 工具链提供 C、C++ 和 Python 3。

当前状态：构建和部署文件已编写，已生成 npm 依赖锁文件。按本轮要求，尚未执行 Docker build、启动容器或进行真实评测。脚本和 Compose 的静态检查不代表镜像已经构建成功。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 多阶段构建，固定基础镜像摘要，复制 Nix 工具链运行闭包及评测客户端 |
| `nix/default.nix` | 固定 Nixpkgs 提交，定义编译器和沙箱基础环境 |
| `package.json` 和 `package-lock.json` | 固定客户端和传递依赖 |
| `config/judge.yaml.example` | 主站地址、账号、语言及评测限制示例 |
| `config/mount.yaml` | 沙箱挂载、工作空间、临时空间及执行用户 |
| `runtime/` | 配置校验、启动管理及本地健康检查 |
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

沙箱二进制在构建时校验 SHA256。Nixpkgs 固定到源码提交，工具链最终版本由该提交决定；运行镜像只复制工具链运行依赖，不保留 Nix 包管理器或安装脚本。

## 配置评测机

先在主站创建评测专用账号并赋予 `PRIV_JUDGE` 权限。创建本地配置：

```bash
cp config/judge.yaml.example config/judge.yaml
chmod 600 config/judge.yaml
```

编辑 `config/judge.yaml`，填写主站 URL、账号和密码。URL 需要包含 `http://` 或 `https://`，并以 `/` 结束。不能使用主站的 `localhost` 地址来指代另一台机器；容器中的 `127.0.0.1` 指向容器自身。

`hosts.main.lang` 是此评测机接收任务的语言列表。示例中的语言键需要与实际主站配置核对，且这些语言的编译和运行命令必须使用镜像内存在的工具。本镜像首版不包含 Java、Go、Rust 或 PyPy，请勿将对应语言分派给它。

配置文件通过只读目录挂载提供。入口生成 `/run/hydrojudge/judge.yaml` 作为客户端实际配置，保留原文件，将沙箱地址固定为 `http://127.0.0.1:5050`，并为未指定的 secret 生成随机值。运行配置目录权限为 `0700`，配置文件权限为 `0600`。不要向运行容器注入 `OVERRIDE_CONFIG`，入口会清除它以保持校验后的配置生效。

实际凭据文件及 `.env` 已加入 `.gitignore`；`.dockerignore` 使用白名单，只允许构建所需文件进入上下文，不包含实际凭据。

可选的 Compose 设置：

```bash
cp .env.example .env
```

`.env` 只设置镜像名和共享内存大小，不用于保存主站密码。

## 构建镜像

以下命令留待需要构建时手动执行，本轮未运行。

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

本地健康检查确认两个进程存在、沙箱接口可用、必要 cgroup 控制器开启。`healthy` 不代表已成功登录主站或完成评测；还需要在主站确认评测机在线并提交代表性程序。

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

## 待完成的验证

下一阶段需要依次完成镜像构建、沙箱内 C/C++ 编译与 Python 执行、真实主站登录和任务分发，再验证 AC、WA、CE、RE、TLE、MLE、特殊判题、交互题、并发及重启恢复。完整清单见 [研究文档](RESEARCH.md)。

正式使用前需要在目标 amd64 Linux 宿主机验收时间、内存及进程数限制。本机若通过其他架构模拟 amd64，只能辅助检查兼容性，不能作为评测计量验收依据。
