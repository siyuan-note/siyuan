package util_test

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestJunctionWorkspaceUtilities(t *testing.T) {
	for _, atWorkspace := range []bool{false, true} {
		t.Run(map[bool]string{false: "ancestor", true: "workspace"}[atWorkspace], func(t *testing.T) {
			alias, physical := testutil.JunctionWorkspace(t, t.TempDir(), atWorkspace)
			previousData, previousHome := util.DataDir, util.HomeDir
			util.DataDir, util.HomeDir = filepath.Join(alias, "data"), t.TempDir()
			t.Cleanup(func() { util.DataDir, util.HomeDir = previousData, previousHome })
			write := func(name, content string) {
				t.Helper()
				if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(name, []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
			}
			skill := filepath.Join(util.SkillsDir(), "sample")
			const skillSource = "---\nname: sample\ndescription: test\n---\nbody"
			write(filepath.Join(skill, "SKILL.md"), skillSource)
			write(filepath.Join(skill, "refs", "note.txt"), "reference")
			loaded, err := util.LoadSkill("sample", nil)
			if err != nil || !reflect.DeepEqual(loaded.Resources, []string{"refs/note.txt"}) {
				t.Errorf("skill manifest below junction: %+v, %v", loaded, err)
			}
			loaded, err = util.LoadSkill("sample/refs/note.txt", nil)
			if err != nil || loaded.Content != "reference" {
				t.Errorf("skill resource below junction: %+v, %v", loaded, err)
			}
			outside := t.TempDir()
			write(filepath.Join(outside, "note.txt"), "must not be read or counted")
			testutil.Junction(t, filepath.Join(skill, "escape"), outside)
			if _, err := util.LoadSkill("sample/escape/note.txt", nil); err == nil {
				t.Error("skill resource escaped its real root")
			}
			write(filepath.Join(outside, "SKILL.md"), "---\nname: linked\n---\nlinked body")
			testutil.Junction(t, filepath.Join(util.SkillsDir(), "linked"), outside)
			if linked, err := util.LoadSkill("linked", nil); err != nil || linked.Content != "linked body" ||
				!reflect.DeepEqual(linked.Resources, []string{"note.txt"}) {
				t.Errorf("skill directory junction was not discovered: %+v, %v", linked, err)
			}
			if util.NormalizeAndResolve(alias) != util.NormalizeAndResolve(physical) {
				t.Error("workspace aliases have different canonical paths")
			}
			missing := filepath.Join("data", "new", "document.sy")
			if resolved := util.ResolveLongestExistingParent(filepath.Join(alias, missing)); !strings.EqualFold(resolved, filepath.Join(physical, missing)) {
				t.Errorf("nonexistent child below junction was not resolved: %q", resolved)
			}
			realStorage, err := util.GetWorkspaceStorage(context.Background(), physical)
			if err != nil {
				t.Fatal(err)
			}
			if want := int64(len(skillSource) + len("reference")); realStorage.TotalSize != want {
				t.Errorf("storage counted files outside the workspace: got %d, want %d", realStorage.TotalSize, want)
			}
			aliasStorage, err := util.GetWorkspaceStorage(context.Background(), alias)
			if err != nil || aliasStorage.TotalSize != realStorage.TotalSize ||
				!reflect.DeepEqual(aliasStorage.Directories, realStorage.Directories) {
				t.Errorf("storage below junction: %+v, %v; physical: %+v", aliasStorage, err, realStorage)
			}
			if atWorkspace && !util.IsSymlinkPath(alias) {
				t.Error("junction path was not identified as a link")
			}
			entries, err := os.ReadDir(skill)
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range entries {
				if entry.Name() == "escape" && (!util.IsSymlink(entry) || !util.IsDirRegularOrSymlink(entry)) {
					t.Error("junction directory entry was not identified as a directory link")
				}
				if entry.Name() == "refs" && (util.IsSymlink(entry) || !util.IsDirRegularOrSymlink(entry)) {
					t.Error("ordinary directory was misidentified")
				}
				if entry.Name() == "SKILL.md" && (util.IsSymlink(entry) || util.IsDirRegularOrSymlink(entry)) {
					t.Error("ordinary file was identified as a directory link")
				}
			}
			testutil.Junction(t, filepath.Join(util.DataDir, "assets"), outside)
			assets := util.GetDataAssetsAbsPath()
			assetInfo, err := os.Stat(assets)
			outsideInfo, outsideErr := os.Stat(outside)
			if err != nil || outsideErr != nil || !os.SameFile(assetInfo, outsideInfo) || assets == filepath.Join(util.DataDir, "assets") {
				t.Errorf("asset junction was not resolved: %q, %v", assets, err)
			}
		})
	}
}
