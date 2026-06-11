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
	"os"
	"path/filepath"
	"strings"

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
			seen := map[string]bool{}
			for _, p := range paths {
				key := strings.ToLower(p)
				if seen[key] {
					continue
				}
				seen[key] = true
				items = append(items, map[string]any{
					"path": p,
					"name": filepath.Base(p),
				})
			}
			data, _ := json.MarshalIndent(items, "", "  ")
			fmt.Println(string(data))
		default:
			seen := map[string]bool{}
			for _, p := range paths {
				key := strings.ToLower(p)
				if seen[key] {
					continue
				}
				seen[key] = true
				fmt.Println(p)
			}
		}
		return nil
	},
}

var workspaceInfoCmd = &cobra.Command{
	Use:   "info",
	Short: "Show current workspace info",
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := workspacePath
		if dir == "" {
			dir = resolveDefaultWorkspace()
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(map[string]any{
				"path":    dir,
				"version": util.Ver,
				"valid":   util.IsWorkspaceDir(dir),
			}, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("Path:       %s\n", dir)
			fmt.Printf("Version:    %s\n", util.Ver)
			fmt.Printf("IsValid:    %v\n", util.IsWorkspaceDir(dir))
		}
		return nil
	},
}

func resolveDefaultWorkspace() string {
	if p := os.Getenv("SIYUAN_WORKSPACE_PATH"); p != "" {
		return p
	}
	paths, _ := util.ReadWorkspacePaths()
	if len(paths) > 0 {
		return paths[len(paths)-1]
	}
	return filepath.Join(util.HomeDir, "SiYuan")
}

func init() {
	rootCmd.AddCommand(workspaceCmd)
	workspaceCmd.AddCommand(workspaceListCmd)
	workspaceCmd.AddCommand(workspaceInfoCmd)
}
