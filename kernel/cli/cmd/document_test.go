package cmd

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestStructuredTitlesCLI(t *testing.T) {
	previousData, previousConf := util.DataDir, util.ConfDir
	root := t.TempDir()
	util.DataDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "conf")
	t.Cleanup(func() { util.DataDir, util.ConfDir = previousData, previousConf })
	const boxID = "20261023000000-cli0001"
	name := filepath.Join(util.DataDir, boxID, documentaddressing.ConfigPath)
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(`{"name":"Existing"}`), 0644); err != nil {
		t.Fatal(err)
	}
	for _, hpath := range []string{"/", "/Plain", "/A/B"} {
		if _, err := resolvePath(boxID, "", hpath); !errors.Is(err, documentaddressing.ErrLegacyPathUnsupported) {
			t.Fatalf("legacy read path %q accepted: %v", hpath, err)
		}
		if _, err := resolveDocumentMovePath(boxID, "", hpath, "A/B"); !errors.Is(err, documentaddressing.ErrLegacyPathUnsupported) {
			t.Fatalf("legacy move path %q accepted: %v", hpath, err)
		}
	}
	const idPath = "/20261023000001-documen.sy"
	if got, err := resolvePath(boxID, idPath, "/ignored"); err != nil || got != idPath {
		t.Fatal("explicit identity path changed", got, err)
	}
	if got, err := resolvePath(boxID, "", ""); err != nil || got != "/" {
		t.Fatal("default root changed", got, err)
	}
}
