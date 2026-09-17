package util

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
)

func setupAppearanceIsolationTest(t *testing.T) string {
	t.Helper()
	oldData := DataDir
	DataDir = t.TempDir()
	t.Cleanup(func() { DataDir = oldData })
	return filepath.Join(DataDir, ".siyuan", "syncignore")
}

func writeAppearanceIsolationTestRules(t *testing.T, name string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, data, 0644); err != nil {
		t.Fatal(err)
	}
}

func readAppearanceIsolationTestRules(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestAppearanceSyncIsolationPreservesRules(t *testing.T) {
	for _, original := range []string{
		"", "/themes/private/\n/assets/private/\n!/themes/custom/**",
		"\ufeff# existing rules\r\n/themes/private/\r\n/icons/\r\n!/themes/custom/**\r\n",
	} {
		t.Run(strings.ReplaceAll(original, "/", "_"), func(t *testing.T) {
			rulePath := setupAppearanceIsolationTest(t)
			writeAppearanceIsolationTestRules(t, rulePath, []byte(original))
			previous := time.Now().Add(time.Hour).Truncate(time.Second)
			if err := os.Chtimes(rulePath, previous, previous); err != nil {
				t.Fatal(err)
			}
			if err := EnsureAppearanceSyncIsolation(); err != nil {
				t.Fatal(err)
			}
			data := readAppearanceIsolationTestRules(t, rulePath)
			if !bytes.HasPrefix(data, []byte(original)) {
				t.Fatalf("user bytes changed: %q", data)
			}
			lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
			matcher := ignore.CompileIgnoreLines(lines...)
			for _, p := range []string{"themes/custom/theme.css", "icons/custom/icon.js", "storage/bazaar/themes/custom.json", "storage/bazaar/icons/custom.json"} {
				if !matcher.MatchesPath(p) {
					t.Errorf("old engine isolation missing: %s", p)
				}
			}
			if matcher.MatchesPath("storage/appearance-v1/themes/custom/event.sypkg") {
				t.Fatal("transport archive was excluded")
			}
			userLines, err := AppearanceUserSyncIgnoreLines(lines)
			if err != nil {
				t.Fatal(err)
			}
			want := strings.Split(strings.TrimSuffix(strings.ReplaceAll(original, "\r\n", "\n"), "\n"), "\n")
			if !reflect.DeepEqual(nonemptyAppearanceIsolationLines(userLines), nonemptyAppearanceIsolationLines(want)) {
				t.Fatalf("user rule order changed: %q != %q", userLines, want)
			}
			userMatcher := ignore.CompileIgnoreLines(userLines...)
			if userMatcher.MatchesPath("themes/shared/theme.css") {
				t.Fatal("managed isolation was treated as a user exclusion")
			}
			info, err := os.Stat(rulePath)
			if err != nil {
				t.Fatal(err)
			}
			if info.ModTime().Unix() <= previous.Unix() {
				t.Fatal("rule change reused the previous legacy file ID")
			}
			if err = EnsureAppearanceSyncIsolation(); err != nil {
				t.Fatal(err)
			}
			again, err := os.Stat(rulePath)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(data, readAppearanceIsolationTestRules(t, rulePath)) || !again.ModTime().Equal(info.ModTime()) {
				t.Fatal("idempotent bootstrap rewrote the rule file")
			}
		})
	}
}

func nonemptyAppearanceIsolationLines(lines []string) []string {
	var ret []string
	for _, line := range lines {
		if line != "" {
			ret = append(ret, line)
		}
	}
	return ret
}

func TestAppearanceSyncIsolationMovesBlockAfterUserRules(t *testing.T) {
	rulePath := setupAppearanceIsolationTest(t)
	initial := "/themes/private/\n"
	writeAppearanceIsolationTestRules(t, rulePath, []byte(initial))
	if err := EnsureAppearanceSyncIsolation(); err != nil {
		t.Fatal(err)
	}
	data := append(readAppearanceIsolationTestRules(t, rulePath), []byte("!/themes/shared/**\n/icons/private/\n")...)
	writeAppearanceIsolationTestRules(t, rulePath, data)
	if err := EnsureAppearanceSyncIsolation(); err != nil {
		t.Fatal(err)
	}
	data = readAppearanceIsolationTestRules(t, rulePath)
	if bytes.Count(data, []byte(appearanceIsolationBlock[0])) != 1 ||
		!bytes.HasSuffix(data, []byte(strings.Join(appearanceIsolationBlock, "\n")+"\n")) {
		t.Fatalf("managed block was duplicated or not moved: %q", data)
	}
	lines, err := AppearanceUserSyncIgnoreLines(strings.Split(string(data), "\n"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"/themes/private/", "!/themes/shared/**", "/icons/private/"}
	if !reflect.DeepEqual(nonemptyAppearanceIsolationLines(lines), want) {
		t.Fatalf("user rules lost: %q", lines)
	}
	user := ignore.CompileIgnoreLines(lines...)
	if !user.MatchesPath("themes/private/theme.css") || !user.MatchesPath("icons/private/icon.js") || user.MatchesPath("themes/shared/theme.css") {
		t.Fatal("user whole-package selection changed")
	}
	if !ignore.CompileIgnoreLines(strings.Split(string(data), "\n")...).MatchesPath("themes/shared/theme.css") {
		t.Fatal("later user rule bypassed old-engine isolation")
	}
}

func TestAppearanceSyncIsolationRepairsRestoredRules(t *testing.T) {
	rulePath := setupAppearanceIsolationTest(t)
	if err := EnsureAppearanceSyncIsolation(); err != nil {
		t.Fatal(err)
	}
	oldRules := []byte("/assets/old-private/\n")
	writeAppearanceIsolationTestRules(t, rulePath, oldRules)
	if err := EnsureAppearanceSyncIsolation(); err != nil {
		t.Fatal(err)
	}
	data := readAppearanceIsolationTestRules(t, rulePath)
	if !bytes.HasPrefix(data, oldRules) || bytes.Count(data, []byte(appearanceIsolationBlock[0])) != 1 {
		t.Fatalf("restored rule file not isolated: %q", data)
	}
	for _, kind := range []string{"themes", "icons"} {
		if _, err := os.Lstat(filepath.Join(DataDir, kind)); !os.IsNotExist(err) {
			t.Fatal("isolation helper created appearance projections")
		}
	}
}

func TestAppearanceSyncIsolationRejectsUnknownOrBrokenBlock(t *testing.T) {
	valid := strings.Join(appearanceIsolationBlock, "\n") + "\n"
	for name, content := range map[string]string{
		"unknown":      strings.ReplaceAll(valid, ":v1:", ":v2:"),
		"missing-end":  strings.TrimSuffix(valid, appearanceIsolationBlock[len(appearanceIsolationBlock)-1]+"\n"),
		"changed-rule": strings.Replace(valid, "/themes/", "/widgets/", 1),
		"orphan-end":   appearanceIsolationBlock[len(appearanceIsolationBlock)-1] + "\n",
	} {
		t.Run(name, func(t *testing.T) {
			rulePath := setupAppearanceIsolationTest(t)
			writeAppearanceIsolationTestRules(t, rulePath, []byte(content))
			info, err := os.Stat(rulePath)
			if err != nil {
				t.Fatal(err)
			}
			if err = EnsureAppearanceSyncIsolation(); err == nil {
				t.Fatal("invalid isolation block accepted")
			}
			if _, err = AppearanceUserSyncIgnoreLines(strings.Split(content, "\n")); err == nil {
				t.Fatal("invalid block produced usable user rules")
			}
			after, err := os.Stat(rulePath)
			if err != nil || !after.ModTime().Equal(info.ModTime()) || !bytes.Equal(readAppearanceIsolationTestRules(t, rulePath), []byte(content)) {
				t.Fatal("invalid rule source changed")
			}
		})
	}
}

func TestAppearanceSyncIsolationRejectsNonregularRuleFile(t *testing.T) {
	for _, kind := range []string{"directory", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			rulePath := setupAppearanceIsolationTest(t)
			if err := os.MkdirAll(filepath.Dir(rulePath), 0755); err != nil {
				t.Fatal(err)
			}
			if kind == "directory" {
				if err := os.Mkdir(rulePath, 0755); err != nil {
					t.Fatal(err)
				}
			} else {
				target := filepath.Join(t.TempDir(), "rules")
				writeAppearanceIsolationTestRules(t, target, []byte("/private/\n"))
				if err := os.Symlink(target, rulePath); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
				t.Cleanup(func() {
					if !bytes.Equal(readAppearanceIsolationTestRules(t, target), []byte("/private/\n")) {
						t.Error("external rule source changed")
					}
				})
			}
			if err := EnsureAppearanceSyncIsolation(); err == nil {
				t.Fatal("nonregular rule file accepted")
			}
			if _, err := os.Lstat(rulePath); err != nil {
				t.Fatal("nonregular rule source removed")
			}
		})
	}
}

func TestAppearanceSyncIsolationWaitsForRuleLock(t *testing.T) {
	rulePath := setupAppearanceIsolationTest(t)
	filelock.Lock(rulePath)
	done := make(chan error, 1)
	go func() { done <- EnsureAppearanceSyncIsolation() }()
	select {
	case err := <-done:
		filelock.Unlock(rulePath)
		t.Fatalf("bootstrap ignored rule-file lock: %v", err)
	case <-time.After(30 * time.Millisecond):
	}
	filelock.Unlock(rulePath)
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("bootstrap did not resume after rule-file unlock")
	}
}

func TestAppearanceSyncIsolationRestoreDoesNotReuseTimestamp(t *testing.T) {
	rulePath := setupAppearanceIsolationTest(t)
	old := time.Now().Add(-time.Hour).Truncate(time.Second)
	last := int64(0)
	for _, rules := range []string{"/assets/a/\n", "/assets/b/\n", "/assets/c/\n"} {
		writeAppearanceIsolationTestRules(t, rulePath, []byte(rules))
		if err := os.Chtimes(rulePath, old, old); err != nil {
			t.Fatal(err)
		}
		if err := EnsureAppearanceSyncIsolation(); err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(rulePath)
		if err != nil {
			t.Fatal(err)
		}
		if info.ModTime().Unix() <= last {
			t.Fatal("restored rules reused a previously published legacy file ID")
		}
		last = info.ModTime().Unix()
	}
	clockPath := filepath.Join(filepath.Dir(rulePath), appearanceIsolationClockName)
	clock, err := os.Stat(clockPath)
	if err != nil {
		t.Fatal(err)
	}
	if ignored, err := dejavu.IgnorePath(clock, clockPath, "/.siyuan/"+appearanceIsolationClockName,
		".siyuan/syncignore", ".siyuan"); !ignored || err != nil {
		t.Fatalf("local clock can enter an ordinary snapshot: %v", err)
	}
	contents := readAppearanceIsolationTestRules(t, clockPath)
	if err = EnsureAppearanceSyncIsolation(); err != nil {
		t.Fatal(err)
	}
	again, err := os.Stat(clockPath)
	if err != nil || !again.ModTime().Equal(clock.ModTime()) || !os.SameFile(clock, again) ||
		!bytes.Equal(contents, readAppearanceIsolationTestRules(t, clockPath)) {
		t.Fatal("unchanged rules rewrote the reserved clock")
	}
}

func TestAppearanceSyncIsolationClockSurvivesBackwardTime(t *testing.T) {
	rulePath := setupAppearanceIsolationTest(t)
	writeAppearanceIsolationTestRules(t, rulePath, []byte("/assets/private/\n"))
	future := time.Now().Add(24 * time.Hour).Unix()
	clockPath := filepath.Join(filepath.Dir(rulePath), appearanceIsolationClockName)
	clock, err := json.Marshal(appearanceIsolationClock{Version: 1, Modified: future})
	if err != nil {
		t.Fatal(err)
	}
	writeAppearanceIsolationTestRules(t, clockPath, clock)
	if err = EnsureAppearanceSyncIsolation(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(rulePath)
	if err != nil || info.ModTime().Unix() <= future {
		t.Fatalf("wall-clock rollback reused a reserved timestamp: %v", err)
	}
}

func TestAppearanceSyncIsolationRejectsUnknownClock(t *testing.T) {
	for _, contents := range []string{
		`{"version":2,"modified":100}`, `{"version":1,"modified":0}`, `{"version":1,"modified":100,"future":true}`,
		`{"version":1,"modified":100} {}`, "{broken", `{"version":1,"modified":9223372036854775807}`,
		`{"version":2,"version":1,"modified":100}`, `{"version":1,"modified":200,"modified":100}`,
		`{"version":null,"modified":100}`,
	} {
		t.Run(contents, func(t *testing.T) {
			rulePath := setupAppearanceIsolationTest(t)
			original := []byte("/assets/private/\n")
			writeAppearanceIsolationTestRules(t, rulePath, original)
			clockPath := filepath.Join(filepath.Dir(rulePath), appearanceIsolationClockName)
			writeAppearanceIsolationTestRules(t, clockPath, []byte(contents))
			info, err := os.Stat(rulePath)
			if err != nil {
				t.Fatal(err)
			}
			if err = EnsureAppearanceSyncIsolation(); err == nil {
				t.Fatal("unknown clock accepted")
			}
			after, err := os.Stat(rulePath)
			if err != nil || !after.ModTime().Equal(info.ModTime()) || !os.SameFile(info, after) ||
				!bytes.Equal(original, readAppearanceIsolationTestRules(t, rulePath)) ||
				!bytes.Equal([]byte(contents), readAppearanceIsolationTestRules(t, clockPath)) {
				t.Fatal("unknown clock changed source rules or local recovery material")
			}
		})
	}
}

func TestAppearanceSyncIsolationReservesBeforePublishing(t *testing.T) {
	rulePath := setupAppearanceIsolationTest(t)
	original := []byte("/assets/private/\n")
	writeAppearanceIsolationTestRules(t, rulePath, original)
	info, err := os.Stat(rulePath)
	if err != nil {
		t.Fatal(err)
	}
	reserved, err := reserveAppearanceIsolationTime(rulePath, info, true)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, readAppearanceIsolationTestRules(t, rulePath)) {
		t.Fatal("reserving the timestamp published rule bytes")
	}
	if err = EnsureAppearanceSyncIsolation(); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(rulePath)
	if err != nil || after.ModTime().Unix() <= reserved.Unix() {
		t.Fatalf("interrupted publication reused a reserved timestamp: %v", err)
	}
}
