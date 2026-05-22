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
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var workspaceCmd = &cobra.Command{
	Use:   "workspace",
	Short: "Manage SiYuan workspaces",
}

var workspaceListCmd = &cobra.Command{
	Use:   "list",
	Short: "List registered workspaces",
	RunE: func(cmd *cobra.Command, args []string) error {
		paths, err := util.ReadWorkspacePaths()
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			var items []map[string]any
			for _, p := range paths {
				items = append(items, map[string]any{
					"path":   p,
					"closed": !util.IsWorkspaceLocked(p),
					"name":   filepath.Base(p),
				})
			}
			data, _ := json.MarshalIndent(items, "", "  ")
			fmt.Println(string(data))
		default:
			for _, p := range paths {
				status := "open"
				if !util.IsWorkspaceLocked(p) {
					status = "locked"
				}
				fmt.Printf("%-4s  %s\n", status, p)
			}
		}
		return nil
	},
}

var workspaceInfoCmd = &cobra.Command{
	Use:   "info",
	Short: "Show current workspace info",
	RunE: func(cmd *cobra.Command, args []string) error {
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(map[string]any{
				"path":    util.WorkspaceDir,
				"version": util.Ver,
				"valid":   util.IsWorkspaceDir(util.WorkspaceDir),
			}, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("Path:       %s\n", util.WorkspaceDir)
			fmt.Printf("Version:    %s\n", util.Ver)
			fmt.Printf("IsValid:    %v\n", util.IsWorkspaceDir(util.WorkspaceDir))
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(workspaceCmd)
	workspaceCmd.AddCommand(workspaceListCmd)
	workspaceCmd.AddCommand(workspaceInfoCmd)
}
