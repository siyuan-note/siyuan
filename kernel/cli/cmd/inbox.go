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
	"strings"
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/88250/lute/ast"
	"github.com/spf13/cobra"
)

// inboxCmd 收集箱管理：列出、阅读云端剪藏，并把它们批量转为本地文档。
// 收集箱数据存放在思源云端，需要订阅会员；底层复用 model 层的云端 shorthand 读写函数。
var inboxCmd = &cobra.Command{
	Use:   "inbox",
	Short: "Manage the cloud inbox (clipped shorthands)",
}

// inboxListCmd 分页列出收集箱，仅返回摘要而非正文，控制输出长度；正文用 get 按需拉取。
var inboxListCmd = &cobra.Command{
	Use:   "list [--page]",
	Short: "List cloud inbox shorthands",
	RunE: func(cmd *cobra.Command, args []string) error {
		page, _ := cmd.Flags().GetInt("page")
		if page < 1 {
			page = 1
		}

		result, err := model.GetCloudShorthands(page)
		if err != nil {
			return err
		}

		data, _ := result["data"].(map[string]any)
		shorthands, _ := data["shorthands"].([]any)

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(shorthands, "", "  ")
			fmt.Println(string(data))
		default:
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "ID\tTITLE\tURL\tCREATED")
			for _, item := range shorthands {
				sh, _ := item.(map[string]any)
				if sh == nil {
					continue
				}
				id, _ := sh["oId"].(string)
				title, _ := sh["shorthandTitle"].(string)
				url, _ := sh["shorthandURL"].(string)
				hCreated, _ := sh["hCreated"].(string)
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", id, title, url, hCreated)
			}
			w.Flush()
			fmt.Printf("\n%d item(s) on page %d\n", len(shorthands), page)
		}
		return nil
	},
}

// inboxGetCmd 取单条收集箱详情，返回完整 markdown 正文（shorthandMd）。
var inboxGetCmd = &cobra.Command{
	Use:   "get --id <id>",
	Short: "Get a cloud inbox shorthand with full markdown",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		sh, err := model.GetCloudShorthand(id)
		if err != nil {
			return err
		}

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(sh, "", "  ")
			fmt.Println(string(data))
		default:
			title, _ := sh["shorthandTitle"].(string)
			url, _ := sh["shorthandURL"].(string)
			hCreated, _ := sh["hCreated"].(string)
			md, _ := sh["shorthandMd"].(string)
			fmt.Println("ID:     ", id)
			fmt.Println("TITLE:  ", title)
			fmt.Println("CREATED:", hCreated)
			if url != "" {
				fmt.Println("URL:    ", url)
			}
			fmt.Println("\nMARKDOWN:")
			fmt.Println(md)
		}
		return nil
	},
}

// inboxConvertCmd 把一条或多条剪藏转为本地文档：取云端 md → 本地建文档 → 成功后清理云端原件。
// 失败的条目不会被删除，也不会中断后续条目的处理；输出逐条结果。
var inboxConvertCmd = &cobra.Command{
	Use:   "convert --ids <id1,id2,...> --notebook <id> [--path </h/path>] [--remove-after]",
	Short: "Convert cloud inbox shorthands into local documents",
	RunE: func(cmd *cobra.Command, args []string) error {
		notebook, _ := cmd.Flags().GetString("notebook")
		if notebook == "" {
			return fmt.Errorf("--notebook is required")
		}

		idsRaw, _ := cmd.Flags().GetString("ids")
		ids := parseShorthandIDs(idsRaw)
		if len(ids) == 0 {
			return fmt.Errorf("--ids is required (comma-separated shorthand IDs)")
		}

		hPath, _ := cmd.Flags().GetString("path")
		if hPath == "" {
			hPath = "/"
		}
		removeAfter, _ := cmd.Flags().GetBool("remove-after")

		// 解析目标父路径（hPath→fsPath）：hPath 指向新文档将要落入的父容器，
		// 其父目录必须已存在；不传或传 "/" 时落到笔记本根目录。
		parentPath := "/"
		parentDir := parentDir(hPath)
		if parentDir != "/" {
			bt := treenode.GetBlockTreeRootByHPath(notebook, parentDir)
			if bt == nil {
				return fmt.Errorf("parent path not found: %s", parentDir)
			}
			parentPath = strings.TrimSuffix(bt.Path, ".sy")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would convert %d shorthand(s) -> notebook %s (hPath: %s, removeAfter: %v)\n",
				len(ids), notebook, hPath, removeAfter)
			for _, id := range ids {
				fmt.Printf("[dry-run]   - %s\n", id)
			}
			return nil
		}

		type result struct {
			ID     string `json:"id"`
			Title  string `json:"title"`
			DocID  string `json:"docId"`
			Status string `json:"status"`
			Error  string `json:"error,omitempty"`
		}
		results := make([]result, 0, len(ids))
		successIDs := make([]string, 0, len(ids))
		failed := 0

		for _, id := range ids {
			sh, err := model.GetCloudShorthand(id)
			if err != nil {
				results = append(results, result{ID: id, Status: "failed", Error: err.Error()})
				failed++
				continue
			}

			title, _ := sh["shorthandTitle"].(string)
			if title == "" {
				title = "Untitled"
			}
			md, _ := sh["shorthandMd"].(string)
			// content 为空（既无 md 也无渲染正文）但有来源 URL 时，回退为 markdown 链接，与前端行为一致。
			if md == "" {
				if content, _ := sh["shorthandContent"].(string); content == "" {
					if url, _ := sh["shorthandURL"].(string); url != "" {
						md = "[" + title + "](" + url + ")"
					}
				}
			}

			docID := ast.NewNodeID()
			docPath := strings.TrimRight(parentPath, "/") + "/" + docID + ".sy"
			tree, err := model.CreateDocByMd(notebook, docPath, title, md, nil, nil)
			if err != nil {
				results = append(results, result{ID: id, Title: title, Status: "failed", Error: err.Error()})
				failed++
				continue
			}
			successIDs = append(successIDs, id)
			results = append(results, result{ID: id, Title: title, DocID: tree.Root.ID, Status: "created"})
		}

		// 仅在转换成功的条目上清理云端原件；失败条目保留以便重试。
		if removeAfter && len(successIDs) > 0 {
			if err := model.RemoveCloudShorthands(successIDs); err != nil {
				fmt.Fprintf(os.Stderr, "WARNING: failed to remove cloud originals: %s\n", err)
			}
		}

		util.PushReloadFiletree()

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(results, "", "  ")
			fmt.Println(string(data))
		default:
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "SHORTHAND\tTITLE\tDOC ID\tSTATUS")
			for _, r := range results {
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", r.ID, r.Title, r.DocID, r.Status)
				if r.Error != "" {
					fmt.Fprintf(w, "\t\t\t  %s\n", r.Error)
				}
			}
			w.Flush()
			fmt.Printf("\nDone: %d succeeded, %d failed.\n", len(successIDs), failed)
		}
		return nil
	},
}

// parseShorthandIDs 把逗号分隔的 id 串拆成去空白、去重的切片。
func parseShorthandIDs(s string) []string {
	if s == "" {
		return nil
	}
	raw := make([]string, 0, 4)
	for p := range strings.SplitSeq(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			raw = append(raw, p)
		}
	}
	seen := make(map[string]bool, len(raw))
	out := raw[:0]
	for _, id := range raw {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// parentDir 返回路径的父目录：去掉最后一个 "/" 段，根路径及单段路径返回 "/"。
func parentDir(p string) string {
	i := strings.LastIndex(p, "/")
	if i <= 0 {
		return "/"
	}
	return p[:i]
}

func init() {
	inboxListCmd.Flags().IntP("page", "p", 1, "page number (1-based)")
	inboxGetCmd.Flags().String("id", "", "shorthand ID (required)")
	inboxConvertCmd.Flags().String("ids", "", "comma-separated shorthand IDs (required)")
	inboxConvertCmd.Flags().String("notebook", "", "target notebook ID (required)")
	inboxConvertCmd.Flags().String("path", "/", "target hPath in the notebook (default \"/\", the notebook root)")
	inboxConvertCmd.Flags().Bool("remove-after", true, "delete cloud shorthands after successful conversion")

	rootCmd.AddCommand(inboxCmd)
	inboxCmd.AddCommand(inboxListCmd)
	inboxCmd.AddCommand(inboxGetCmd)
	inboxCmd.AddCommand(inboxConvertCmd)
}
