#!/usr/bin/env python3
"""Apply test languages through the site's real system-settings handler."""

import json
import os
from run import Client, QA

client = Client(os.environ.get('HYDRO_TEST_URL', 'http://127.0.0.1:18888'))
client.login()
# The handler emits the nested setting notification needed to refresh the
# server's parsed languages. A separate CLI process only updates the database.
payload = {'hydrooj': {'langs': (QA / 'test-langs.yaml').read_text()}}
response = client.request('/manage/setting', payload)
if response.get('url') == '/user/sudo':
    credentials = json.loads((QA / 'credentials.json').read_text())
    client.request('/user/sudo', {'password': credentials['admin']})
    response = client.request('/manage/setting', payload)
assert response.get('url') != '/user/sudo', 'System-setting update still requires sudo authentication'
print('Applied language configuration through the Hydro system-settings HTTP handler', flush=True)
