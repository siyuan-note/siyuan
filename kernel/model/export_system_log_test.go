package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteSystemGoroutineLog(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	go waitForSystemLogTest(started, release)
	defer close(release)
	<-started

	exportFolder := t.TempDir()
	if err := writeSystemGoroutineLog(exportFolder); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(exportFolder, "goroutine.log"))
	if err != nil {
		t.Fatal(err)
	}
	// 除导出请求自身外，也必须包含正在等待的其他协程。
	for _, want := range []string{"goroutine ", "writeSystemGoroutineLog", "waitForSystemLogTest"} {
		if !strings.Contains(string(content), want) {
			t.Fatalf("goroutine log does not contain %q", want)
		}
	}
	if err := writeSystemGoroutineLog(filepath.Join(exportFolder, "missing")); err == nil {
		t.Fatal("expected error for missing export directory")
	}
}

func waitForSystemLogTest(started, release chan struct{}) {
	close(started)
	<-release
}

func TestCollectOptionalSystemLogs(t *testing.T) {
	crashDir, systemTempDir := t.TempDir(), t.TempDir()
	archiveDir := filepath.Join(crashDir, "crash-history")
	if err := os.Mkdir(archiveDir, 0700); err != nil {
		t.Fatal(err)
	}
	for file, content := range map[string]string{
		filepath.Join(crashDir, "app.crash.log"):           "current",
		filepath.Join(archiveDir, "app.crash.log"):         "previous",
		filepath.Join(archiveDir, "app.crash.json"):        "{}",
		filepath.Join(systemTempDir, "SiYuan-install.log"): "installed",
	} {
		if err := os.WriteFile(file, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	// 导出使用保存的目录，不依赖已经重定向的临时环境变量。
	t.Setenv("TEMP", t.TempDir())
	t.Setenv("TMP", t.TempDir())
	t.Setenv("TMPDIR", t.TempDir())
	for _, windows := range []bool{false, true} {
		exportFolder := t.TempDir()
		collectOptionalSystemLogs(crashDir, systemTempDir, exportFolder, windows)
		for name, want := range map[string]string{"app.crash.log": "current", "app.crash.json": "{}"} {
			got, err := os.ReadFile(filepath.Join(exportFolder, name))
			if err != nil || string(got) != want {
				t.Fatalf("%s: got %q, err %v", name, got, err)
			}
		}
		got, err := os.ReadFile(filepath.Join(exportFolder, "SiYuan-install.log"))
		if windows && (err != nil || string(got) != "installed") {
			t.Fatalf("installer log: %q, %v", got, err)
		}
		if !windows && !os.IsNotExist(err) {
			t.Fatalf("unexpected installer log: %q, %v", got, err)
		}
	}
}

func TestCopyOptionalSystemLog(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source"), filepath.Join(dir, "target")
	content := "old install\r\nlatest install\r\n"
	if err := os.WriteFile(source, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	for _, limit := range []int64{0, 16, 1024} {
		copyOptionalSystemLog(source, target, limit)
		got, err := os.ReadFile(target)
		want := content
		if limit > 0 && int64(len(want)) > limit {
			want = want[int64(len(want))-limit:]
		}
		if err != nil || string(got) != want {
			t.Fatalf("limit %d: got %q, err %v, want %q", limit, got, err, want)
		}
	}
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	for _, unavailable := range []string{filepath.Join(dir, "missing"), dir} {
		copyOptionalSystemLog(unavailable, target, 1024)
		if _, err := os.Stat(target); !os.IsNotExist(err) {
			t.Fatalf("unexpected output for %s: %v", unavailable, err)
		}
	}
	got, err := os.ReadFile(source)
	if err != nil || string(got) != content {
		t.Fatalf("source changed: %q, %v", got, err)
	}
}
