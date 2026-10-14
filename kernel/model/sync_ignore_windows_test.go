package model

import (
	"os"
	"path/filepath"
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
	invalidateSyncIgnoreRules(p)
	t.Cleanup(func() { invalidateSyncIgnoreRules(p) })
	release := lockFirstByteForTest(t, p)
	if _, matcher, loadErr := getSyncIgnoreRules(); loadErr == nil || matcher != nil {
		t.Fatalf("unreadable rules must return an error without a matcher: error=%v, matcher=%v", loadErr, matcher)
	}
	if !PathsAffectSync(filepath.Join(util.DataDir, "private", "secret.txt")) {
		t.Fatal("read failure must conservatively schedule sync")
	}
	release()
	if data, err := os.ReadFile(p); err != nil || string(data) != "/private/**/*" {
		t.Fatalf("locked read changed ignore rules: %q, %v", data, err)
	}
	_, matcher := mustSyncIgnoreRules(t)
	if !matcher.MatchesPath("/private/secret.txt") {
		t.Fatal("rules did not recover after the read lock ended")
	}
}
