// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"

	"github.com/spf13/cobra"
)

var syncCmd = &cobra.Command{
	Use:   "sync",
	Short: "Sync data with cloud",
	RunE: func(cmd *cobra.Command, args []string) error {
		if model.Conf.Sync.Load().Mode == 3 {
			return fmt.Errorf("full-manual mode requires 'push' or 'pull' subcommand")
		}

		if dryRun {
			fmt.Println("[dry-run] Would sync data with cloud")
			return nil
		}

		if err := model.SyncData(true); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var syncPushCmd = &cobra.Command{
	Use:   "push",
	Short: "Upload to cloud",
	RunE: func(cmd *cobra.Command, args []string) error {
		if dryRun {
			fmt.Println("[dry-run] Would upload to cloud")
			return nil
		}

		if err := model.SyncDataUpload(); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var syncPullCmd = &cobra.Command{
	Use:   "pull",
	Short: "Download from cloud",
	RunE: func(cmd *cobra.Command, args []string) error {
		if dryRun {
			fmt.Println("[dry-run] Would download from cloud")
			return nil
		}

		if err := model.SyncDataDownload(); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var syncStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show sync status",
	RunE: func(cmd *cobra.Command, args []string) error {
		s := model.Conf.Sync.Load()
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(map[string]any{
				"enabled":    s.Enabled,
				"mode":       s.Mode,
				"provider":   s.Provider,
				"stat":       s.Stat,
				"synced":     s.Synced,
				"cloudName":  s.CloudName,
				"perception": s.Perception,
				"interval":   s.Interval,
			}, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("Enabled:   %v\n", s.Enabled)
			fmt.Printf("Mode:      %s\n", syncModeName(s.Mode))
			if s.Synced > 0 {
				fmt.Printf("Synced:    %s\n", time.UnixMilli(s.Synced).Format("2006-01-02 15:04:05"))
			}
			if s.Stat != "" {
				fmt.Printf("Stat:      %s\n", s.Stat)
			}
			fmt.Printf("Provider:  %s\n", conf.ProviderToStr(s.Provider))
			fmt.Printf("Cloud:     %s\n", s.CloudName)
			fmt.Printf("Perception: %v\n", s.Perception)
			fmt.Printf("Interval:   %ds\n", s.Interval)
		}
		return nil
	},
}

func syncModeName(mode int) string {
	switch mode {
	case 0, 1:
		return "auto"
	case 2:
		return "manual"
	case 3:
		return "full-manual"
	default:
		return fmt.Sprintf("unknown(%d)", mode)
	}
}

func init() {
	rootCmd.AddCommand(syncCmd)
	syncCmd.AddCommand(syncPushCmd)
	syncCmd.AddCommand(syncPullCmd)
	syncCmd.AddCommand(syncStatusCmd)
}
