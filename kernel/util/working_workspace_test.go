package util

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/gofrs/flock"
	"github.com/siyuan-note/logging"
)

func TestBootWorkspaceTempCleanup(t *testing.T) {
	for _, locked := range []bool{true, false} {
		t.Run(map[bool]string{true: "locked", false: "unlocked"}[locked], func(t *testing.T) {
			base := t.TempDir()
			workspace := filepath.Join(base, "workspace")
			var files []string
			for _, dir := range []string{"os", "repo", "export", "clipboard"} {
				filename := filepath.Join(workspace, "temp", dir, "active.txt")
				if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filename, []byte("active operation"), 0600); err != nil {
					t.Fatal(err)
				}
				files = append(files, filename)
			}
			if locked {
				lock := flock.New(filepath.Join(workspace, ".lock"))
				if ok, err := lock.TryLock(); err != nil || !ok {
					t.Fatalf("hold workspace lock: %v, %v", ok, err)
				}
				t.Cleanup(func() { _ = lock.Unlock() })
			}
			command := exec.Command(os.Args[0], "-test.run=^TestBootHomeDirProcess$", "--",
				"--home-dir="+filepath.Join(base, "home"), "--workspace="+workspace, "--wd="+base)
			command.Env = append(os.Environ(), "SIYUAN_TEST_BOOT_HOME="+filepath.Join(base, "system-home"))
			output, err := command.CombinedOutput()
			if locked {
				exit, ok := err.(*exec.ExitError)
				if !ok || exit.ExitCode() != logging.ExitCodeWorkspaceLocked {
					t.Fatalf("expected workspace lock rejection: %v\n%s", err, output)
				}
			} else if err != nil {
				t.Fatalf("boot failed: %v\n%s", err, output)
			}
			for _, filename := range files {
				data, err := os.ReadFile(filename)
				if locked && (err != nil || string(data) != "active operation") {
					t.Errorf("rejected startup changed %s: %q, %v", filename, data, err)
				} else if !locked && !os.IsNotExist(err) {
					t.Errorf("successful startup retained stale temp file %s: %v", filename, err)
				}
			}
		})
	}
}
