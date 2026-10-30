#!/usr/bin/env python3
"""Prepare isolated Hydro fixtures and assert results through its real HTTP API."""

import argparse
import http.cookiejar
import io
import json
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / '.local-test' / 'qa'
STATUS = {'AC': 1, 'WA': 2, 'TLE': 3, 'MLE': 4, 'OLE': 5, 'RE': 6, 'CE': 7, 'SE': 8}
CPP = '#include <bits/stdc++.h>\nusing namespace std;\n'
SUM = CPP + 'int main(){long long a,b;cin>>a>>b;cout<<a+b<<"\\n";}\n'
C_SUM = '#include <stdio.h>\nint main(){long long a,b;scanf("%lld%lld",&a,&b);printf("%lld\\n",a+b);}\n'
PY_SUM = 'a,b=map(int,input().split()); print(a+b)\n'
JAVA_SUM = '''import java.util.Scanner;
public class Main { public static void main(String[] args) {
if (Runtime.version().feature() != 21) throw new AssertionError("JDK 21 required");
Scanner s=new Scanner(System.in); long a=s.nextLong(),b=s.nextLong(); System.out.println(a+b);
} }
'''


def fixture(key, config=None, pairs=None, extra=None):
    cfg = {'type': 'default', 'time': '3s', 'memory': '256m'}
    cfg.update(config or {})
    files = {}
    if pairs is not None:
        cfg['subtasks'] = [{'score': 100, 'type': 'min', 'cases': []}]
        for index, (stdin, stdout) in enumerate(pairs, 1):
            files[f'{index}.in'] = stdin
            files[f'{index}.out'] = stdout
            cfg['subtasks'][0]['cases'].append({'input': f'{index}.in', 'output': f'{index}.out'})
    files.update(extra or {})
    files['config.yaml'] = json.dumps(cfg)
    return {'key': key, 'files': files}


def prepare(profile='resource'):
    QA.mkdir(parents=True, exist_ok=True)
    credential_file = QA / 'credentials.json'
    if not credential_file.exists():
        credential_file.write_text(json.dumps({'admin': secrets.token_urlsafe(24), 'judge': secrets.token_urlsafe(24)}))
        credential_file.chmod(0o600)
    credentials = json.loads(credential_file.read_text())
    checker = '''#include "testlib.h"
int main(int argc,char**argv){registerTestlibCmd(argc,argv);long long n=inf.readLong(),x=ouf.readLong();
if(x*x==n)quitf(_ok,"valid root");quitf(_wa,"invalid root");}
'''
    interactor = '''#include "testlib.h"
#include <iostream>
int main(int argc,char**argv){registerInteraction(argc,argv);int n=inf.readInt();std::cout<<n<<std::endl;
int x=ouf.readInt();if(x==n*2)quitf(_ok,"correct response");quitf(_wa,"wrong response");}
'''
    size_checker = '''#include "testlib.h"
#include <cstdio>
int main(int argc,char**argv){registerTestlibCmd(argc,argv);FILE*f=fopen(argv[2],"rb");
if(!f)quitf(_fail,"missing candidate output");fseek(f,0,SEEK_END);long size=ftell(f);fclose(f);
if(size==64L*1024*1024)quitf(_ok,"64 MiB copied intact");quitf(_wa,"incorrect output size");}
'''
    manager = '''#include <stdio.h>
int main(int argc,char**argv){int n,ok=1;if(scanf("%d",&n)!=1||argc<5)return 1;
for(int i=0;i<2;i++){FILE*in=fopen(argv[2*i+1],"r"),*out=fopen(argv[2*i+2],"w");
if(!in||!out)return 2;fprintf(out,"%d\\n",n+i);fflush(out);int x;if(fscanf(in,"%d",&x)!=1||x!=2*(n+i))ok=0;}
puts(ok?"1":"0");return 0;}
'''
    fixtures = [
        fixture('sum', pairs=[('1 2\n', '3\n'), ('-7 12\n', '5\n'), ('2147483647 2147483647\n', '4294967294\n')]),
        fixture('resource', {'time': '500ms', 'memory': '64m'}, [('0\n', '0\n')]),
        fixture('vmresource', {'time': '500ms', 'memory': '256m'}, [('0\n', '0\n')]),
        fixture('smallmem', {'time': '5s', 'memory': '8m'}, [('0\n', 'x\n')]),
        fixture('largeoutput', {'time': '5s', 'memory': '8m'}, [('0\n', ('A' * 4095 + '\n') * 3072)]),
        fixture('outputlimit', {'time': '15s', 'memory': '512m'}, [('0\n', '0\n')]),
        fixture('stack', {'time': '10s', 'memory': '256m'}, [('4096\n', '4096\n')]),
        fixture('fileio', {'filename': 'sum'}, [('20 22\n', '42\n')]),
        fixture('largefile', {'filename': 'sum', 'time': '15s', 'memory': '64m'}, [('0\n', ('A' * 4095 + '\n') * 5120)]),
        fixture('filecopyboundary', {'filename': 'sum', 'time': '15s', 'memory': '256m',
                                    'checker_type': 'testlib', 'checker': 'checker.cc'},
                [('0\n', '0\n')], {'checker.cc': size_checker}),
        fixture('filelimit', {'filename': 'sum', 'time': '15s', 'memory': '512m'}, [('0\n', '0\n')]),
        fixture('special', {'checker_type': 'testlib', 'checker': 'checker.cc'}, [('9\n', '3\n')], {'checker.cc': checker}),
        fixture('interactive', {'type': 'interactive', 'interactor': 'interactor.cc', 'time': '5s'}, [('21\n', '42\n')], {'interactor.cc': interactor}),
        fixture('communication', {'type': 'communication', 'manager': 'manager.c', 'num_processes': 2, 'time': '5s'}, [('21\n', '42\n')], {'manager.c': manager}),
        fixture('answer', {'type': 'submit_answer', 'subType': 'single', 'filename': 'answer.txt'}, [('answer.txt\n', '42\n')]),
        fixture('answerzip', {'type': 'submit_answer', 'subType': 'multi', 'filename': 'answer#.txt'}, [('1\n', '3\n'), ('2\n', '5\n')]),
        fixture('objective', {'type': 'objective', 'answers': {'1': ['A', 50], '2': [['B', 'C'], 50]}}),
        fixture('partial', {'subtasks': [
            {'score': 40, 'type': 'min', 'cases': [{'input': '1.in', 'output': '1.out'}]},
            {'score': 60, 'type': 'min', 'cases': [{'input': '2.in', 'output': '2.out'}]},
        ]}, extra={'1.in': '1 2\n', '1.out': '3\n', '2.in': '10 20\n', '2.out': '30\n'}),
    ]
    (QA / 'fixtures.json').write_text(json.dumps(fixtures, indent=2))
    config = {
        'hosts': {'main': {'type': 'hydro', 'server_url': 'http://site:8888/', 'uname': 'qa-judge',
                           'password': credentials['judge'], 'detail': 'full', 'concurrency': 2,
                           'lang': ['_', 'c', 'cc', 'cc.cc17', 'java', 'py.py3', 'py.pypy3']}},
        'parallelism': 2, 'singleTaskParallelism': 2, 'memoryMax': '1024m', 'stdio_size': '16m',
        # Use a smaller stream limit to exercise OLE without huge test fixtures.
        # The sandbox's official 256 MiB file limit remains independent of it.
        'processLimit': 128, 'total_time_limit': 120, 'rerun': 2,
        'cache_dir': '/var/cache/hydrojudge', 'tmp_dir': '/tmp/hydrojudge',
        'env': 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nHOME=/w\nLANG=C.UTF-8\n',
    }
    if profile == 'defaults':
        config.pop('stdio_size')
        config.pop('rerun')
    (QA / 'judge.yaml').write_text(json.dumps(config, indent=2))
    (QA / 'judge.yaml').chmod(0o600)
    print(f'Prepared {len(fixtures)} problems under {QA}; profile={profile}; credentials are not printed')


class Client:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, url, data=None):
        body = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(self.base + url, data=body, headers={
            'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'HydroJudgeDocker-validation',
        })
        try:
            with self.opener.open(req, timeout=30) as response:
                text = response.read().decode()
                return json.loads(text)
        except urllib.error.HTTPError as error:
            text = error.read().decode()
            raise RuntimeError(f'{url}: HTTP {error.code}: {text[:800]}') from error

    def login(self):
        credentials = json.loads((QA / 'credentials.json').read_text())
        self.request('/login', {'uname': 'qa-admin', 'password': credentials['admin'], 'rememberme': 'on'})

    def submit(self, pid, lang, code, pretest=False, inputs=None):
        data = {'lang': lang, 'code': code, 'pretest': pretest}
        if inputs is not None:
            data['input'] = inputs
        response = self.request(f'/p/{pid}/submit', data)
        rid = response.get('rid') or response.get('rdoc', {}).get('_id')
        if not rid:
            raise RuntimeError(f'Submission returned no record ID: {str(response)[:800]}')
        return rid

    def submit_zip(self, pid, data):
        boundary = 'HydroJudgeValidation' + secrets.token_hex(12)
        prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="lang"\r\n\r\n_\r\n'
                  f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="answer.zip"\r\n'
                  'Content-Type: application/zip\r\n\r\n').encode()
        body = prefix + data + f'\r\n--{boundary}--\r\n'.encode()
        request = urllib.request.Request(f'{self.base}/p/{pid}/submit', data=body, headers={
            'Accept': 'application/json', 'Content-Type': f'multipart/form-data; boundary={boundary}',
        })
        with self.opener.open(request, timeout=30) as response:
            result = json.load(response)
        rid = result.get('rid') or result.get('rdoc', {}).get('_id')
        if not rid:
            raise RuntimeError(f'File submission returned no record ID: {str(result)[:800]}')
        return rid

    def wait(self, rid, timeout=180):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            result = self.request(f'/record/{rid}?nopush=1')
            last = result.get('rdoc') or result.get('record') or result
            if isinstance(last.get('status'), int) and 0 < last['status'] < 20:
                return last
            time.sleep(1)
        raise TimeoutError(f'Record {rid} did not finish; last status={last.get("status") if last else None}')


def cases():
    stack = '''#include <cstdio>
__attribute__((noinline)) long long f(int n){volatile unsigned char frame[16384];
for(int i=0;i<16384;i+=4096)frame[i]=1;frame[16383]=2;
if(n==0)return 0;long long result=f(n-1);return result+frame[0];}
int main(){int n;if(scanf("%d",&n)!=1)return 1;printf("%lld\\n",f(n));}'''
    cpu_timer = '''#define _POSIX_C_SOURCE 199309L
#include <time.h>
#include <stdio.h>
long long now(void){struct timespec t;clock_gettime(CLOCK_PROCESS_CPUTIME_ID,&t);return (long long)t.tv_sec*1000000000LL+t.tv_nsec;}
int main(void){long long start=now();while(now()-start<WAIT_NS){}puts("0");return 0;}'''
    def answer_zip(second):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('answer1.txt', '3\n')
            archive.writestr('answer2.txt', second)
        return data.getvalue()
    return [
        ('C AC', 'sum', 'c', C_SUM, 'AC', 100),
        ('Site language compiler flag', 'sum', 'c', '#ifndef QA_FROM_OJ\n#error missing_site_compiler_flag\n#endif\n#include <stdio.h>\nint main(void){long long a,b;scanf("%lld%lld",&a,&b);printf("%lld\\n",a+b+(QA_FROM_OJ-42));}', 'AC', 100),
        ('C++17 AC', 'sum', 'cc.cc17', SUM, 'AC', 100),
        ('Python3 AC', 'sum', 'py.py3', PY_SUM, 'AC', 100),
        ('Java21 AC', 'sum', 'java', JAVA_SUM, 'AC', 100),
        ('Java21 APIs and virtual thread', 'sum', 'java', '''import java.util.*;
public class Main {public static void main(String[] args) throws Exception {
if(Runtime.version().feature()!=21)throw new AssertionError("JDK 21 required");
if(new ArrayList<>(List.of(1,2,3)).reversed().getFirst()!=3)throw new AssertionError();
Thread t=Thread.startVirtualThread(()->{});t.join();
Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}''', 'AC', 100),
        ('Java21 WA', 'sum', 'java', 'public class Main {public static void main(String[] args){System.out.println(0);}}', 'WA', 0),
        ('Java21 CE', 'sum', 'java', 'public class Main {public static void main( { invalid }', 'CE', 0),
        ('Java21 RE', 'sum', 'java', 'public class Main {public static void main(String[] args){throw new RuntimeException("expected");}}', 'RE', 0),
        ('Java21 TLE', 'vmresource', 'java', 'public class Main {public static void main(String[] args){while(true){}}}', 'TLE', 0),
        ('Java21 file IO', 'fileio', 'java', '''import java.io.*;import java.util.*;
public class Main {public static void main(String[] args)throws Exception{
Scanner s=new Scanner(new File("sum.in"));try(PrintWriter w=new PrintWriter("sum.out")){w.println(s.nextLong()+s.nextLong());}}}''', 'AC', 100),
        ('Java21 interactive AC', 'interactive', 'java', 'import java.util.Scanner;public class Main {public static void main(String[] args){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()*2);System.out.flush();}}', 'AC', 100),
        ('PyPy3 AC', 'sum', 'py.pypy3', 'import platform,sys\nassert platform.python_implementation()=="PyPy"\nassert sys.pypy_translation_info["translation.jit"]\n'+PY_SUM, 'AC', 100),
        ('PyPy3 WA', 'sum', 'py.pypy3', 'print(0)\n', 'WA', 0),
        ('PyPy3 CE', 'sum', 'py.pypy3', 'def broken(:\n', 'CE', 0),
        ('PyPy3 RE', 'sum', 'py.pypy3', 'raise RuntimeError("expected")\n', 'RE', 0),
        ('PyPy3 TLE', 'vmresource', 'py.pypy3', 'while True:\n pass\n', 'TLE', 0),
        ('PyPy3 file IO', 'fileio', 'py.pypy3', 'with open("sum.in") as f:\n a,b=map(int,f.read().split())\nwith open("sum.out","w") as f:\n f.write(str(a+b)+"\\n")\n', 'AC', 100),
        ('PyPy3 interactive AC', 'interactive', 'py.pypy3', 'n=int(input())\nprint(n*2,flush=True)\n', 'AC', 100),
        ('Wrong answer', 'sum', 'cc.cc17', CPP + 'int main(){cout<<0;}', 'WA', 0),
        ('Compile error', 'sum', 'cc.cc17', 'int main( { this is invalid', 'CE', 0),
        ('Runtime error', 'resource', 'cc.cc17', '#include <cstdlib>\nint main(){std::abort();}', 'RE', 0),
        ('Time limit', 'resource', 'cc.cc17', 'int main(){for(volatile unsigned long long i=0;;++i){}}', 'TLE', 0),
        ('CPU below limit', 'resource', 'c', cpu_timer.replace('WAIT_NS', '350000000LL'), 'AC', 100),
        ('CPU above limit', 'resource', 'c', cpu_timer.replace('WAIT_NS', '700000000LL'), 'TLE', 0),
        ('Memory below limit', 'resource', 'c', '#include <stdlib.h>\n#include <stdio.h>\nint main(void){volatile char*p=(char*)malloc(24UL*1024*1024);if(!p)return 42;for(unsigned long i=0;i<24UL*1024*1024;i+=4096)p[i]=1;puts("0");}', 'AC', 100),
        ('Output below limit with low memory', 'smallmem', 'c', '#include <stdio.h>\nint main(void){char b[4096];for(int i=0;i<4096;i++)b[i]=65;for(int i=0;i<3072;i++)fwrite(b,1,sizeof b,stdout);return 0;}', 'MLE', 0),
        ('Correct large output with low memory', 'largeoutput', 'c', '#include <stdio.h>\nint main(void){char b[4096];for(int i=0;i<4096;i++)b[i]=65;b[4095]=10;for(int i=0;i<3072;i++)fwrite(b,1,sizeof b,stdout);return 0;}', 'MLE', 0),
        # An unbounded fast writer can overflow the collector while cgroup OOM
        # is stopping it. Preserve OLE priority when both limits are reported.
        ('Continuous output with low memory', 'smallmem', 'c', '#include <stdio.h>\nint main(void){char b[4096]={0};for(;;)fwrite(b,1,sizeof b,stdout);}', ('MLE', 'OLE'), 0),
        ('Output limit', 'outputlimit', 'c', '#include <stdio.h>\nint main(void){char b[4096]={0};for(int i=0;i<5120;i++)fwrite(b,1,sizeof b,stdout);return 0;}', 'OLE', 0),
        ('Stderr output limit', 'outputlimit', 'c', '#include <stdio.h>\nint main(void){char b[4096]={0};for(int i=0;i<5120;i++)fwrite(b,1,sizeof b,stderr);return 0;}', 'OLE', 0),
        ('Continuous output limit', 'outputlimit', 'c', '#include <stdio.h>\nint main(void){char b[4096]={0};for(;;)fwrite(b,1,sizeof b,stdout);}', 'OLE', 0),
        ('File output limit', 'filelimit', 'c', '#include <stdio.h>\nint main(void){char b[4096]={0};freopen("sum.out","w",stdout);for(;;)fwrite(b,1,sizeof b,stdout);}', 'OLE', 0),
        ('File output above stream limit', 'largefile', 'c', '#include <stdio.h>\nint main(void){char b[4096];for(int i=0;i<4096;i++)b[i]=65;b[4095]=10;freopen("sum.out","w",stdout);for(int i=0;i<5120;i++)fwrite(b,1,sizeof b,stdout);return 0;}', 'AC', 100),
        ('64 MiB file with 16 MiB streams', 'filecopyboundary', 'c', '#include <stdio.h>\nint main(void){char b[4096]={0};FILE*f=fopen("sum.out","wb");for(int i=0;i<16384;i++)if(fwrite(b,1,sizeof b,f)!=sizeof b)return 1;return fclose(f);}', 'AC', 100),
        ('Memory limit', 'resource', 'c', '#include <stdlib.h>\nint main(void){volatile char*p=(char*)malloc(256UL*1024*1024);if(!p)return 42;for(unsigned long i=0;i<256UL*1024*1024;i+=4096)p[i]=1;return 0;}', 'MLE', 0),
        ('C++ address-space limit', 'resource', 'cc.cc17', '#include <cstdlib>\n#include <cstdio>\nint main(){void*p=malloc(256UL*1024*1024);puts(p?"allocated":"0");}', 'AC', 100),
        ('C++ null access after allocation failure', 'resource', 'cc.cc17', '#include <cstdlib>\nint main(){volatile char*p=(char*)malloc(256UL*1024*1024);for(unsigned long i=0;i<256UL*1024*1024;i+=4096)p[i]=1;}', 'RE', 0),
        ('64 MiB recursive stack', 'stack', 'cc.cc17', stack, 'AC', 100),
        ('File IO', 'fileio', 'cc.cc17', CPP + 'int main(){freopen("sum.in","r",stdin);freopen("sum.out","w",stdout);long long a,b;cin>>a>>b;cout<<a+b;}', 'AC', 100),
        ('Special checker accepts alternative', 'special', 'cc.cc17', CPP + 'int main(){cout<<-3;}', 'AC', 100),
        ('Special checker rejects wrong', 'special', 'cc.cc17', CPP + 'int main(){cout<<4;}', 'WA', 0),
        ('Interactive AC', 'interactive', 'cc.cc17', CPP + 'int main(){int n;cin>>n;cout<<n*2<<endl;}', 'AC', 100),
        ('Interactive WA', 'interactive', 'cc.cc17', CPP + 'int main(){int n;cin>>n;cout<<n+1<<endl;}', 'WA', 0),
        ('Communication AC', 'communication', 'c', '#include <stdio.h>\nint main(void){int n;if(scanf("%d",&n)!=1)return 1;printf("%d\\n",n*2);fflush(stdout);}', 'AC', 100),
        ('Communication WA', 'communication', 'c', '#include <stdio.h>\nint main(void){int n;if(scanf("%d",&n)!=1)return 1;printf("%d\\n",n+1);fflush(stdout);}', 'WA', 0),
        ('Output only AC', 'answer', '_', '42\n', 'AC', 100),
        ('Output only WA', 'answer', '_', '41\n', 'WA', 0),
        ('Output archive AC', 'answerzip', '_', answer_zip('5\n'), 'AC', 100),
        ('Output archive WA', 'answerzip', '_', answer_zip('6\n'), 'WA', 0),
        ('Objective AC', 'objective', '_', '{"1":"A","2":["B","C"]}', 'AC', 100),
        ('Objective partial credit', 'objective', '_', '{"1":"A","2":["B"]}', 'WA', 75),
        ('Subtask partial credit', 'partial', 'cc.cc17', CPP + 'int main(){cout<<3;}', 'WA', 40),
        ('Cached problem AC', 'sum', 'cc.cc17', SUM, 'AC', 100),
    ]


def run(base, only=None, fail_fast=False):
    client = Client(base)
    client.login()
    manifest = json.loads((QA / 'manifest.json').read_text())
    report = {'baseUrl': base, 'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'cases': []}
    selected = [case for case in cases() if not only or case[0] in only]
    if not selected:
        raise ValueError('No matching test cases')
    for name, problem, lang, code, expected, score in selected:
        started = time.monotonic()
        item = {'name': name, 'expectedStatus': expected, 'expectedScore': score}
        try:
            rid = (client.submit_zip(manifest[problem], code) if isinstance(code, bytes)
                   else client.submit(manifest[problem], lang, code))
            record = client.wait(rid)
            item.update({'rid': rid, 'status': record['status'], 'score': record.get('score'),
                         'timeMs': record.get('time'), 'memoryKiB': record.get('memory'), 'judger': record.get('judger'),
                         'testCases': record.get('testCases'), 'judgeTexts': record.get('judgeTexts'),
                         'compilerTexts': record.get('compilerTexts')})
            expected_statuses = (expected,) if isinstance(expected, str) else expected
            item['passed'] = (record['status'] in [STATUS[value] for value in expected_statuses]
                              and record.get('score') == score and record.get('judger') == 3)
            if name == '64 MiB recursive stack':
                item['passed'] = item['passed'] and (record.get('memory') or 0) >= 50000
            if name == 'Memory below limit':
                item['passed'] = item['passed'] and 23000 <= (record.get('memory') or 0) < 65536
            if name in ('Output below limit with low memory', 'Correct large output with low memory',
                        'Continuous output with low memory'):
                item['passed'] = item['passed'] and (record.get('memory') or 0) >= 8192
        except Exception as error:
            item.update({'passed': False, 'error': str(error)})
        item['elapsedSeconds'] = round(time.monotonic() - started, 2)
        report['cases'].append(item)
        (QA / 'results.json').write_text(json.dumps(report, indent=2))
        print(f'{"PASS" if item["passed"] else "FAIL"}: {name}: status={item.get("status")} score={item.get("score")} elapsed={item["elapsedSeconds"]}s', flush=True)
        if 'error' in item:
            print(item['error'], flush=True)
        if fail_fast and not item['passed']:
            break
    report['passed'] = all(item['passed'] for item in report['cases'])
    (QA / 'results.json').write_text(json.dumps(report, indent=2))
    print(f'{sum(item["passed"] for item in report["cases"])}/{len(report["cases"])} passed; {QA / "results.json"}')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'run'])
    parser.add_argument('--base-url', default=os.environ.get('HYDRO_TEST_URL', 'http://127.0.0.1:18888'))
    parser.add_argument('--only', action='append', help='Run a named case; repeat to select multiple cases')
    parser.add_argument('--fail-fast', action='store_true')
    parser.add_argument('--profile', choices=['resource', 'defaults'], default='resource', help='Temporary judge profile used by prepare')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare(args.profile)
    else:
        raise SystemExit(run(args.base_url, args.only, args.fail_fast))
