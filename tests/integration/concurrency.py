#!/usr/bin/env python3
"""Submit real Hydro tasks and observe at least two simultaneously active."""

import json
import os
import time
from run import Client, JAVA_SUM, PY_SUM, QA

client = Client(os.environ.get('HYDRO_TEST_URL', 'http://127.0.0.1:18888'))
client.login()
pid = json.loads((QA / 'manifest.json').read_text())['sum']
python = 'import time\ntime.sleep(0.5)\n' + PY_SUM
pypy = 'import platform\nassert platform.python_implementation()=="PyPy"\n' + python
rids = [client.submit(pid, lang, source) for lang, source in [
    ('java', JAVA_SUM), ('py.pypy3', pypy), ('java', JAVA_SUM), ('py.py3', python),
]]
records = {}
max_active = 0
deadline = time.monotonic() + 120
while len(records) < len(rids) and time.monotonic() < deadline:
    active = 0
    for rid in rids:
        if rid in records:
            continue
        record = client.request(f'/record/{rid}?nopush=1')['rdoc']
        if record['status'] in (20, 21, 22):
            active += 1
        elif 0 < record['status'] < 20:
            records[rid] = record
    max_active = max(max_active, active)
    time.sleep(0.3)
assert len(records) == 4, f'Only {len(records)}/4 records completed'
assert all(r['status'] == 1 and r['score'] == 100 and r['judger'] == 3 for r in records.values())
assert max_active >= 2, f'Only {max_active} simultaneous active tasks observed'
(QA / 'concurrency.json').write_text(json.dumps({'languages': ['java', 'py.pypy3', 'java', 'py.py3'],
                                                  'submissions': len(records), 'accepted': len(records),
                                                  'maxActive': max_active}, indent=2))
print(f'PASS: 4/4 mixed Java/PyPy/CPython tasks accepted, maximum observed active tasks: {max_active}')
