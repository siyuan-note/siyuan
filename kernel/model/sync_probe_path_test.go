package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncProbeDirectoryIsPathScoped(t *testing.T) {
	prepareAssetDownloadRepoTest(t)
	paths := map[string]bool{
		"filesys_status_check/status":                           false,
		".siyuan/filesys_status_check/status":                   false,
		"nested/filesys_status_check/file":                      true,
		"plugins/filesys_status_check/plugin.json":              true,
		"widgets/filesys_status_check/widget.json":              true,
		"themes/filesys_status_check/theme.css":                 true,
		"icons/filesys_status_check/icon.js":                    true,
		"templates/filesys_status_check/template.md":            true,
		"storage/ai/agent/skills/filesys_status_check/SKILL.md": true,
	}
	for p := range paths {
		writeSyncPathTestFile(t, filepath.Join(util.DataDir, p))
	}
	repo, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	index, err := repo.Index("probe paths", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	files, err := repo.GetFiles(index)
	if err != nil {
		t.Fatal(err)
	}
	tracked := map[string]bool{}
	for _, file := range files {
		tracked[file.Path] = true
	}
	for p, want := range paths {
		if tracked["/"+p] != want || PathsAffectSync(filepath.Join(util.DataDir, p)) != want {
			t.Errorf("index and scheduling must include %s: %v", p, want)
		}
	}
	if _, _, err := repo.Checkout(index.ID, nil); err != nil {
		t.Fatal(err)
	}
	for p := range paths {
		if _, err := os.Stat(filepath.Join(util.DataDir, p)); err != nil {
			t.Errorf("checkout lost %s: %v", p, err)
		}
	}
}
