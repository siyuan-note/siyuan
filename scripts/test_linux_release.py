"""Exercise Linux release orchestration with fake compilers and packagers."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == 'posix' and shutil.which('setsid'), 'Linux process groups required')
class LinuxReleaseTests(unittest.TestCase):
    def run_build(self, fail=False, fail_harmony=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / 'scripts').mkdir()
        (root / 'app').mkdir()
        (root / 'kernel/harmony').mkdir(parents=True)
        (root / 'bin').mkdir()
        source = Path(__file__).with_name('linux-build.sh').read_text()
        (root / 'scripts/linux-build.sh').write_text(source)
        (root / 'scripts/prepare-ocr.py').write_text('')
        def executable(path, text):
            path.write_text('#!/bin/bash\nset -e\n' + text)
            path.chmod(0o755)
        executable(root / 'bin/go', '''
if [[ "$1" == version ]]; then
 [[ "$GOPROXY" == https://mirrors.aliyun.com/goproxy/,https://goproxy.cn,direct ]] || exit 7
 [[ "$GOSUMDB" != off ]] || exit 8
 echo toolchain-ready >> "$EVENTS"
 exit 0
fi
echo "$GOARCH-start" >> "$EVENTS"
sleep 0.3
if [[ "$FAIL_ARCH" == "$GOARCH" ]]; then exit 9; fi
echo "$GOARCH-end" >> "$EVENTS"
''')
        executable(root / 'bin/pnpm', '''
if [[ "$2" == dist-linux* ]]; then
 [[ "$ELECTRON_BUILDER_COMPRESSION_LEVEL" == 5 ]] || exit 11
 echo "package-start" >> "$EVENTS"
 sleep 0.2
 echo "package-end" >> "$EVENTS"
fi
''')
        for arch in ('x86_64', 'aarch64'):
            executable(root / ('bin/' + arch + '-linux-musl-gcc'), 'exit 0\n')
        executable(root / 'scripts/harmony-kernel-build.sh', '''
echo harmony-start >> "$EVENTS"
sleep 0.3
if [[ "$FAIL_HARMONY" == 1 ]]; then exit 9; fi
echo harmony-end >> "$EVENTS"
''')
        env = dict(os.environ, PATH=str(root / 'bin') + ':' + os.environ['PATH'], HOME=str(root),
                   EVENTS=str(root / 'events'), FAIL_ARCH='arm64' if fail else '',
                   FAIL_HARMONY='1' if fail_harmony else '', ELECTRON_BUILDER_COMPRESSION_LEVEL='9')
        result = subprocess.run(['bash', str(root / 'scripts/linux-build.sh'), '--with-harmony-kernel',
                                 '--harmony-ready-file=' + str(root / 'ready'),
                                 '--process-id-file=' + str(root / 'pid')],
                                cwd=root, env=env, capture_output=True, text=True, timeout=10)
        self.assertTrue((root / 'pid').read_text().strip().isdigit())
        self.assertEqual((root / 'ready').exists(), not fail and not fail_harmony)
        self.assertEqual((root / 'ready.failed').exists(), fail_harmony)
        return result, (root / 'events').read_text().splitlines()

    def test_kernels_overlap_and_harmony_overlaps_packaging(self):
        result, events = self.run_build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(events[0], 'toolchain-ready')
        self.assertLess(max(events.index('amd64-start'), events.index('arm64-start')),
                        min(events.index('amd64-end'), events.index('arm64-end')))
        self.assertLess(events.index('harmony-start'), events.index('package-end'))
        self.assertLess(events.index('package-start'), events.index('harmony-end'))

    def test_failed_kernel_prevents_packaging(self):
        result, events = self.run_build(fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('package-start', events)
        self.assertNotIn('harmony-start', events)

    def test_failed_harmony_kernel_emits_failure_instead_of_ready(self):
        result, events = self.run_build(fail_harmony=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('harmony-start', events)
        self.assertNotIn('harmony-end', events)
