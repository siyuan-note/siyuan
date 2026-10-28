// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var notebookCmd = &cobra.Command{
	Use:   "notebook",
	Short: "Manage notebooks",
}

var notebookListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all notebooks",
	RunE: func(cmd *cobra.Command, args []string) error {
		boxes, err := model.ListNotebooks()
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(boxes, "", "  ")
			fmt.Println(string(data))
		default:
			printNotebookTable(boxes)
		}
		return nil
	},
}

var notebookCreateCmd = &cobra.Command{
	Use:   "create --name <name>",
	Short: "Create a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		if name == "" {
			return fmt.Errorf("--name is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would create notebook \"%s\"\n", name)
			return nil
		}

		id, err := model.CreateBox(name)
		if err != nil {
			return err
		}
		if _, err = model.Mount(id); err != nil {
			return fmt.Errorf("notebook [%s] was created but could not be opened: %w", id, err)
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println(id)
		return nil
	},
}

func formatNotebookWriteError(boxID string, err error) error {
	if errors.Is(err, model.ErrBoxClosed) {
		return fmt.Errorf("notebook [%s] is closed; run `notebook open --id %s` first", boxID, boxID)
	}
	if errors.Is(err, model.ErrBoxNotFound) {
		return fmt.Errorf("notebook [%s] not found", boxID)
	}
	return err
}

var notebookRemoveCmd = &cobra.Command{
	Use:   "remove --id <id>",
	Short: "Remove a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would remove notebook %s\n", id)
			return nil
		}

		if err := model.RemoveBox(id); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println(id)
		return nil
	},
}

var notebookRenameCmd = &cobra.Command{
	Use:   "rename --id <id> --name <name>",
	Short: "Rename a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		name, _ := cmd.Flags().GetString("name")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		if name == "" {
			return fmt.Errorf("--name is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would rename notebook %s to \"%s\"\n", id, name)
			return nil
		}

		if err := model.RenameBox(id, name); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println(id)
		return nil
	},
}

var notebookOpenCmd = &cobra.Command{
	Use:   "open --id <id>",
	Short: "Open a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would open notebook %s\n", id)
			return nil
		}

		existed, err := model.Mount(id)
		if err != nil {
			return err
		}
		if box := model.Conf.Box(id); nil != box {
			evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast)
			evt.Data = map[string]any{
				"box":     box,
				"existed": existed,
			}
			util.PushEvent(evt)
		}
		time.Sleep(1 * time.Second)
		sql.FlushQueue()
		fmt.Println(id)
		return nil
	},
}

var notebookCloseCmd = &cobra.Command{
	Use:   "close --id <id>",
	Short: "Close a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would close notebook %s\n", id)
			return nil
		}

		model.Unmount(id)
		time.Sleep(1 * time.Second)
		sql.FlushQueue()
		fmt.Println(id)
		return nil
	},
}

func printNotebookTable(boxes []*model.Box) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tCLOSED\tSORT")
	for _, b := range boxes {
		fmt.Fprintf(w, "%s\t%s\t%v\t%d\n", b.ID, b.Name, b.Closed, b.Sort)
	}
	w.Flush()
}

// notebookSetIconCmd 设置笔记本图标。
// icon 取值格式：emoji hex 码点（如 "1f4ca"）、emoji 字符、自定义图片路径、网络图片 URL 或动态图标 URL。
var notebookSetIconCmd = &cobra.Command{
	Use:   "set-icon --id <id> --icon <icon>",
	Short: "Set a notebook icon",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		icon, _ := cmd.Flags().GetString("icon")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		if icon == "" {
			return fmt.Errorf("--icon is required")
		}

		// 校验笔记本存在，避免对一个不存在的 id 静默写入图标。
		exists := false
		notebooks, err := model.ListNotebooks()
		if err != nil {
			return err
		}
		for _, nb := range notebooks {
			if nb.ID == id {
				exists = true
				break
			}
		}
		if !exists {
			return fmt.Errorf("notebook not found: %s", id)
		}

		if dryRun {
			fmt.Printf("[dry-run] Would set notebook %s icon to %s\n", id, icon)
			return nil
		}

		// SetBoxIcon 内部对自定义图片名做 XSS 过滤。
		model.SetBoxIcon(id, icon)

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(map[string]string{"id": id, "icon": icon}, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("%s\t%s\n", id, icon)
		}
		return nil
	},
}

// notebookRandomIconCmd 为笔记本随机换一个内置 emoji 图标。
// 传 --id 仅换该笔记本；不传则对全部笔记本各随机换一个。
var notebookRandomIconCmd = &cobra.Command{
	Use:   "random-icon [--id <id>]",
	Short: "Randomly set notebook icon(s) from built-in emojis",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")

		notebooks, err := model.ListNotebooks()
		if err != nil {
			return err
		}

		// 目标范围：传 id 仅换该笔记本；不传则对全部笔记本各随机换一个。
		targets := notebooks
		if id != "" {
			var found *model.Box
			for _, nb := range notebooks {
				if nb.ID == id {
					found = nb
					break
				}
			}
			if found == nil {
				return fmt.Errorf("notebook not found: %s", id)
			}
			targets = []*model.Box{found}
		}
		if len(targets) == 0 {
			return fmt.Errorf("no notebooks to update")
		}

		// 先把拟定的新图标算好，便于 dry-run 预览与失败回滚。
		type change struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			OldIcon string `json:"oldIcon"`
			NewIcon string `json:"newIcon"`
		}
		changes := make([]change, 0, len(targets))
		for _, nb := range targets {
			changes = append(changes, change{ID: nb.ID, Name: nb.Name, OldIcon: nb.Icon, NewIcon: util.RandomBuiltinEmoji()})
		}

		if dryRun {
			for _, c := range changes {
				fmt.Printf("[dry-run] Would set notebook %s (%s) icon %s -> %s\n", c.ID, c.Name, c.OldIcon, c.NewIcon)
			}
			return nil
		}

		for _, c := range changes {
			model.SetBoxIcon(c.ID, c.NewIcon)
		}

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(changes, "", "  ")
			fmt.Println(string(data))
		default:
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "ID\tNAME\tOLD\tNEW")
			for _, c := range changes {
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", c.ID, c.Name, c.OldIcon, c.NewIcon)
			}
			w.Flush()
		}
		return nil
	},
}

func init() {
	notebookCreateCmd.Flags().String("name", "", "notebook name")
	notebookRemoveCmd.Flags().String("id", "", "notebook ID")
	notebookRenameCmd.Flags().String("id", "", "notebook ID")
	notebookRenameCmd.Flags().String("name", "", "new notebook name")
	notebookOpenCmd.Flags().String("id", "", "notebook ID")
	notebookCloseCmd.Flags().String("id", "", "notebook ID")
	notebookSetIconCmd.Flags().String("id", "", "notebook ID")
	notebookSetIconCmd.Flags().String("icon", "", "notebook icon: emoji hex codepoint like \"1f4ca\", emoji character like \"📊\", custom image path like \"1/b3log.png\", network image URL like \"https://example.com/icon.png\", or dynamic icon URL like \"api/icon/getDynamicIcon?type=8&color=%23d23f31&content=SiYuan&id=xxx\"")
	notebookRandomIconCmd.Flags().String("id", "", "notebook ID (optional; omit to update all notebooks)")

	rootCmd.AddCommand(notebookCmd)
	notebookCmd.AddCommand(notebookListCmd)
	notebookCmd.AddCommand(notebookCreateCmd)
	notebookCmd.AddCommand(notebookRemoveCmd)
	notebookCmd.AddCommand(notebookRenameCmd)
	notebookCmd.AddCommand(notebookOpenCmd)
	notebookCmd.AddCommand(notebookCloseCmd)
	notebookCmd.AddCommand(notebookSetIconCmd)
	notebookCmd.AddCommand(notebookRandomIconCmd)
}
