package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

func TestDatabaseCommandsRejectIncompleteUnusedScan(t *testing.T) {
	previousConf, previousData, previousWorkspace, previousDryRun := model.Conf, util.DataDir, util.WorkspaceDir, dryRun
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() {
		model.Conf, util.DataDir, util.WorkspaceDir, dryRun = previousConf, previousData, previousWorkspace, previousDryRun
	})
	box := &model.Box{ID: "20260918000000-abcdefg"}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(util.DataDir, box.ID, "20260918000001-abcdefg.sy")
	if err := os.WriteFile(docPath, []byte(`{"Type":"NodeDocument","Spec":"99"}`), 0644); err != nil {
		t.Fatal(err)
	}
	const id = "20260913000000-unused1"
	avPath := filepath.Join(util.DataDir, "storage", "av", id+".json")
	if err := os.MkdirAll(filepath.Dir(avPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(avPath, []byte(`{"id":"`+id+`","spec":2,"name":"Protected"}`), 0644); err != nil {
		t.Fatal(err)
	}
	command := &cobra.Command{}
	command.Flags().String("av", "", "")
	if err := databaseUnusedCmd.RunE(command, nil); err == nil || !strings.Contains(err.Error(), filepath.Base(docPath)) {
		t.Fatalf("unused scan failure was hidden: %v", err)
	}
	for _, dry := range []bool{false, true} {
		dryRun = dry
		for _, avID := range []string{"", id} {
			_ = command.Flags().Set("av", avID)
			if err := databaseCleanCmd.RunE(command, nil); err == nil || !strings.Contains(err.Error(), filepath.Base(docPath)) {
				t.Fatalf("clean scan failure was hidden (dry=%v id=%q): %v", dry, avID, err)
			}
		}
	}
	if _, err := os.Stat(avPath); err != nil {
		t.Fatalf("rejected cleanup removed the database: %v", err)
	}
}
