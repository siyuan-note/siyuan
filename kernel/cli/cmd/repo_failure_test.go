package cmd

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/spf13/cobra"
)

func TestRepoAndSyncCommandsReportUnavailableOperations(t *testing.T) {
	previousConf, previousDryRun := model.Conf, dryRun
	model.Conf = &model.AppConf{Lang: "en", Repo: conf.NewRepo(), Sync: conf.NewSync()}
	model.Conf.Sync.Enabled = false
	dryRun = false
	t.Cleanup(func() { model.Conf, dryRun = previousConf, previousDryRun })
	for _, command := range []*cobra.Command{repoCheckoutCmd, syncPushCmd, syncPullCmd} {
		t.Run(command.Name(), func(t *testing.T) {
			input := &cobra.Command{}
			input.Flags().String("id", "missing", "")
			if err := command.RunE(input, nil); err == nil {
				t.Fatal("unavailable operation reported success")
			}
		})
	}
}
