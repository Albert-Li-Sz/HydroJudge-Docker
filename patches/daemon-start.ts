    for (const i in _hosts) {
        _hosts[i].host ||= i;
        const host = _hosts[i].type === 'vj4' ? new Vj4Host(_hosts[i]) : new HydroHost(_hosts[i]);
        hosts[i] = host;
        // Initial login failures must neither block healthy sites nor abandon retries.
        const start = async () => {
            while (true) {
                try {
                    await host.init();
                    await host.consume(queue);
                    return;
                } catch (error) {
                    log.error(`[${i}] Judge initialization failed:`, error.message);
                    await new Promise((resolve) => setTimeout(resolve, 30000));
                }
            }
        };
        start().catch((error) => log.error('Judge initialization stopped: %s', error.message));
    }
