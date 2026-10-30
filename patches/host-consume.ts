    async consume(queue: PQueue) {
        if (this.stopped || this.connecting
            || [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.ws?.readyState)) return;
        this.connecting = true;
        try {
            // A WebSocket reconnect must not keep using a revoked login session.
            if (this.forceLogin) {
                await this.login();
                this.forceLogin = false;
            } else await this.ensureLogin();
            if (this.stopped) return;
            const sid = this.config.cookie?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
            if (!sid) throw new Error('Login did not return a judge session');
            log.info('正在连接 %sjudge/conn', this.config.server_url);
            const socket = new WebSocket(`${this.config.server_url.replace(/^http/i, 'ws')}judge/conn`, {
                headers: { Authorization: `Bearer ${sid}` },
                handshakeTimeout: 15000,
            });
            this.ws = socket;
            const config: { prio?: number, concurrency?: number, lang?: string[] } = {};
            if (this.config.minPriority !== undefined) config.prio = this.config.minPriority;
            if (this.config.concurrency !== undefined) config.concurrency = this.config.concurrency;
            if (this.config.lang?.length) config.lang = this.config.lang;
            const content = Object.keys(config).length ? JSON.stringify({ key: 'config', ...config }) : '{"key":"ping"}';
            let compilers = {};
            let stackSize = 0;
            let sendStatus = () => {};
            const current = () => !this.stopped && this.ws === socket && socket.readyState === WebSocket.OPEN;
            await new Promise((resolve) => {
                let interval: ReturnType<typeof setInterval>;
                let ended = false;
                const stop = () => {
                    if (ended) return;
                    ended = true;
                    clearInterval(interval);
                    if (this.ws === socket) {
                        this.ws = undefined;
                        this.retry(queue);
                    }
                    resolve(null);
                };
                socket.on('message', (data) => {
                    if (!current()) return;
                    if (data.toString() === 'ping') {
                        socket.send('pong');
                        return;
                    }
                    const request = JSON.parse(data.toString());
                    if (request.language) {
                        this.language = request.language;
                        Promise.allSettled([compilerVersions(this.language), getStackSize()]).then(([compiler, stack]) => {
                            compilers = compiler.status === 'fulfilled' ? compiler.value : {};
                            stackSize = stack.status === 'fulfilled' ? stack.value : 0;
                            sendStatus();
                        });
                    }
                    if (request.task) queue.add(() => new JudgeTask(this, request.task).handle())
                        .catch((error) => log.error(error));
                });
                socket.on('close', (code, reason) => {
                    if (!this.stopped) log.warn(`[${this.config.host}] Websocket 断开:`, code, reason.toString());
                    stop();
                });
                socket.on('error', (error) => {
                    if (!this.stopped) log.error(`[${this.config.host}] Websocket 错误:`, error.message);
                    stop();
                    socket.terminate();
                });
                socket.on('unexpected-response', (_request, response) => {
                    if ([401, 403].includes(response.statusCode)) this.forceLogin = true;
                    response.resume();
                    stop();
                    socket.terminate();
                });
                socket.once('open', () => {
                    if (!current()) return socket.terminate();
                    socket.send(content);
                    socket.send('{"key":"start"}');
                    if (!this.config.noStatus) {
                        sysinfo.get().then((info) => {
                            if (!current()) return;
                            sendStatus = () => {
                                if (current()) socket.send(JSON.stringify({ key: 'status', info: { ...info, compilers, stackSize } }));
                            };
                            sendStatus();
                            interval = setInterval(() => {
                                sysinfo.update().then(([mid, inf]) => {
                                    if (current()) socket.send(JSON.stringify({ key: 'status', info: { mid, ...inf, compilers, stackSize } }));
                                }).catch((error) => log.warn('Judge status update failed: %s', error.message));
                            }, 1200000);
                        }).catch((error) => log.warn('Judge status collection failed: %s', error.message));
                    }
                    log.info(`[${this.config.host}] 已连接`);
                    resolve(null);
                });
            });
        } catch (error) {
            if (!this.stopped) log.error(`[${this.config.host}] Judge connection failed:`, error.message);
            this.retry(queue);
        } finally {
            this.connecting = false;
        }
    }
