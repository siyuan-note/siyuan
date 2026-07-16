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
	"path"
	"strings"
	"text/tabwriter"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"

	"github.com/spf13/cobra"
)

var documentCmd = &cobra.Command{
	Use:   "document",
	Short: "Manage documents",
}

var documentListCmd = &cobra.Command{
	Use:   "list --notebook <id>",
	Short: "List documents in a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		notebook, _ := cmd.Flags().GetString("notebook")
		docPath, _ := cmd.Flags().GetString("path")
		hpath, _ := cmd.Flags().GetString("hpath")
		if notebook == "" {
			return fmt.Errorf("--notebook is required")
		}
		files, _, err := model.ListDocTree(notebook, resolvePath(notebook, docPath, hpath), 0, false, false, 128)
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(files, "", "  ")
			fmt.Println(string(data))
		default:
			printDocumentTable(files)
		}
		return nil
	},
}

var documentCreateCmd = &cobra.Command{
	Use:   "create --notebook <id> --title <title>",
	Short: "Create a document",
	RunE: func(cmd *cobra.Command, args []string) error {
		notebook, _ := cmd.Flags().GetString("notebook")
		title, _ := cmd.Flags().GetString("title")
		dir, _ := cmd.Flags().GetString("path")
		markdown, _ := cmd.Flags().GetString("markdown")
		if notebook == "" {
			return fmt.Errorf("--notebook is required")
		}
		if title == "" {
			return fmt.Errorf("--title is required")
		}
		if dir == "" {
			dir = "/"
		}

		if dryRun {
			fmt.Printf("[dry-run] Would create document \"%s\" in notebook %s\n", title, notebook)
			return nil
		}

		id := ast.NewNodeID()
		docPath := path.Join(dir, id+".sy")
		_, err := model.CreateDocByMd(notebook, docPath, title, markdown, nil, nil)
		if err != nil {
			return err
		}
		model.AppendPushCreateEntry(notebook, docPath)
		fmt.Println(id)
		return nil
	},
}

var documentGetCmd = &cobra.Command{
	Use:   "get --id <id>",
	Short: "Get document info",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		bt := treenode.GetBlockTree(id)
		if bt == nil {
			return fmt.Errorf("document not found: %s", id)
		}

		tree, err := model.LoadTreeByBlockID(id)
		if err != nil {
			return err
		}
		block, err := model.GetBlock(id, tree)
		if err != nil {
			return err
		}

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(block, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("ID:       %s\n", block.ID)
			fmt.Printf("Title:    %s\n", block.Name)
			fmt.Printf("Type:     %s\n", block.Type)
			fmt.Printf("Box:      %s\n", block.Box)
			fmt.Printf("HPath:    %s\n", block.HPath)
			fmt.Printf("Created:  %s\n", block.Created)
			fmt.Printf("Updated:  %s\n", block.Updated)
			if block.Content != "" {
				preview := block.Content
				if len(preview) > 200 {
					preview = preview[:200] + "..."
				}
				fmt.Printf("Content:  %s\n", preview)
			}
		}
		return nil
	},
}

var documentRemoveCmd = &cobra.Command{
	Use:   "remove --id <id>",
	Short: "Remove a document",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would remove document %s\n", id)
			return nil
		}

		tree, err := model.LoadTreeByBlockID(id)
		if err != nil {
			return err
		}
		if err = model.RemoveDoc(tree.Box, tree.Path); err != nil {
			return err
		}
		model.AppendPushRemoveEntry(tree.Box, tree.Path, id)
		parentPath := path.Dir(tree.Path) + ".sy"
		if parentPath != "/.sy" {
			model.AppendPushReloadDocInfoEntry(tree.Box, parentPath)
		}
		fmt.Println(id)
		return nil
	},
}

var documentRenameCmd = &cobra.Command{
	Use:   "rename --id <id> --title <title>",
	Short: "Rename a document",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		title, _ := cmd.Flags().GetString("title")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		if title == "" {
			return fmt.Errorf("--title is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would rename document %s to \"%s\"\n", id, title)
			return nil
		}

		tree, err := model.LoadTreeByBlockID(id)
		if err != nil {
			return err
		}
		if err := model.RenameDoc(tree.Box, tree.Path, title); err != nil {
			return err
		}
		model.AppendPushRenameEntry(tree.Box, tree.Path, title)
		fmt.Println(id)
		return nil
	},
}

var documentMoveCmd = &cobra.Command{
	Use:   "move --id <id> --notebook <id>",
	Short: "Move a document to another notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		toNotebook, _ := cmd.Flags().GetString("notebook")
		toPath, _ := cmd.Flags().GetString("path")
		hpath, _ := cmd.Flags().GetString("hpath")
		if id == "" || toNotebook == "" {
			return fmt.Errorf("--id and --notebook are required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would move document %s to notebook %s\n", id, toNotebook)
			return nil
		}

		tree, err := model.LoadTreeByBlockID(id)
		if err != nil {
			return err
		}
		if err := model.MoveDocs([]string{tree.Path}, toNotebook, resolvePath(toNotebook, toPath, hpath), nil); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println(id)
		return nil
	},
}

var documentDuplicateCmd = &cobra.Command{
	Use:   "duplicate --id <id>",
	Short: "Duplicate a document",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would duplicate document %s\n", id)
			return nil
		}

		tree, err := model.LoadTreeByBlockID(id)
		if err != nil {
			return err
		}
		model.DuplicateDoc(tree)
		model.AppendPushReloadFiletreeEntry()
		fmt.Println(tree.ID)
		return nil
	},
}

var documentInfoCmd = &cobra.Command{
	Use:   "info --id <id>",
	Short: "Get document info",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		info, err := model.GetDocInfo(id)
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(info, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("ID:           %s\n", info.ID)
			fmt.Printf("RootID:       %s\n", info.RootID)
			fmt.Printf("Name:         %s\n", info.Name)
			fmt.Printf("RefCount:     %d\n", info.RefCount)
			fmt.Printf("SubFileCount: %d\n", info.SubFileCount)
		}
		return nil
	},
}

func resolvePath(boxID, userPath, hpath string) string {
	if userPath != "" {
		return userPath
	}
	if hpath != "" {
		if bt := treenode.GetBlockTreeRootByHPath(boxID, hpath); bt != nil {
			return strings.TrimSuffix(bt.Path, ".sy") + "/"
		}
	}
	return "/"
}

var documentSearchCmd = &cobra.Command{
	Use:   "search <keyword>",
	Short: "Search documents by keyword",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		keyword := args[0]
		if keyword == "" {
			return fmt.Errorf("keyword is required")
		}
		docs := model.SearchDocs(keyword, false, nil)
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(docs, "", "  ")
			fmt.Println(string(data))
		default:
			if len(docs) == 0 {
				fmt.Println("No documents found.")
				return nil
			}
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "NAME\tID\tHPATH")
			for _, d := range docs {
				fmt.Fprintf(w, "%s\t%s\t%s\n", d["name"], d["id"], d["hPath"])
			}
			w.Flush()
			fmt.Printf("\n%d document(s)\n", len(docs))
		}
		return nil
	},
}

func printDocumentTable(files []*model.File) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tPATH\tSIZE\tCOUNT\tMTIME")
	for _, f := range files {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%d\t%s\n", f.ID, f.Name, f.Path, f.HSize, f.Count, f.HMtime)
	}
	w.Flush()
}

func init() {
	documentListCmd.Flags().String("notebook", "", "notebook ID")
	documentListCmd.Flags().String("path", "", "internal path (default /)")
	documentListCmd.Flags().String("hpath", "", "human-readable path, e.g. /归档/文章")

	documentCreateCmd.Flags().String("notebook", "", "notebook ID")
	documentCreateCmd.Flags().String("title", "", "document title")
	documentCreateCmd.Flags().String("path", "", "parent document path (default /)")
	documentCreateCmd.Flags().String("markdown", "", "initial markdown content")

	documentGetCmd.Flags().String("id", "", "document block ID")
	documentRemoveCmd.Flags().String("id", "", "document block ID")
	documentRenameCmd.Flags().String("id", "", "document block ID")
	documentRenameCmd.Flags().String("title", "", "new document title")

	documentMoveCmd.Flags().String("id", "", "document block ID to move")
	documentMoveCmd.Flags().String("notebook", "", "target notebook ID")
	documentMoveCmd.Flags().String("path", "", "target internal path (default /)")
	documentMoveCmd.Flags().String("hpath", "", "target human-readable path")

	documentDuplicateCmd.Flags().String("id", "", "document block ID to duplicate")
	documentInfoCmd.Flags().String("id", "", "document block ID")

	rootCmd.AddCommand(documentCmd)
	documentCmd.AddCommand(documentListCmd)
	documentCmd.AddCommand(documentCreateCmd)
	documentCmd.AddCommand(documentGetCmd)
	documentCmd.AddCommand(documentRemoveCmd)
	documentCmd.AddCommand(documentRenameCmd)
	documentCmd.AddCommand(documentMoveCmd)
	documentCmd.AddCommand(documentDuplicateCmd)
	documentCmd.AddCommand(documentInfoCmd)
	documentCmd.AddCommand(documentSearchCmd)
}
