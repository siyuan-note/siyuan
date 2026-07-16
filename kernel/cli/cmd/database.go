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

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"

	"github.com/spf13/cobra"
)

var databaseCmd = &cobra.Command{
	Use:   "database",
	Short: "Manage databases (attribute views)",
}

var databaseSearchCmd = &cobra.Command{
	Use:   "search <keyword>",
	Short: "Search databases by name",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		results := model.SearchAttributeView(args[0], nil, "", "")
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(results, "", "  ")
			fmt.Println(string(data))
		default:
			printAvSearchResults(results)
		}
		return nil
	},
}

var databaseGetCmd = &cobra.Command{
	Use:   "get --av <avID>",
	Short: "Get database content",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		if avID == "" {
			return fmt.Errorf("--av is required")
		}
		attrView := model.GetAttributeView(avID)
		if attrView == nil {
			return fmt.Errorf("database not found: %s", avID)
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(attrView, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("ID:    %s\n", attrView.ID)
			fmt.Printf("Name:  %s\n", attrView.Name)
			fmt.Printf("Keys:  %d  Views: %d\n\n", len(attrView.KeyValues), len(attrView.Views))
			printDatabaseTable(attrView)
		}
		return nil
	},
}

var databaseRenderCmd = &cobra.Command{
	Use:   "render --av <avID>",
	Short: "Render database data",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		viewID, _ := cmd.Flags().GetString("view")
		query, _ := cmd.Flags().GetString("query")
		page, _ := cmd.Flags().GetInt("page")
		size, _ := cmd.Flags().GetInt("size")
		if avID == "" {
			return fmt.Errorf("--av is required")
		}
		if page < 1 {
			page = 1
		}
		if size < 1 {
			size = 50
		}

		_, attrView, err := model.RenderAttributeView("", avID, viewID, query, page, size, nil, false, false)
		if err != nil {
			return err
		}

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(attrView, "", "  ")
			fmt.Println(string(data))
		default:
			printDatabaseTable(attrView)
		}
		return nil
	},
}

var databaseKeysCmd = &cobra.Command{
	Use:   "keys --av <avID>",
	Short: "List database keys (fields)",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		if avID == "" {
			return fmt.Errorf("--av is required")
		}
		attrView := model.GetAttributeView(avID)
		if attrView == nil {
			return fmt.Errorf("database not found: %s", avID)
		}
		switch outputFormat {
		case "json":
			var keys []*av.Key
			for _, kv := range attrView.KeyValues {
				keys = append(keys, kv.Key)
			}
			data, _ := json.MarshalIndent(keys, "", "  ")
			fmt.Println(string(data))
		default:
			printKeyTable(attrView)
		}
		return nil
	},
}

var databaseKeyCmd = &cobra.Command{
	Use:   "key",
	Short: "Manage database keys (fields)",
}

var databaseKeyAddCmd = &cobra.Command{
	Use:   "add --av <avID> --name <name> --type <type>",
	Short: "Add a key (field) to database",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		name, _ := cmd.Flags().GetString("name")
		keyType, _ := cmd.Flags().GetString("type")
		icon, _ := cmd.Flags().GetString("icon")
		prev, _ := cmd.Flags().GetString("prev")
		if avID == "" || name == "" || keyType == "" {
			return fmt.Errorf("--av, --name and --type are required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would add key \"%s\" (type=%s) to database %s\n", name, keyType, avID)
			return nil
		}

		keyID := ast.NewNodeID()
		if err := model.AddAttributeViewKey(avID, keyID, name, keyType, icon, prev); err != nil {
			return err
		}
		model.AppendPushReloadAttrViewEntry(avID)
		fmt.Println(keyID)
		return nil
	},
}

var databaseKeyRemoveCmd = &cobra.Command{
	Use:   "remove --av <avID> --key <keyID>",
	Short: "Remove a key (field) from database",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		keyID, _ := cmd.Flags().GetString("key")
		removeRelation, _ := cmd.Flags().GetBool("remove-relation-dest")
		if avID == "" || keyID == "" {
			return fmt.Errorf("--av and --key are required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would remove key %s from database %s\n", keyID, avID)
			return nil
		}

		if err := model.RemoveAttributeViewKey(avID, keyID, removeRelation); err != nil {
			return err
		}
		model.AppendPushReloadAttrViewEntry(avID)
		fmt.Println("ok")
		return nil
	},
}

var databaseUnusedCmd = &cobra.Command{
	Use:   "unused",
	Short: "List unused databases",
	RunE: func(cmd *cobra.Command, args []string) error {
		items := model.UnusedAttributeViews(true)
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(items, "", "  ")
			fmt.Println(string(data))
		default:
			printUnusedItems(items)
		}
		return nil
	},
}

var databaseCleanCmd = &cobra.Command{
	Use:   "clean",
	Short: "Clean unused databases",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		if avID != "" {
			if dryRun {
				fmt.Printf("[dry-run] Would clean unused database %s\n", avID)
				return nil
			}
			model.RemoveUnusedAttributeView(avID)
			fmt.Println(avID)
			return nil
		}

		if dryRun {
			fmt.Println("[dry-run] Would clean unused databases")
			return nil
		}

		removed := model.RemoveUnusedAttributeViews()
		fmt.Printf("%d database(s) cleaned\n", len(removed))
		return nil
	},
}

var databaseItemCmd = &cobra.Command{
	Use:   "item",
	Short: "Manage database rows (items)",
}

var databaseItemAddCmd = &cobra.Command{
	Use:   "add --av <avID>",
	Short: "Add a row to database",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		content, _ := cmd.Flags().GetString("content")
		blockID, _ := cmd.Flags().GetString("block")
		viewID, _ := cmd.Flags().GetString("view")
		groupID, _ := cmd.Flags().GetString("group")
		previousID, _ := cmd.Flags().GetString("previous")
		isDetached, _ := cmd.Flags().GetBool("detached")
		ignoreFill, _ := cmd.Flags().GetBool("ignore-default-fill")
		if avID == "" {
			return fmt.Errorf("--av is required")
		}
		if !isDetached && blockID == "" {
			return fmt.Errorf("--block is required for non-detached rows")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would add row to database %s\n", avID)
			return nil
		}

		src := map[string]any{
			"isDetached": isDetached,
		}
		if blockID != "" {
			src["id"] = blockID
		}
		if content != "" {
			src["content"] = content
		}
		srcs := []map[string]any{src}

		if err := model.AddAttributeViewBlock(nil, srcs, avID, blockID, viewID, groupID, previousID, ignoreFill); err != nil {
			return err
		}
		model.AppendPushReloadAttrViewEntry(avID)
		fmt.Println("ok")
		return nil
	},
}

var databaseItemRemoveCmd = &cobra.Command{
	Use:   "remove --av <avID> --ids <id1,id2,...>",
	Short: "Remove rows from database",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		idsStr, _ := cmd.Flags().GetString("ids")
		if avID == "" || idsStr == "" {
			return fmt.Errorf("--av and --ids are required")
		}
		ids := strings.Split(idsStr, ",")
		for i := range ids {
			ids[i] = strings.TrimSpace(ids[i])
		}

		if dryRun {
			fmt.Printf("[dry-run] Would remove %d row(s) from database %s\n", len(ids), avID)
			return nil
		}

		if err := model.RemoveAttributeViewBlock(ids, avID); err != nil {
			return err
		}
		model.AppendPushReloadAttrViewEntry(avID)
		fmt.Println("ok")
		return nil
	},
}

var databaseItemUpdateCmd = &cobra.Command{
	Use:   "update --av <avID> --key <keyID> --item <itemID> --value <json>",
	Short: "Update a cell value",
	RunE: func(cmd *cobra.Command, args []string) error {
		avID, _ := cmd.Flags().GetString("av")
		keyID, _ := cmd.Flags().GetString("key")
		itemID, _ := cmd.Flags().GetString("item")
		valueStr, _ := cmd.Flags().GetString("value")
		if avID == "" || keyID == "" || itemID == "" || valueStr == "" {
			return fmt.Errorf("--av, --key, --item and --value are required")
		}
		var valueData map[string]any
		if err := json.Unmarshal([]byte(valueStr), &valueData); err != nil {
			return fmt.Errorf("invalid JSON: %s", err)
		}

		if dryRun {
			fmt.Printf("[dry-run] Would update cell in database %s: key=%s item=%s\n", avID, keyID, itemID)
			return nil
		}

		if _, err := model.UpdateAttributeViewCell(nil, avID, keyID, itemID, valueData); err != nil {
			return err
		}
		model.AppendPushReloadAttrViewEntry(avID)
		fmt.Println("ok")
		return nil
	},
}

func printUnusedItems(items []*model.UnusedItem) {
	if len(items) == 0 {
		fmt.Println("No unused databases found.")
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ITEM\tNAME")
	for _, item := range items {
		fmt.Fprintf(w, "%s\t%s\n", item.Item, item.Name)
	}
	w.Flush()
	fmt.Printf("\n%d unused database(s)\n", len(items))
}

func printKeyTable(attrView *av.AttributeView) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tTYPE\tICON")
	for _, kv := range attrView.KeyValues {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", kv.Key.ID, kv.Key.Name, kv.Key.Type, kv.Key.Icon)
	}
	w.Flush()
}

func printAvSearchResults(results []*model.AvSearchResult) {
	if len(results) == 0 {
		fmt.Println("No results found.")
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tHPATH")
	for _, r := range results {
		fmt.Fprintf(w, "%s\t%s\t%s\n", r.AvID, r.AvName, r.HPath)
	}
	w.Flush()
}

func printDatabaseTable(attrView *av.AttributeView) {
	if len(attrView.KeyValues) == 0 {
		fmt.Println("(empty)")
		return
	}

	fmt.Println(attrView.Name)

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	for _, kv := range attrView.KeyValues {
		fmt.Fprintf(w, "%s\t", kv.Key.Name)
	}
	fmt.Fprintln(w)

	rowCount := 0
	for _, kv := range attrView.KeyValues {
		if len(kv.Values) > rowCount {
			rowCount = len(kv.Values)
		}
	}

	for i := 0; i < rowCount; i++ {
		for _, kv := range attrView.KeyValues {
			if i < len(kv.Values) {
				fmt.Fprintf(w, "%s\t", formatValue(kv.Values[i]))
			} else {
				fmt.Fprintf(w, "%s\t", "")
			}
		}
		fmt.Fprintln(w)
	}
	w.Flush()

	fmt.Printf("\n%d row(s)\n", rowCount)
}

func formatValue(v *av.Value) string {
	if v == nil {
		return ""
	}
	switch v.Type {
	case av.KeyTypeBlock:
		if v.Block != nil {
			return truncate(v.Block.Content, 40)
		}
		return v.BlockID
	case av.KeyTypeText:
		return v.Text.Content
	case av.KeyTypeNumber:
		if v.Number != nil && v.Number.FormattedContent != "" {
			return v.Number.FormattedContent
		}
		return fmt.Sprintf("%v", v.Number.Content)
	case av.KeyTypeSelect, av.KeyTypeMSelect:
		var parts []string
		for _, s := range v.MSelect {
			parts = append(parts, s.Content)
		}
		return strings.Join(parts, ", ")
	case av.KeyTypeCheckbox:
		if v.Checkbox.Checked {
			return "☑"
		}
		return "☐"
	case av.KeyTypeDate:
		if v.Date != nil && v.Date.FormattedContent != "" {
			return v.Date.FormattedContent
		}
		return ""
	case av.KeyTypeURL:
		return v.URL.Content
	case av.KeyTypeEmail:
		return v.Email.Content
	case av.KeyTypePhone:
		return v.Phone.Content
	case av.KeyTypeTemplate:
		return truncate(v.Template.Content, 40)
	case av.KeyTypeCreated:
		if v.Created != nil && v.Created.FormattedContent != "" {
			return v.Created.FormattedContent
		}
		return ""
	case av.KeyTypeUpdated:
		if v.Updated != nil && v.Updated.FormattedContent != "" {
			return v.Updated.FormattedContent
		}
		return ""
	case av.KeyTypeMAsset:
		var parts []string
		for _, a := range v.MAsset {
			parts = append(parts, a.Name)
		}
		return strings.Join(parts, ", ")
	case av.KeyTypeRelation:
		return fmt.Sprintf("%d ref(s)", len(v.Relation.BlockIDs))
	case av.KeyTypeRollup:
		if len(v.Rollup.Contents) > 0 && v.Rollup.Contents[0] != nil {
			return formatValue(v.Rollup.Contents[0])
		}
		return ""
	default:
		return ""
	}
}

func init() {
	databaseGetCmd.Flags().String("av", "", "attribute view ID (required)")

	databaseRenderCmd.Flags().String("av", "", "attribute view ID (required)")
	databaseRenderCmd.Flags().String("view", "", "view ID (default: current view)")
	databaseRenderCmd.Flags().String("query", "", "search query within the view")
	databaseRenderCmd.Flags().IntP("page", "p", 1, "page number")
	databaseRenderCmd.Flags().IntP("size", "s", 50, "page size")

	databaseKeysCmd.Flags().String("av", "", "attribute view ID (required)")

	databaseKeyAddCmd.Flags().String("av", "", "attribute view ID (required)")
	databaseKeyAddCmd.Flags().String("name", "", "key name (required)")
	databaseKeyAddCmd.Flags().String("type", "", "key type (required): block/text/number/date/select/mSelect/url/email/phone/mAsset/template/created/updated/checkbox/relation/rollup/lineNumber")
	databaseKeyAddCmd.Flags().String("icon", "", "key icon (optional)")
	databaseKeyAddCmd.Flags().String("prev", "", "previous key ID for ordering (optional)")

	databaseKeyRemoveCmd.Flags().String("av", "", "attribute view ID (required)")
	databaseKeyRemoveCmd.Flags().String("key", "", "key ID to remove (required)")
	databaseKeyRemoveCmd.Flags().Bool("remove-relation-dest", false, "also remove related data in linked databases")

	databaseCleanCmd.Flags().String("av", "", "single database ID to clean (default: clean all)")

	databaseItemAddCmd.Flags().String("av", "", "attribute view ID (required)")
	databaseItemAddCmd.Flags().String("content", "", "block column text content")
	databaseItemAddCmd.Flags().String("block", "", "block ID to bind (default: auto-generate)")
	databaseItemAddCmd.Flags().String("view", "", "view ID")
	databaseItemAddCmd.Flags().String("group", "", "group ID for positioning")
	databaseItemAddCmd.Flags().String("previous", "", "previous item ID for positioning")
	databaseItemAddCmd.Flags().Bool("detached", false, "create detached row (not bound to a block)")
	databaseItemAddCmd.Flags().Bool("ignore-default-fill", false, "skip filling default values")

	databaseItemRemoveCmd.Flags().String("av", "", "attribute view ID (required)")
	databaseItemRemoveCmd.Flags().String("ids", "", "comma-separated item IDs to remove")

	databaseItemUpdateCmd.Flags().String("av", "", "attribute view ID (required)")
	databaseItemUpdateCmd.Flags().String("key", "", "key ID (required)")
	databaseItemUpdateCmd.Flags().String("item", "", "item ID (required)")
	databaseItemUpdateCmd.Flags().String("value", "", "JSON value for the cell (required)")

	rootCmd.AddCommand(databaseCmd)
	databaseCmd.AddCommand(databaseSearchCmd)
	databaseCmd.AddCommand(databaseGetCmd)
	databaseCmd.AddCommand(databaseRenderCmd)
	databaseCmd.AddCommand(databaseKeysCmd)
	databaseCmd.AddCommand(databaseKeyCmd)
	databaseKeyCmd.AddCommand(databaseKeyAddCmd)
	databaseKeyCmd.AddCommand(databaseKeyRemoveCmd)
	databaseCmd.AddCommand(databaseUnusedCmd)
	databaseCmd.AddCommand(databaseCleanCmd)
	databaseCmd.AddCommand(databaseItemCmd)
	databaseItemCmd.AddCommand(databaseItemAddCmd)
	databaseItemCmd.AddCommand(databaseItemRemoveCmd)
	databaseItemCmd.AddCommand(databaseItemUpdateCmd)
}
