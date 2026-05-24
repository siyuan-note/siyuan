// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
		if model.Conf.Sync.Mode == 3 {
			return fmt.Errorf("full-manual mode requires 'push' or 'pull' subcommand")
		}
		model.SyncData(true)
		fmt.Println("ok")
		return nil
	},
}

var syncPushCmd = &cobra.Command{
	Use:   "push",
	Short: "Upload to cloud",
	RunE: func(cmd *cobra.Command, args []string) error {
		model.SyncDataUpload()
		fmt.Println("ok")
		return nil
	},
}

var syncPullCmd = &cobra.Command{
	Use:   "pull",
	Short: "Download from cloud",
	RunE: func(cmd *cobra.Command, args []string) error {
		model.SyncDataDownload()
		fmt.Println("ok")
		return nil
	},
}

var syncStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show sync status",
	RunE: func(cmd *cobra.Command, args []string) error {
		s := model.Conf.Sync
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
