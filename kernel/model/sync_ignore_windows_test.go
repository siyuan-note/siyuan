package model

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncIgnoreReadFailureRecovers(t *testing.T) {
	oldData, oldWorking := util.DataDir, util.WorkingDir
	util.DataDir, util.WorkingDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.DataDir, util.WorkingDir = oldData, oldWorking })
	p := filepath.Join(util.DataDir, syncIgnoreRulePath)
	writeSyncPathTestFile(t, p)
	if err := os.WriteFile(p, []byte("/private/**/*"), 0644); err != nil {
		t.Fatal(err)
	}
	ptr, err := syscall.UTF16PtrFromString(p)
	if err != nil {
		t.Fatal(err)
	}
	h, err := syscall.CreateFile(ptr, syscall.GENERIC_READ, syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE,
		nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	defer func() {
		if !closed {
			syscall.CloseHandle(h)
		}
	}()
	if _, err = os.Stat(p); err != nil {
		t.Fatal(err)
	}
	if _, matcher, loadErr := getSyncIgnoreRules(); loadErr == nil || matcher != nil {
		t.Fatal("unreadable rules must return an error without a matcher")
	}
	if !PathsAffectSync(filepath.Join(util.DataDir, "private", "secret.txt")) {
		t.Fatal("read failure must conservatively schedule sync")
	}
	if err = syscall.CloseHandle(h); err != nil {
		t.Fatal(err)
	}
	closed = true
	_, matcher := mustSyncIgnoreRules(t)
	if !matcher.MatchesPath("/private/secret.txt") {
		t.Fatal("rules did not recover after the sharing violation ended")
	}
}
