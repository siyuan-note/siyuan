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
	"time"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"

	"github.com/spf13/cobra"
)

var repoCmd = &cobra.Command{
	Use:   "repo",
	Short: "Data snapshots",
}

var repoListCmd = &cobra.Command{
	Use:   "list",
	Short: "List snapshots",
	RunE: func(cmd *cobra.Command, args []string) error {
		tag, _ := cmd.Flags().GetBool("tag")
		page, _ := cmd.Flags().GetInt("page")
		if page < 1 {
			page = 1
		}

		if tag {
			snapshots, err := model.GetTagSnapshots()
			if err != nil {
				return err
			}
			switch outputFormat {
			case "json":
				data, _ := json.MarshalIndent(snapshots, "", "  ")
				fmt.Println(string(data))
			default:
				printSnapshotTable(snapshots)
			}
		} else {
			snapshots, pageCount, totalCount, err := model.GetRepoSnapshots(page)
			if err != nil {
				return err
			}
			switch outputFormat {
			case "json":
				result := map[string]any{
					"snapshots":  snapshots,
					"pageCount":  pageCount,
					"totalCount": totalCount,
				}
				data, _ := json.MarshalIndent(result, "", "  ")
				fmt.Println(string(data))
			default:
				printSnapshotTable(snapshots)
				fmt.Printf("\nPage %d/%d, %d total\n", page, pageCount, totalCount)
			}
		}
		return nil
	},
}

var repoCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a snapshot",
	RunE: func(cmd *cobra.Command, args []string) error {
		memo, _ := cmd.Flags().GetString("memo")
		if err := model.IndexRepo(memo); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var repoTagCmd = &cobra.Command{
	Use:   "tag --id <id> --name <name>",
	Short: "Tag a snapshot",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		name, _ := cmd.Flags().GetString("name")
		if id == "" || name == "" {
			return fmt.Errorf("--id and --name are required")
		}
		if err := model.TagSnapshot(id, name); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var repoUntagCmd = &cobra.Command{
	Use:   "untag --name <name>",
	Short: "Remove a tag",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		if name == "" {
			return fmt.Errorf("--name is required")
		}
		if err := model.RemoveTagSnapshot(name); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var repoCheckoutCmd = &cobra.Command{
	Use:   "checkout --id <id>",
	Short: "Checkout (rollback to) a snapshot",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		model.CheckoutRepoDirect(id)
		model.AppendPushReloadFiletreeEntry()
		model.AppendPushReloadUIEntry()
		fmt.Println("ok")
		return nil
	},
}

var repoDiffCmd = &cobra.Command{
	Use:   "diff --left <id> --right <id>",
	Short: "Diff two snapshots",
	RunE: func(cmd *cobra.Command, args []string) error {
		left, _ := cmd.Flags().GetString("left")
		right, _ := cmd.Flags().GetString("right")
		if left == "" || right == "" {
			return fmt.Errorf("--left and --right are required")
		}
		diff, err := model.DiffRepoSnapshots(left, right)
		if err != nil {
			return err
		}
		data, _ := json.MarshalIndent(diff, "", "  ")
		fmt.Println(string(data))
		return nil
	},
}

var repoSearchCmd = &cobra.Command{
	Use:   "search <keyword>",
	Short: "Search files in snapshots",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		keyword := args[0]
		page, _ := cmd.Flags().GetInt("page")
		if page < 1 {
			page = 1
		}

		files, pageCount, totalCount, err := model.SearchRepoFile(keyword, page)
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			result := map[string]any{
				"files":      files,
				"pageCount":  pageCount,
				"totalCount": totalCount,
			}
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
		default:
			printDiffFileTable(files)
			fmt.Printf("\nPage %d/%d, %d total\n", page, pageCount, totalCount)
		}
		return nil
	},
}

var repoPurgeCmd = &cobra.Command{
	Use:   "purge",
	Short: "Purge old snapshots",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := model.PurgeRepo(); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var repoFileCmd = &cobra.Command{
	Use:   "file",
	Short: "File-level snapshot operations",
}

var repoFileGetCmd = &cobra.Command{
	Use:   "get --id <fileID>",
	Short: "Get file content from snapshot",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		data, path, err := model.GetRepoFile(id)
		if err != nil {
			return err
		}
		output, _ := cmd.Flags().GetString("output")
		if output != "" {
			return os.WriteFile(output, data, 0644)
		}
		fmt.Printf("Path: %s\nSize: %d\n---\n%s", path, len(data), string(data))
		return nil
	},
}

var repoFileRollbackCmd = &cobra.Command{
	Use:   "rollback --id <fileID>",
	Short: "Rollback a single file from snapshot",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		if err := model.RollbackRepoSnapshotFile(id); err != nil {
			return err
		}
		if bt := treenode.GetBlockTree(id); bt != nil {
			model.AppendPushReloadProtyleEntry(bt.RootID)
		}
		fmt.Println("ok")
		return nil
	},
}

var repoFileOpenCmd = &cobra.Command{
	Use:   "open --id <fileID>",
	Short: "Preview file content from snapshot",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		title, content, _, _, err := model.OpenRepoSnapshotFile(id)
		if err != nil {
			return err
		}
		fmt.Printf("Title: %s\n---\n%s\n", title, content)
		return nil
	},
}

var repoFileExportCmd = &cobra.Command{
	Use:   "export --id <fileID>",
	Short: "Export file from snapshot to temp file",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		exportPath, err := model.ExportRepoFile(id)
		if err != nil {
			return err
		}
		fmt.Println(exportPath)
		return nil
	},
}

func printSnapshotTable(snapshots []*model.Snapshot) {
	if len(snapshots) == 0 {
		fmt.Println("No snapshots found.")
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tCREATED\tMEMO")
	for _, s := range snapshots {
		fmt.Fprintf(w, "%s\t%s\t%s\n", s.ID, time.UnixMilli(s.Created).Format("2006-01-02 15:04"), s.Memo)
	}
	w.Flush()
}

func printDiffFileTable(files []*model.DiffFile) {
	if len(files) == 0 {
		fmt.Println("No files found.")
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "FILE\tTITLE\tPATH\tHSIZE\tUPDATED")
	for _, f := range files {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%d\n", f.FileID, f.Title, f.Path, f.HSize, f.Updated)
	}
	w.Flush()
}

func init() {
	repoListCmd.Flags().Bool("tag", false, "list tagged snapshots only")
	repoListCmd.Flags().IntP("page", "p", 1, "page number")

	repoCreateCmd.Flags().String("memo", "", "snapshot memo")

	repoTagCmd.Flags().String("id", "", "snapshot ID")
	repoTagCmd.Flags().String("name", "", "tag name")

	repoUntagCmd.Flags().String("name", "", "tag name to remove")

	repoCheckoutCmd.Flags().String("id", "", "snapshot ID to rollback to")

	repoDiffCmd.Flags().String("left", "", "left snapshot ID")
	repoDiffCmd.Flags().String("right", "", "right snapshot ID")

	repoSearchCmd.Flags().IntP("page", "p", 1, "page number")

	repoFileGetCmd.Flags().String("id", "", "file ID (content hash)")
	repoFileGetCmd.Flags().String("output", "", "output file path (default: stdout)")

	repoFileRollbackCmd.Flags().String("id", "", "file ID to rollback")

	repoFileOpenCmd.Flags().String("id", "", "file ID to preview")

	repoFileExportCmd.Flags().String("id", "", "file ID to export")

	rootCmd.AddCommand(repoCmd)
	repoCmd.AddCommand(repoListCmd)
	repoCmd.AddCommand(repoCreateCmd)
	repoCmd.AddCommand(repoTagCmd)
	repoCmd.AddCommand(repoUntagCmd)
	repoCmd.AddCommand(repoCheckoutCmd)
	repoCmd.AddCommand(repoDiffCmd)
	repoCmd.AddCommand(repoSearchCmd)
	repoCmd.AddCommand(repoPurgeCmd)
	repoCmd.AddCommand(repoFileCmd)
	repoFileCmd.AddCommand(repoFileGetCmd)
	repoFileCmd.AddCommand(repoFileRollbackCmd)
	repoFileCmd.AddCommand(repoFileOpenCmd)
	repoFileCmd.AddCommand(repoFileExportCmd)
}
