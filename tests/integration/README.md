# 本地端到端测试

测试会创建独立 Hydro 5.0.7、MongoDB、测试账号和测试题，通过真实 HTTP 提交程序，再检查评测记录。默认监听 `127.0.0.1:18888`，凭据和临时数据存放在被 Git 忽略的 `.local-test/qa`。

以下步骤适用于原生 amd64 Linux Docker 宿主机。其他架构直接模拟 amd64 用户态时，沙箱 seccomp 不一定可用；应使用完整 x86 虚拟机，并明确模拟环境不能验证原生机器的性能计量。

已构建 `hydrojudge:validation` 后，可以在干净的原生 amd64 测试工作区运行 `bash scripts/validate-image.sh`，自动执行下面的全部流程并清理测试容器和网络。GitHub Actions 发布镜像前也运行该脚本。

```bash
JUDGE_IMAGE=hydrojudge:validation ./scripts/build.sh
docker run --rm --platform linux/amd64 -v "$PWD/tests/integration:/tests:ro" hydrojudge:validation node /tests/client-output-policy.cjs
docker network inspect hydrojudge-validation-net >/dev/null 2>&1 || docker network create hydrojudge-validation-net
python3 tests/integration/run.py prepare --profile defaults
docker compose -p hydrojudge-validation -f tests/integration/compose.yml up -d --build --wait --wait-timeout 180 mongo site
```

测试初始化会将 C/C++、PyPy 编译时限设为 60 秒、Java 设为 120 秒，以适应模拟环境，并给 C 编译命令加入测试宏。`site` 健康后，通过正式系统设置接口应用这些配置，再检查真实评测 WebSocket 下发的参数。配置脚本会使用临时管理员账号完成 sudo 验证；仅在另一个 CLI 进程写数据库可能留下尚未刷新的主站语言缓存。

```bash
python3 tests/integration/configure-site.py
docker run --rm --platform linux/amd64 --network hydrojudge-validation-net \
  -v "$PWD/.local-test/qa:/qa:ro" -v "$PWD/tests/integration:/tests:ro" \
  hydrojudge:validation node /tests/site-language-config.cjs
docker compose -p hydrojudge-validation -f tests/integration/compose.yml up -d --no-build --no-recreate --wait --wait-timeout 180 judge
```

启动后执行：

```bash
docker compose -p hydrojudge-validation -f tests/integration/compose.yml exec -T judge node - < tests/integration/sandbox-probe.cjs
docker compose -p hydrojudge-validation -f tests/integration/compose.yml exec -T judge node - < tests/integration/sandbox-languages.cjs
docker compose -p hydrojudge-validation -f tests/integration/compose.yml exec -T judge node - < tests/integration/sandbox-output.cjs
docker compose -p hydrojudge-validation -f tests/integration/compose.yml exec -T judge node - < tests/integration/sandbox-fileio-memory.cjs
docker compose -p hydrojudge-validation -f tests/integration/compose.yml exec -T judge node - < tests/integration/sandbox-process-limit.cjs
python3 tests/integration/default-limits.py
```

再切换为较小的标准流限额，运行资源边界及其他题型用例：

```bash
python3 tests/integration/run.py prepare --profile resource
docker compose -p hydrojudge-validation -f tests/integration/compose.yml restart judge
python3 tests/integration/run.py run
python3 tests/integration/language-filter.py
python3 tests/integration/concurrency.py
python3 tests/integration/pretest.py
```

主站结果记录在 `.local-test/qa/results.json`。其中包含本次测试程序的评测细节，不包含账号密码。首次运行前可用 `python3 tests/integration/run.py run --only 'C AC' --fail-fast` 快速检查连接。

客户端策略测试使用真实安装的 HydroJudge 模块与模拟沙箱响应，验证缺省 `stdio_size: 256m`、`rerun: 2`、官方文件采集请求，以及 OLE 映射和优先策略。完整端到端套件显式使用 `stdio_size: 16m` 缩小资源用例，`rerun: 2`；沙箱的单文件限额仍为官方缺省 256 MiB。低内存下有限的 12 MiB 标准输出严格要求 MLE；无限高速输出可能同时触及输出限制，允许按现有优先策略返回 OLE，同时仍要求内存计量达到 8 MiB。20 MiB 文件输出应通过，用于验证标准流限额没有降低单文件限额。

Java 21 用例验证版本、Java 21 API、虚拟线程、AC/WA/CE/RE/TLE、文件 IO 和交互题；PyPy 3 用例验证解释器类型、JIT、AC/WA/CE/RE/TLE、文件 IO 和交互题。并发用例混合提交 Java、PyPy、CPython 任务；语言过滤测试使用未安装的 Go，确认任务不会被本评测机领取。

停止并删除测试容器和专用缓存卷：

```bash
docker compose -p hydrojudge-validation -f tests/integration/compose.yml down -v
docker network rm hydrojudge-validation-net
```

如需重新初始化测试数据，清理已停止的测试环境后再删除 `.local-test/qa`。不要对包含正式服务的数据卷运行这些清理命令。
