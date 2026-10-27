#!/usr/bin/env python3
"""Exercise Hydro's custom-input pretest through its public HTTP handler."""

import json
import os
from run import C_SUM, Client, QA

client = Client(os.environ.get('HYDRO_TEST_URL', 'http://127.0.0.1:18888'))
client.login()
pid = json.loads((QA / 'manifest.json').read_text())['sum']
rid = client.submit(pid, 'c', C_SUM, pretest=True, inputs=['1 2'])
record = client.wait(rid)
assert record['status'] == 1 and record['judger'] == 3, record
assert record['testCases'][0]['message'].strip() == '3', record['testCases']
result = {'rid': rid, 'status': record['status'], 'judger': record['judger'],
          'output': record['testCases'][0]['message'].strip()}
(QA / 'pretest.json').write_text(json.dumps(result, indent=2))
print('PASS: custom-input pretest returned 3')
