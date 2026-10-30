# Hydro 独立评测机镜像

为已有的 Hydro OJ 提供 Docker 独立评测机，支持 C、C++、Java 21、CPython 3 和 PyPy 3，仅支持 `linux/amd64`。

发布镜像：`ghcr.io/albert-li-sz/hydrojudge-docker:0.1.1`。

## 快速部署

准备一台 amd64 Linux 主机，安装 Docker 和 Docker Compose，并在 Hydro 主站创建具有 `PRIV_JUDGE` 权限的评测账号。

### 1. 获取项目

```bash
git clone https://github.com/Albert-Li-Sz/HydroJudge-Docker.git
cd HydroJudge-Docker
cp .env.release.example .env
cp config/judge.yaml.example config/judge.yaml
chmod 600 config/judge.yaml
```

### 2. 填写主站信息

编辑 `config/judge.yaml` 中的 `hosts.main`：

- `server_url`：容器可访问的主站地址，例如 `https://oj.example.com/`，以 `/` 结尾。
- `uname`、`password`：评测账号及密码。
- `concurrency`：此评测机的任务并发数，默认 `2`，按主机资源调整。

编译和运行命令在主站的 `hydrooj.langs` 中配置；评测机的 `hosts.main.lang` 用于筛选接收的语言，示例已包含镜像支持的语言。

### 3. 拉取并启动

```bash
docker compose pull judge
docker compose up -d --no-build
docker compose logs -f judge
```

启动后，在主站确认评测机在线，并提交一道简单题验证评测结果。

已有部署将 `.env` 中的 `JUDGE_IMAGE` 更新为上述版本，再执行拉取和启动命令。升级保留题目缓存卷，旧编译缓存会自动重建。版本变更见 [CHANGELOG](CHANGELOG.md)。
