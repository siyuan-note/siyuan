package model

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func mustSyncIgnoreRules(t testing.TB) ([]string, *ignore.GitIgnore) {
	t.Helper()
	lines, matcher, err := getSyncIgnoreRules()
	if err != nil {
		t.Fatal(err)
	}
	return lines, matcher
}

func mustSyncIgnoreLines(t testing.TB) []string {
	t.Helper()
	lines, _ := mustSyncIgnoreRules(t)
	return lines
}

func TestSyncIgnoreRemovesRestoredAppearanceIsolation(t *testing.T) {
	setupAppearancePackagesTest(t)
	oldWorking := util.WorkingDir
	util.WorkingDir = t.TempDir()
	t.Cleanup(func() { util.WorkingDir = oldWorking })
	block := "# siyuan-appearance-isolation:v1:begin\n/themes/\n/icons/\n/storage/bazaar/themes/\n/storage/bazaar/icons/\n# siyuan-appearance-isolation:v1:end\n"
	userRules := "# local packages\n/themes/local/\n/icons/local/\n"
	rule := filepath.Join(util.DataDir, syncIgnoreRulePath)
	writeAppearanceTestFile(t, rule, userRules+block)
	oldTime := time.Unix(1700000000, 0)
	if err := os.Chtimes(rule, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	options := dejavu.Options{
		DataPath: util.DataDir, RepoPath: filepath.Join(base, "repo"), HistoryPath: filepath.Join(base, "history"), TempPath: filepath.Join(base, "temp"),
		DeviceID: "device", DeviceName: "device", DeviceOS: "windows", AESKey: []byte("0123456789abcdef0123456789abcdef"),
		IgnoreLines: strings.Split(userRules+block, "\n"), IgnoreRulePath: syncIgnoreRulePath, HiddenDirectoryNames: []string{".siyuan"},
		PathFilter: func(info os.FileInfo, path string) (bool, error) {
			return syncPathFilter(util.DataDir, info, path)
		},
	}
	repo, err := dejavu.NewRepoWithOptions(options)
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.Index("before migration", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = MigrateAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	options.IgnoreLines = mustSyncIgnoreLines(t)
	repo, err = dejavu.NewRepoWithOptions(options)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.Index("after migration", true, nil); err != nil {
		t.Fatal(err)
	}
	if err = checkoutRepoSnapshot(repo, before.ID, func(error) {}); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(rule); err != nil || string(data) != userRules+block {
		t.Fatalf("snapshot did not restore the isolation block: %q, %v", data, err)
	}
	_, matcher := mustSyncIgnoreRules(t)
	for _, path := range []string{"/themes/custom/theme.css", "/icons/custom/icon.js"} {
		if matcher.MatchesPath(path) {
			t.Fatalf("restored isolation block excludes package: %s", path)
		}
	}
	for _, path := range []string{"/themes/local/theme.css", "/icons/local/icon.js"} {
		if !matcher.MatchesPath(path) {
			t.Fatalf("user rule was removed: %s", path)
		}
	}
	if data, err := os.ReadFile(rule); err != nil || string(data) != userRules {
		t.Fatalf("restored isolation block not removed cleanly: %q, %v", data, err)
	}
	_, cached := mustSyncIgnoreRules(t)
	_, reused := mustSyncIgnoreRules(t)
	if cached != reused {
		t.Fatal("cleaned rules were not cached")
	}
}

func TestSyncIgnoreRejectsModifiedAppearanceIsolation(t *testing.T) {
	oldData, oldWorking := util.DataDir, util.WorkingDir
	util.DataDir, util.WorkingDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.DataDir, util.WorkingDir = oldData, oldWorking })
	mustSyncIgnoreRules(t)
	rule := filepath.Join(util.DataDir, syncIgnoreRulePath)
	original := "# siyuan-appearance-isolation:v1:begin\n/custom/\n"
	writeAppearanceTestFile(t, rule, original)
	if _, matcher, err := getSyncIgnoreRules(); err == nil || matcher != nil {
		t.Fatal("modified isolation block produced usable rules")
	}
	if data, err := os.ReadFile(rule); err != nil || string(data) != original {
		t.Fatalf("modified rules were not preserved: %q, %v", data, err)
	}
	writeAppearanceTestFile(t, rule, "/custom/\n")
	_, matcher := mustSyncIgnoreRules(t)
	if !matcher.MatchesPath("/custom/file") {
		t.Fatal("rule loading did not recover after correction")
	}
}

func TestSyncIgnoreGuideReadFailureRecovers(t *testing.T) {
	oldData, oldWorking := util.DataDir, util.WorkingDir
	util.DataDir, util.WorkingDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.DataDir, util.WorkingDir = oldData, oldWorking })
	guide := filepath.Join(util.WorkingDir, "guide")
	writeSyncPathTestFile(t, guide)
	if _, matcher, err := getSyncIgnoreRules(); err == nil || matcher != nil {
		t.Fatal("guide read failure must not produce usable rules")
	}
	if err := os.Remove(guide); err != nil {
		t.Fatal(err)
	}
	mustSyncIgnoreRules(t)
}

func TestSyncIgnoreRepositoryRejectsUnreadableRules(t *testing.T) {
	prepareAssetDownloadRepoTest(t)
	p := filepath.Join(util.DataDir, syncIgnoreRulePath)
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err := os.MkdirAll(p, 0755); err != nil {
		t.Fatal(err)
	}
	if repo, err := newRepository(); err == nil || repo != nil {
		t.Fatal("repository creation continued with unreadable rules")
	}
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if _, err := newRepository(); err != nil {
		t.Fatalf("repository creation did not recover: %v", err)
	}
}

func TestSyncPathFilterUsesBoundRoot(t *testing.T) {
	oldData := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldData })
	root := t.TempDir()
	for _, tc := range []struct {
		path    string
		ignored bool
	}{{"assets/tracked.txt", false}, {"storage/local.json", true}} {
		p := filepath.Join(root, tc.path)
		writeSyncPathTestFile(t, p)
		info, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		if ignored, err := syncPathFilter(root, info, p); err != nil || ignored != tc.ignored {
			t.Fatalf("bound root was not used for %s: %v %v", tc.path, ignored, err)
		}
	}
}

func TestPathsAffectSyncLinkedDataRoot(t *testing.T) {
	oldData := util.DataDir
	t.Cleanup(func() { util.DataDir = oldData })
	root := t.TempDir()
	util.DataDir = filepath.Join(t.TempDir(), "data")
	if err := os.Symlink(root, util.DataDir); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	p := filepath.Join(util.DataDir, "assets", "tracked.txt")
	writeSyncPathTestFile(t, p)
	if !PathsAffectSync(p) {
		t.Fatal("linked data root lost a tracked change")
	}
}

func TestSyncIgnoreCache(t *testing.T) {
	oldData, oldWorking := util.DataDir, util.WorkingDir
	util.DataDir, util.WorkingDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.DataDir, util.WorkingDir = oldData, oldWorking })
	rule := filepath.Join(util.DataDir, syncIgnoreRulePath)
	writeSyncPathTestFile(t, rule)
	if err := os.WriteFile(rule, []byte("/one.txt"), 0644); err != nil {
		t.Fatal(err)
	}
	lines, first := mustSyncIgnoreRules(t)
	lines[0] = "/wrong.txt"
	_, second := mustSyncIgnoreRules(t)
	if first != second || !second.MatchesPath("/one.txt") {
		t.Fatal("unchanged rules were not reused")
	}
	info, err := os.Stat(rule)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(rule, []byte("/two.txt"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(rule, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	invalidateSyncIgnoreRules(rule)
	_, third := mustSyncIgnoreRules(t)
	if third == second || !third.MatchesPath("/two.txt") || third.MatchesPath("/one.txt") {
		t.Fatal("explicit invalidation did not reload same-size rules")
	}
	if err = os.WriteFile(rule, []byte("/external.txt"), 0644); err != nil {
		t.Fatal(err)
	}
	_, fourth := mustSyncIgnoreRules(t)
	if !fourth.MatchesPath("/external.txt") {
		t.Fatal("external change was not detected")
	}
	avName := "20260913123456-abcdefg.json"
	avPath := filepath.Join(util.WorkingDir, "guide", "20210808180117-6v0mkxr", "storage", "av", avName)
	writeSyncPathTestFile(t, avPath)
	_, fifth := mustSyncIgnoreRules(t)
	if !fifth.MatchesPath("/storage/av/" + avName) {
		t.Fatal("guide directory change was not detected")
	}
	if err = os.Remove(avPath); err != nil {
		t.Fatal(err)
	}
	_, sixth := mustSyncIgnoreRules(t)
	if sixth.MatchesPath("/storage/av/" + avName) {
		t.Fatal("removed guide file remains ignored")
	}
}

func BenchmarkSyncIgnoreRules(b *testing.B) {
	oldData, oldWorking := util.DataDir, util.WorkingDir
	util.DataDir, util.WorkingDir = b.TempDir(), b.TempDir()
	b.Cleanup(func() { util.DataDir, util.WorkingDir = oldData, oldWorking })
	getSyncIgnoreRules()
	getSyncIgnoreRules()
	b.Run("cached", func(b *testing.B) {
		for b.Loop() {
			getSyncIgnoreRules()
		}
	})
	b.Run("uncached", func(b *testing.B) {
		for b.Loop() {
			lines, err := loadSyncIgnoreLines()
			if err != nil {
				b.Fatal(err)
			}
			ignore.CompileIgnoreLines(lines...)
		}
	})
}

func TestSyncIgnoreRepoCompatibility(t *testing.T) {
	oldConf := Conf
	Conf = &AppConf{Lang: "en"}
	t.Cleanup(func() { Conf = oldConf })
	oldData := util.DataDir
	base := t.TempDir()
	util.DataDir = filepath.Join(base, "data")
	t.Cleanup(func() { util.DataDir = oldData })
	paths := []string{
		".siyuan/searchignore", ".siyuan/embeddingignore", ".siyuan/indexignore", ".siyuan/refsearchignore",
		".siyuan/data-crypto-backup.json", ".siyuan/conf.json", "box/.siyuan/conf.json",
		".hidden/file", "box/.hidden/file", "assets/file.tmp", "assets/tracked.txt",
		"storage/local.json", "storage/recent-doc.json", "storage/ref-used.json", "storage/view-state.json",
		"storage/view-state-corrupted-20260913000000.json", "nested/data/storage/local.json",
		"filesys_status_check/file", "nested/filesys_status_check/file", "20210808180117-6v0mkxr/file.sy",
	}
	for _, path := range paths {
		writeSyncPathTestFile(t, filepath.Join(util.DataDir, path))
		if err := os.WriteFile(filepath.Join(util.DataDir, path), []byte(path), 0644); err != nil {
			t.Fatal(err)
		}
	}
	key := []byte("0123456789abcdef0123456789abcdef")
	lines := mustSyncIgnoreLines(t)
	legacy, err := dejavu.NewRepo(util.DataDir, filepath.Join(base, "repo"), filepath.Join(base, "history"), filepath.Join(base, "temp"), "device", "device", "windows", key, lines, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := legacy.Index("legacy", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	previous, err := legacy.GetFiles(before)
	if err != nil {
		t.Fatal(err)
	}
	repo, err := dejavu.NewRepoWithOptions(dejavu.Options{
		DataPath: util.DataDir, RepoPath: filepath.Join(base, "repo"), HistoryPath: filepath.Join(base, "history"), TempPath: filepath.Join(base, "temp"),
		DeviceID: "device", DeviceName: "device", DeviceOS: "windows", AESKey: key,
		IgnoreLines: lines, IgnoreRulePath: syncIgnoreRulePath, HiddenDirectoryNames: []string{".siyuan"},
		PathFilter: func(info os.FileInfo, absPath string) (bool, error) {
			return syncPathFilter(util.DataDir, info, absPath)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	after, err := repo.Index("options", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	current, err := repo.GetFiles(after)
	if err != nil {
		t.Fatal(err)
	}
	var oldPaths, newPaths []string
	tracked := map[string]bool{}
	for _, file := range previous {
		oldPaths = append(oldPaths, file.Path)
	}
	for _, file := range current {
		newPaths = append(newPaths, file.Path)
		tracked[file.Path] = true
	}
	sort.Strings(oldPaths)
	sort.Strings(newPaths)
	if !reflect.DeepEqual(oldPaths, newPaths) {
		t.Fatalf("index changed: %v -> %v", oldPaths, newPaths)
	}
	for _, path := range paths {
		if got := PathsAffectSync(filepath.Join(util.DataDir, path)); got != tracked["/"+path] {
			t.Fatalf("scheduling differs from index: %s", path)
		}
	}
	if _, _, err = repo.Checkout(before.ID, nil); err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, readErr := os.ReadFile(filepath.Join(util.DataDir, path))
		if readErr != nil || string(data) != path {
			t.Fatalf("checkout changed %s: %q %v", path, data, readErr)
		}
	}
}
