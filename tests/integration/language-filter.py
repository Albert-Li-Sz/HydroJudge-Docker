#!/usr/bin/env python3
"""Verify that a worker does not take a language outside hosts.main.lang."""

import json
import os
import time
from run import Client, QA

client = Client(os.environ.get('HYDRO_TEST_URL', 'http://127.0.0.1:18888'))
client.login()
manifest = json.loads((QA / 'manifest.json').read_text())
rid = client.submit(manifest['sum'], 'go', 'package main\nfunc main() {}\n')
try:
    for _ in range(6):
        result = client.request(f'/record/{rid}?nopush=1')
        status = result['rdoc']['status']
        if status != 0:
            raise AssertionError(f'Excluded Go task was taken by a worker (status={status})')
        time.sleep(2)
    (QA / 'language-filter.json').write_text(json.dumps({'excludedLanguage': 'go',
                                                         'waitingSeconds': 12, 'rid': rid}, indent=2))
    print(f'PASS: excluded Go task {rid} remained waiting for 12 seconds')
finally:
    client.request(f'/record/{rid}', {'operation': 'cancel'})
