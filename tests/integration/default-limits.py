#!/usr/bin/env python3
"""Run with stdio_size/rerun omitted from the temporary judge configuration."""

import json
import os
from run import Client, C_SUM, QA


def main():
    client = Client(os.environ.get('HYDRO_TEST_URL', 'http://127.0.0.1:18888'))
    client.login()
    manifest = json.loads((QA / 'manifest.json').read_text())
    writer = '#include <stdio.h>\nint main(void){char b[4096]={0};for(int i=0;i<5120;i++)fwrite(b,1,sizeof b,STREAM);puts("0");return 0;}'
    checks = [
        ('Default profile C AC', 'sum', C_SUM, 1, 100),
        ('20 MiB stdout below default limit', 'outputlimit', writer.replace('STREAM', 'stdout'), 2, 0),
        ('20 MiB stderr below default limit', 'outputlimit', writer.replace('STREAM', 'stderr'), 1, 100),
    ]
    results = []
    for name, problem, source, status, score in checks:
        rid = client.submit(manifest[problem], 'c', source)
        record = client.wait(rid)
        passed = record['status'] == status and record.get('score') == score and record.get('judger') == 3
        results.append({'name': name, 'rid': rid, 'status': record['status'], 'score': record.get('score'),
                        'memoryKiB': record.get('memory'), 'passed': passed})
        print(f'{"PASS" if passed else "FAIL"}: {name}: status={record["status"]}', flush=True)
    report = {'passed': all(item['passed'] for item in results), 'cases': results}
    (QA / 'results-default-limits.json').write_text(json.dumps(report, indent=2) + '\n')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
