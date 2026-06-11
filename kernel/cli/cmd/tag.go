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
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/model"

	"github.com/spf13/cobra"
)

var tagCmd = &cobra.Command{
	Use:   "tag",
	Short: "Manage tags",
}

var tagListCmd = &cobra.Command{
	Use:   "list",
	Short: "List tags",
	RunE: func(cmd *cobra.Command, args []string) error {
		keyword, _ := cmd.Flags().GetString("keyword")
		tags := model.SearchTags(keyword)

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(tags, "", "  ")
			fmt.Println(string(data))
		default:
			printTagTable(tags)
		}
		return nil
	},
}

var tagRemoveCmd = &cobra.Command{
	Use:   "remove --label <label>",
	Short: "Remove a tag",
	RunE: func(cmd *cobra.Command, args []string) error {
		label, _ := cmd.Flags().GetString("label")
		if label == "" {
			return fmt.Errorf("--label is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would remove tag \"%s\"\n", label)
			return nil
		}

		if err := model.RemoveTag(label); err != nil {
			return err
		}
		model.AppendPushReloadTagEntry()
		return nil
	},
}

var tagRenameCmd = &cobra.Command{
	Use:   "rename --old <old-label> --new <new-label>",
	Short: "Rename a tag",
	RunE: func(cmd *cobra.Command, args []string) error {
		oldLabel, _ := cmd.Flags().GetString("old")
		newLabel, _ := cmd.Flags().GetString("new")
		if oldLabel == "" {
			return fmt.Errorf("--old is required")
		}
		if newLabel == "" {
			return fmt.Errorf("--new is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would rename tag \"%s\" to \"%s\"\n", oldLabel, newLabel)
			return nil
		}

		if err := model.RenameTag(oldLabel, newLabel); err != nil {
			return err
		}
		model.AppendPushReloadTagEntry()
		return nil
	},
}

func printTagTable(tags []string) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "LABEL")
	for _, t := range tags {
		fmt.Fprintln(w, t)
	}
	w.Flush()
}

func init() {
	tagListCmd.Flags().String("keyword", "", "search keyword (empty = all)")
	tagRemoveCmd.Flags().String("label", "", "tag label to remove")
	tagRenameCmd.Flags().String("old", "", "current tag label")
	tagRenameCmd.Flags().String("new", "", "new tag label")

	rootCmd.AddCommand(tagCmd)
	tagCmd.AddCommand(tagListCmd)
	tagCmd.AddCommand(tagRemoveCmd)
	tagCmd.AddCommand(tagRenameCmd)
}
