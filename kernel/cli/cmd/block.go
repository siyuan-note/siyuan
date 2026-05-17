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

var blockInfoCmd = &cobra.Command{
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

// ─── Write ─────────────────────────────────────────────────────────────────────

var blockInsertCmd = &cobra.Command{
	Use:   "insert --parent <id> --data <markdown>",
	Short: "Insert block",
	RunE: func(cmd *cobra.Command, args []string) error {
		parentID, _ := cmd.Flags().GetString("parent")
		data, _ := cmd.Flags().GetString("data")
		previousID, _ := cmd.Flags().GetString("previous")
		if parentID == "" || data == "" {
			return fmt.Errorf("--parent and --data are required")
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
		model.AppendPushReloadProtyleEntry(parentID)
		fmt.Println("ok")
		return nil
	},
}

var blockAppendCmd = &cobra.Command{
	Use:   "append --parent <id> --data <markdown>",
	Short: "Append block",
	RunE: func(cmd *cobra.Command, args []string) error {
		parentID, _ := cmd.Flags().GetString("parent")
		data, _ := cmd.Flags().GetString("data")
		if parentID == "" || data == "" {
			return fmt.Errorf("--parent and --data are required")
		}

		dom := markdownToBlockDOM(data)
		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action:   "append",
				Data:     dom,
				ParentID: parentID,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		model.AppendPushReloadProtyleEntry(parentID)
		fmt.Println("ok")
		return nil
	},
}

var blockPrependCmd = &cobra.Command{
	Use:   "prepend --parent <id> --data <markdown>",
	Short: "Prepend block",
	RunE: func(cmd *cobra.Command, args []string) error {
		parentID, _ := cmd.Flags().GetString("parent")
		data, _ := cmd.Flags().GetString("data")
		if parentID == "" || data == "" {
			return fmt.Errorf("--parent and --data are required")
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
		model.AppendPushReloadProtyleEntry(parentID)
		fmt.Println("ok")
		return nil
	},
}

var blockUpdateCmd = &cobra.Command{
	Use:   "update --id <id> --data <markdown>",
	Short: "Update block",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		data, _ := cmd.Flags().GetString("data")
		if id == "" || data == "" {
			return fmt.Errorf("--id and --data are required")
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
		model.AppendPushReloadProtyleEntry(id)
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

		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action: "delete",
				ID:     id,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		model.AppendPushReloadProtyleEntry(id)
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
		model.AppendPushReloadProtyleEntry(id)
		fmt.Println("ok")
		return nil
	},
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
	blockInfoCmd.Flags().String("id", "", "document block ID")

	blockInsertCmd.Flags().String("parent", "", "parent block ID")
	blockInsertCmd.Flags().String("data", "", "markdown content")
	blockInsertCmd.Flags().String("previous", "", "previous sibling block ID")

	blockAppendCmd.Flags().String("parent", "", "parent block ID")
	blockAppendCmd.Flags().String("data", "", "markdown content")

	blockPrependCmd.Flags().String("parent", "", "parent block ID")
	blockPrependCmd.Flags().String("data", "", "markdown content")

	blockUpdateCmd.Flags().String("id", "", "block ID")
	blockUpdateCmd.Flags().String("data", "", "markdown content")

	blockDeleteCmd.Flags().String("id", "", "block ID")

	blockMoveCmd.Flags().String("id", "", "block ID")
	blockMoveCmd.Flags().String("parent", "", "target parent block ID")
	blockMoveCmd.Flags().String("previous", "", "target previous sibling block ID")

	rootCmd.AddCommand(blockCmd)
	blockCmd.AddCommand(blockGetCmd)
	blockCmd.AddCommand(blockChildrenCmd)
	blockCmd.AddCommand(blockBreadcrumbCmd)
	blockCmd.AddCommand(blockDomCmd)
	blockCmd.AddCommand(blockKramdownCmd)
	blockCmd.AddCommand(blockInfoCmd)
	blockCmd.AddCommand(blockInsertCmd)
	blockCmd.AddCommand(blockAppendCmd)
	blockCmd.AddCommand(blockPrependCmd)
	blockCmd.AddCommand(blockUpdateCmd)
	blockCmd.AddCommand(blockDeleteCmd)
	blockCmd.AddCommand(blockMoveCmd)
}
