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
	"io"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var blockCmd = &cobra.Command{
	Use:   "block",
	Short: "Block operations",
}

// ─── Read ──────────────────────────────────────────────────────────────────────

var blockGetCmd = &cobra.Command{
	Use:   "get --id <id>",
	Short: "Get block info",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		block, err := model.GetBlock(id, nil)
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(block, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("ID:       %s\n", block.ID)
			fmt.Printf("Type:     %s\n", block.Type)
			fmt.Printf("Name:     %s\n", block.Name)
			fmt.Printf("Box:      %s\n", block.Box)
			fmt.Printf("HPath:    %s\n", block.HPath)
			if block.Content != "" {
				fmt.Printf("Content:  %s\n", truncate(block.Content, 200))
			}
			if block.Markdown != "" {
				fmt.Printf("Markdown: %s\n", truncate(block.Markdown, 200))
			}
		}
		return nil
	},
}

var blockChildrenCmd = &cobra.Command{
	Use:   "children --id <id>",
	Short: "Get child blocks",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		children := model.GetChildBlocks(id)
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(children, "", "  ")
			fmt.Println(string(data))
		default:
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "ID\tTYPE\tCONTENT")
			for _, c := range children {
				fmt.Fprintf(w, "%s\t%s\t%s\n", c.ID, c.Type, truncate(c.Content, 80))
			}
			w.Flush()
		}
		return nil
	},
}

var blockBreadcrumbCmd = &cobra.Command{
	Use:   "breadcrumb --id <id>",
	Short: "Get block breadcrumb",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		paths, err := model.BuildBlockBreadcrumb(id, nil)
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(paths, "", "  ")
			fmt.Println(string(data))
		default:
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "ID\tNAME\tTYPE")
			for _, p := range paths {
				fmt.Fprintf(w, "%s\t%s\t%s\n", p.ID, p.Name, p.Type)
			}
			w.Flush()
		}
		return nil
	},
}

var blockDomCmd = &cobra.Command{
	Use:   "dom --id <id>",
	Short: "Get block DOM",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		fmt.Print(model.GetBlockDOM(id))
		return nil
	},
}

var blockKramdownCmd = &cobra.Command{
	Use:   "kramdown --id <id>",
	Short: "Get block kramdown",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		mode, _ := cmd.Flags().GetString("mode")
		if mode == "" {
			mode = "md"
		}
		fmt.Print(model.GetBlockKramdown(id, mode))
		return nil
	},
}

var blockStatCmd = &cobra.Command{
	Use:   "stat --id <id>",
	Short: "Get block content statistics",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		stat := filesys.StatTree(id)
		if stat == nil {
			return fmt.Errorf("document not found or empty")
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(stat, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("Characters: %d\n", stat.RuneCount)
			fmt.Printf("Words:      %d\n", stat.WordCount)
			fmt.Printf("Blocks:     %d\n", stat.BlockCount)
			fmt.Printf("Links:      %d\n", stat.LinkCount)
			fmt.Printf("Images:     %d\n", stat.ImageCount)
			fmt.Printf("Refs:       %d\n", stat.RefCount)
		}
		return nil
	},
}

// ─── Write ─────────────────────────────────────────────────────────────────────

var blockInsertCmd = &cobra.Command{
	Use:   "insert --parent <id> [--data <markdown> | --file <path>]",
	Short: "Insert block",
	RunE: func(cmd *cobra.Command, args []string) error {
		parentID, _ := cmd.Flags().GetString("parent")
		previousID, _ := cmd.Flags().GetString("previous")
		if parentID == "" {
			return fmt.Errorf("--parent is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would insert block under parent %s\n", parentID)
			if previousID != "" {
				fmt.Printf("         after previous sibling %s\n", previousID)
			}
			return nil
		}

		// 仅靠 parentID 定位目标时（无 previousID），目标必须是容器块，否则非法嵌套
		if previousID == "" {
			if err := treenode.CheckContainerParent(parentID); err != nil {
				return err
			}
		}

		data, err := resolveData(cmd)
		if err != nil {
			return err
		}

		dom := markdownToBlockDOM(data)
		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action:     "insert",
				Data:       dom,
				ParentID:   parentID,
				PreviousID: previousID,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		if bt := treenode.GetBlockTree(parentID); bt != nil {
			model.AppendPushReloadProtyleEntry(bt.RootID)
		}
		fmt.Println("ok")
		return nil
	},
}

var blockAppendCmd = &cobra.Command{
	Use:   "append --parent <id> [--data <markdown> | --file <path>]",
	Short: "Append block",
	RunE: func(cmd *cobra.Command, args []string) error {
		parentID, _ := cmd.Flags().GetString("parent")
		if parentID == "" {
			return fmt.Errorf("--parent is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would append block to parent %s\n", parentID)
			return nil
		}

		// append 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return err
		}

		data, err := resolveData(cmd)
		if err != nil {
			return err
		}

		dom := markdownToBlockDOM(data)
		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action:   "appendInsert",
				Data:     dom,
				ParentID: parentID,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		if bt := treenode.GetBlockTree(parentID); bt != nil {
			model.AppendPushReloadProtyleEntry(bt.RootID)
		}
		fmt.Println("ok")
		return nil
	},
}

var blockPrependCmd = &cobra.Command{
	Use:   "prepend --parent <id> [--data <markdown> | --file <path>]",
	Short: "Prepend block",
	RunE: func(cmd *cobra.Command, args []string) error {
		parentID, _ := cmd.Flags().GetString("parent")
		if parentID == "" {
			return fmt.Errorf("--parent is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would prepend block to parent %s\n", parentID)
			return nil
		}

		// prepend 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return err
		}

		data, err := resolveData(cmd)
		if err != nil {
			return err
		}

		dom := markdownToBlockDOM(data)
		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action:   "prependInsert",
				Data:     dom,
				ParentID: parentID,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		if bt := treenode.GetBlockTree(parentID); bt != nil {
			model.AppendPushReloadProtyleEntry(bt.RootID)
		}
		fmt.Println("ok")
		return nil
	},
}

var blockUpdateCmd = &cobra.Command{
	Use:   "update --id <id> [--data <markdown> | --file <path>]",
	Short: "Update block",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would update block %s\n", id)
			return nil
		}

		data, err := resolveData(cmd)
		if err != nil {
			return err
		}

		dom := markdownToBlockDOM(data)
		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action: "update",
				Data:   dom,
				ID:     id,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		if bt := treenode.GetBlockTree(id); bt != nil {
			model.AppendPushReloadProtyleEntry(bt.RootID)
		}
		fmt.Println("ok")
		return nil
	},
}

var blockDeleteCmd = &cobra.Command{
	Use:   "delete --id <id>",
	Short: "Delete block",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would delete block %s\n", id)
			return nil
		}

		bt := treenode.GetBlockTree(id)

		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action: "delete",
				ID:     id,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()

		if bt != nil {
			model.AppendPushReloadProtyleEntry(bt.RootID)
		}
		fmt.Println(id)
		return nil
	},
}

var blockMoveCmd = &cobra.Command{
	Use:   "move --id <id> --parent <id>",
	Short: "Move block",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		parentID, _ := cmd.Flags().GetString("parent")
		previousID, _ := cmd.Flags().GetString("previous")
		if id == "" || parentID == "" {
			return fmt.Errorf("--id and --parent are required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would move block %s to parent %s\n", id, parentID)
			if previousID != "" {
				fmt.Printf("         after previous sibling %s\n", previousID)
			}
			return nil
		}

		// 仅靠 parentID 定位目标时（无 previousID），目标必须是容器块，否则非法嵌套
		if previousID == "" {
			if err := treenode.CheckListItemNesting(parentID, id); err != nil {
				return err
			}
			if err := treenode.CheckContainerParent(parentID); err != nil {
				return err
			}
		}

		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action:     "move",
				ID:         id,
				ParentID:   parentID,
				PreviousID: previousID,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		if bt := treenode.GetBlockTree(id); bt != nil {
			model.AppendPushReloadProtyleEntry(bt.RootID)
		}
		fmt.Println("ok")
		return nil
	},
}

var blockBatchGetCmd = &cobra.Command{
	Use:   "batch-get --ids id1,id2,...",
	Short: "Batch get block info",
	RunE: func(cmd *cobra.Command, args []string) error {
		idsStr, _ := cmd.Flags().GetString("ids")
		if idsStr == "" {
			return fmt.Errorf("--ids is required")
		}
		ids := splitIDs(idsStr)
		if len(ids) == 0 {
			return fmt.Errorf("no valid IDs provided")
		}
		infos := model.GetDocsInfo(ids, false, false)
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(infos, "", "  ")
			fmt.Println(string(data))
		default:
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "ID\tNAME\tROOTID\tREFCOUNT")
			for _, info := range infos {
				fmt.Fprintf(w, "%s\t%s\t%s\t%d\n", info.ID, info.Name, info.RootID, info.RefCount)
			}
			for _, id := range ids {
				found := false
				for _, info := range infos {
					if info.ID == id {
						found = true
						break
					}
				}
				if !found {
					fmt.Fprintf(w, "%s\tnot found\t\t\n", id)
				}
			}
			w.Flush()
		}
		return nil
	},
}

var blockBatchKramdownCmd = &cobra.Command{
	Use:   "batch-kramdown --ids id1,id2,...",
	Short: "Batch get block kramdown",
	RunE: func(cmd *cobra.Command, args []string) error {
		idsStr, _ := cmd.Flags().GetString("ids")
		if idsStr == "" {
			return fmt.Errorf("--ids is required")
		}
		ids := splitIDs(idsStr)
		if len(ids) == 0 {
			return fmt.Errorf("no valid IDs provided")
		}
		kramdowns := model.GetBlockKramdowns(ids, "md")
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(kramdowns, "", "  ")
			fmt.Println(string(data))
		default:
			var sb strings.Builder
			for _, id := range ids {
				if kd, ok := kramdowns[id]; ok {
					sb.WriteString(fmt.Sprintf("--- %s ---\n%s\n\n", id, kd))
				} else {
					sb.WriteString(fmt.Sprintf("--- %s ---\n(not found)\n\n", id))
				}
			}
			fmt.Print(sb.String())
		}
		return nil
	},
}

func splitIDs(s string) []string {
	parts := strings.Split(s, ",")
	var ids []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			ids = append(ids, p)
		}
	}
	return ids
}

func resolveData(cmd *cobra.Command) (string, error) {
	data, _ := cmd.Flags().GetString("data")
	if data != "" {
		return data, nil
	}

	filePath, _ := cmd.Flags().GetString("file")
	if filePath == "-" {
		stdinData, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", err
		}
		return string(stdinData), nil
	}
	if filePath != "" {
		fileData, err := os.ReadFile(filePath)
		if err != nil {
			return "", err
		}
		return string(fileData), nil
	}

	stdinData, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", err
	}
	return string(stdinData), nil
}

func markdownToBlockDOM(md string) string {
	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	dom, _ := luteEngine.Md2BlockDOMTree(md, true)
	if dom == "" {
		dom = "<div data-type=\"NodeParagraph\" data-node-id=\"\"><div data-type=\"NodeText\"></div></div>"
	}
	return dom
}

func init() {
	blockGetCmd.Flags().String("id", "", "block ID")
	blockChildrenCmd.Flags().String("id", "", "parent block ID")
	blockBreadcrumbCmd.Flags().String("id", "", "block ID")
	blockDomCmd.Flags().String("id", "", "block ID")
	blockKramdownCmd.Flags().String("id", "", "block ID")
	blockKramdownCmd.Flags().String("mode", "md", "export mode: md | textmark")
	blockStatCmd.Flags().String("id", "", "block ID")

	blockInsertCmd.Flags().String("parent", "", "parent block ID")
	blockInsertCmd.Flags().String("data", "", "markdown content")
	blockInsertCmd.Flags().String("file", "", "read content from file path (- for stdin)")
	blockInsertCmd.Flags().String("previous", "", "previous sibling block ID")

	blockAppendCmd.Flags().String("parent", "", "parent block ID")
	blockAppendCmd.Flags().String("data", "", "markdown content")
	blockAppendCmd.Flags().String("file", "", "read content from file path (- for stdin)")

	blockPrependCmd.Flags().String("parent", "", "parent block ID")
	blockPrependCmd.Flags().String("data", "", "markdown content")
	blockPrependCmd.Flags().String("file", "", "read content from file path (- for stdin)")

	blockUpdateCmd.Flags().String("id", "", "block ID")
	blockUpdateCmd.Flags().String("data", "", "markdown content")
	blockUpdateCmd.Flags().String("file", "", "read content from file path (- for stdin)")

	blockDeleteCmd.Flags().String("id", "", "block ID")

	blockMoveCmd.Flags().String("id", "", "block ID")
	blockMoveCmd.Flags().String("parent", "", "target parent block ID")
	blockMoveCmd.Flags().String("previous", "", "target previous sibling block ID")

	blockBatchGetCmd.Flags().String("ids", "", "comma-separated block IDs")
	blockBatchKramdownCmd.Flags().String("ids", "", "comma-separated block IDs")

	rootCmd.AddCommand(blockCmd)
	blockCmd.AddCommand(blockGetCmd)
	blockCmd.AddCommand(blockChildrenCmd)
	blockCmd.AddCommand(blockBreadcrumbCmd)
	blockCmd.AddCommand(blockDomCmd)
	blockCmd.AddCommand(blockKramdownCmd)
	blockCmd.AddCommand(blockStatCmd)
	blockCmd.AddCommand(blockInsertCmd)
	blockCmd.AddCommand(blockAppendCmd)
	blockCmd.AddCommand(blockPrependCmd)
	blockCmd.AddCommand(blockUpdateCmd)
	blockCmd.AddCommand(blockDeleteCmd)
	blockCmd.AddCommand(blockMoveCmd)
	blockCmd.AddCommand(blockBatchGetCmd)
	blockCmd.AddCommand(blockBatchKramdownCmd)
}
