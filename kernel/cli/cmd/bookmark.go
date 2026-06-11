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

var bookmarkCmd = &cobra.Command{
	Use:   "bookmark",
	Short: "Manage bookmarks",
}

var bookmarkListCmd = &cobra.Command{
	Use:   "list",
	Short: "List bookmarks",
	RunE: func(cmd *cobra.Command, args []string) error {
		bookmarks := model.BuildBookmark()
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(bookmarks, "", "  ")
			fmt.Println(string(data))
		default:
			printBookmarkTable(bookmarks)
		}
		return nil
	},
}

var bookmarkLabelsCmd = &cobra.Command{
	Use:   "labels",
	Short: "List bookmark labels",
	RunE: func(cmd *cobra.Command, args []string) error {
		labels := model.BookmarkLabels()
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(labels, "", "  ")
			fmt.Println(string(data))
		default:
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "LABEL")
			for _, l := range labels {
				fmt.Fprintln(w, l)
			}
			w.Flush()
		}
		return nil
	},
}

var bookmarkRemoveCmd = &cobra.Command{
	Use:   "remove --label <label>",
	Short: "Remove a bookmark",
	RunE: func(cmd *cobra.Command, args []string) error {
		label, _ := cmd.Flags().GetString("label")
		if label == "" {
			return fmt.Errorf("--label is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would remove bookmark \"%s\"\n", label)
			return nil
		}

		if err := model.RemoveBookmark(label); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		return nil
	},
}

var bookmarkRenameCmd = &cobra.Command{
	Use:   "rename --old <old> --new <new>",
	Short: "Rename a bookmark",
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
			fmt.Printf("[dry-run] Would rename bookmark \"%s\" to \"%s\"\n", oldLabel, newLabel)
			return nil
		}

		if err := model.RenameBookmark(oldLabel, newLabel); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		return nil
	},
}

func printBookmarkTable(bookmarks *model.Bookmarks) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tCOUNT")
	for _, bm := range *bookmarks {
		fmt.Fprintf(w, "%s\t%d\n", bm.Name, bm.Count)
	}
	w.Flush()
}

func init() {
	bookmarkRemoveCmd.Flags().String("label", "", "bookmark label to remove")
	bookmarkRenameCmd.Flags().String("old", "", "current bookmark label")
	bookmarkRenameCmd.Flags().String("new", "", "new bookmark label")

	rootCmd.AddCommand(bookmarkCmd)
	bookmarkCmd.AddCommand(bookmarkListCmd)
	bookmarkCmd.AddCommand(bookmarkLabelsCmd)
	bookmarkCmd.AddCommand(bookmarkRemoveCmd)
	bookmarkCmd.AddCommand(bookmarkRenameCmd)
}
