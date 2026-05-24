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
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/model"

	"github.com/spf13/cobra"
)

var assetCmd = &cobra.Command{
	Use:   "asset",
	Short: "Manage assets",
}

var assetUploadCmd = &cobra.Command{
	Use:   "upload --id <id> --file <path>",
	Short: "Upload files to workspace assets",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		files, _ := cmd.Flags().GetStringArray("file")
		if len(files) == 0 {
			return fmt.Errorf("--file is required")
		}

		for i, f := range files {
			abs, err := filepath.Abs(f)
			if err != nil {
				return err
			}
			files[i] = abs
		}

		succMap, err := model.InsertLocalAssets(id, files, true)
		if err != nil {
			return err
		}

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(succMap, "", "  ")
			fmt.Println(string(data))
		default:
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "FILE\tASSET_PATH")
			for k, v := range succMap {
				fmt.Fprintf(w, "%s\t%v\n", k, v)
			}
			w.Flush()
		}
		return nil
	},
}

var assetUnusedCmd = &cobra.Command{
	Use:   "unused",
	Short: "List unused assets",
	RunE: func(cmd *cobra.Command, args []string) error {
		items := model.UnusedAssets(true)
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(items, "", "  ")
			fmt.Println(string(data))
		default:
			if len(items) == 0 {
				fmt.Println("No unused assets found.")
				return nil
			}
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "PATH\tNAME")
			for _, item := range items {
				fmt.Fprintf(w, "%s\t%s\n", item.Item, item.Name)
			}
			w.Flush()
			fmt.Printf("\n%d unused asset(s)\n", len(items))
		}
		return nil
	},
}

var assetCleanCmd = &cobra.Command{
	Use:   "clean",
	Short: "Clean unused assets",
	RunE: func(cmd *cobra.Command, args []string) error {
		singlePath, _ := cmd.Flags().GetString("path")
		if singlePath != "" {
			ret := model.RemoveUnusedAsset(singlePath)
			fmt.Println(ret)
			return nil
		}

		removed := model.RemoveUnusedAssets()
		if len(removed) == 0 {
			fmt.Println("No unused assets to clean.")
			return nil
		}
		for _, p := range removed {
			fmt.Println(p)
		}
		fmt.Printf("\n%d asset(s) removed\n", len(removed))
		return nil
	},
}

func init() {
	assetUploadCmd.Flags().String("id", "", "target document block ID")
	assetUploadCmd.Flags().StringArray("file", nil, "local file path (repeatable)")

	assetCleanCmd.Flags().String("path", "", "single unused asset path to remove")

	rootCmd.AddCommand(assetCmd)
	assetCmd.AddCommand(assetUploadCmd)
	assetCmd.AddCommand(assetUnusedCmd)
	assetCmd.AddCommand(assetCleanCmd)
}
