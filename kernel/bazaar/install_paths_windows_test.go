package bazaar

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func makeInstallJunction(t *testing.T, link, target string) {
	t.Helper()
	if output, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Fatalf("create junction: %v: %s", err, output)
	}
}

func TestInstallPathsAllowWorkspaceJunctions(t *testing.T) {
	for _, workspaceIsJunction := range []bool{false, true} {
		t.Run(map[bool]string{false: "ancestor", true: "workspace"}[workspaceIsJunction], func(t *testing.T) {
			oldWorkspace, oldConf, oldData := util.WorkspaceDir, util.ConfDir, util.DataDir
			t.Cleanup(func() { util.WorkspaceDir, util.ConfDir, util.DataDir = oldWorkspace, oldConf, oldData })
			root := t.TempDir()
			realRoot, alias := filepath.Join(root, "real"), filepath.Join(root, "alias")
			if err := os.Mkdir(realRoot, 0755); err != nil {
				t.Fatal(err)
			}
			makeInstallJunction(t, alias, realRoot)
			util.WorkspaceDir = alias
			if !workspaceIsJunction {
				util.WorkspaceDir = filepath.Join(alias, "workspace")
			}
			if err := os.MkdirAll(util.WorkspaceDir, 0755); err != nil {
				t.Fatal(err)
			}
			util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
			util.DataDir = filepath.Join(util.WorkspaceDir, "data")
			if err := makePrivateInstallDir(installPrivateRoot()); err != nil {
				t.Fatalf("private operation under workspace junction: %v", err)
			}
			source := filepath.Join(realRoot, "source")
			if err := os.Mkdir(source, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source, "index.js"), []byte("new"), 0644); err != nil {
				t.Fatal(err)
			}
			for _, kind := range []string{"plugins", "themes", "icons", "templates", "widgets"} {
				target := filepath.Join(util.DataDir, kind, "sample")
				if err := replacePackageDirectory(source, target, false); err != nil {
					t.Fatalf("install %s: %v", kind, err)
				}
				if revision, err := InstalledPackageRevision(target); err != nil || !validInstallHash(revision) {
					t.Fatalf("read %s revision: %s, %v", kind, revision, err)
				}
				if err := replacePackageDirectory(source, target, true); err != nil {
					t.Fatalf("update %s: %v", kind, err)
				}
			}
		})
	}
}

func TestInstallPathsRejectJunctionsInsideWorkspace(t *testing.T) {
	oldWorkspace := util.WorkspaceDir
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	util.WorkspaceDir = t.TempDir()
	outside := t.TempDir()
	for _, relative := range []string{"data/plugins", "conf/plugin-development", "data/themes/sample"} {
		link := filepath.Join(util.WorkspaceDir, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(link), 0755); err != nil {
			t.Fatal(err)
		}
		makeInstallJunction(t, link, outside)
		for _, target := range []string{link, filepath.Join(link, "missing")} {
			if err := rejectInstallPathLinks(target); err == nil {
				t.Fatalf("accepted internal junction: %s", target)
			}
		}
	}
}
