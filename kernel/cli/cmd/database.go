// SiYuan - From thought to insight, with agents
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
			return printJSON(results)
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
			return printJSON(model.NewAttributeViewMetadata(attrView))
		default:
			printDatabaseMetadata(attrView)
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

		viewable, attrView, err := model.RenderAttributeView("", avID, viewID, query, page, size, nil, false, false)
		if err != nil {
			return err
		}

		switch outputFormat {
		case "json":
			return printJSON(model.NewAttributeViewRenderData(attrView, viewable, query, page, size))
		default:
			printRenderedDatabase(attrView, viewable)
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
			return printJSON(model.NewAttributeViewKeys(attrView))
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
		if err := model.AddAttributeViewKey(avID, "", keyID, name, keyType, icon, prev, av.DateDisplayFormatFull); err != nil {
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
			return printJSON(map[string]any{"count": len(items), "items": items})
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

		if err := model.AddAttributeViewBlock(nil, srcs, avID, "", viewID, groupID, previousID, ignoreFill); err != nil {
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
	fmt.Fprintln(w, "ID\tNAME\tTYPE\tICON\tOPTIONS")
	for _, kv := range attrView.KeyValues {
		if nil == kv || nil == kv.Key {
			continue
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", kv.Key.ID, kv.Key.Name, kv.Key.Type, kv.Key.Icon,
			strings.Join(databaseOptionNames(kv.Key.Options), ", "))
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

func printJSON(value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if nil != err {
		return err
	}
	fmt.Println(string(data))
	return nil
}

func printDatabaseMetadata(attrView *av.AttributeView) {
	fmt.Printf("ID:    %s\n", attrView.ID)
	fmt.Printf("Name:  %s\n", attrView.Name)
	fmt.Printf("Keys:  %d  Views: %d\n\n", len(attrView.KeyValues), len(attrView.Views))
	printKeyTable(attrView)

	if 0 == len(attrView.Views) {
		return
	}
	fmt.Println()
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "VIEW_ID\tNAME\tTYPE\tPAGE_SIZE")
	for _, view := range attrView.Views {
		if nil != view {
			fmt.Fprintf(w, "%s\t%s\t%s\t%d\n", view.ID, view.Name, view.LayoutType, view.PageSize)
		}
	}
	w.Flush()
}

func databaseOptionNames(options []*av.SelectOption) (ret []string) {
	for _, option := range options {
		if nil != option {
			ret = append(ret, option.Name)
		}
	}
	return
}

func printRenderedDatabase(attrView *av.AttributeView, viewable av.Viewable) {
	if nil == attrView || nil == viewable {
		fmt.Println("(empty)")
		return
	}

	fmt.Printf("%s (%s)\n", attrView.Name, viewable.GetType())
	count := writeRenderedView(os.Stdout, attrView, viewable, false)
	fmt.Printf("\n%d item(s)\n", count)
}

func writeRenderedView(writer io.Writer, attrView *av.AttributeView, viewable av.Viewable, grouped bool) (count int) {
	base := databaseViewBase(viewable)
	if nil != base && 0 < len(base.Groups) {
		for _, group := range base.Groups {
			if nil == group || 0 != group.GetGroupHidden() {
				continue
			}
			groupBase := databaseViewBase(group)
			groupName := group.GetID()
			if nil != groupBase && "" != groupBase.Name {
				groupName = groupBase.Name
			}
			fmt.Fprintf(writer, "\n[%s]\n", groupName)
			count += writeRenderedView(writer, attrView, group, true)
		}
		return
	}

	collection, ok := viewable.(av.Collection)
	if !ok {
		return
	}
	fields := visibleDatabaseFields(collection.GetFields())
	w := tabwriter.NewWriter(writer, 0, 0, 2, ' ', 0)
	fmt.Fprint(w, "ITEM_ID\t")
	for _, field := range fields {
		fmt.Fprintf(w, "%s\t", databaseFieldName(attrView, field))
	}
	fmt.Fprintln(w)
	for _, item := range collection.GetItems() {
		if nil == item {
			continue
		}
		fmt.Fprintf(w, "%s\t", item.GetID())
		for _, field := range fields {
			fmt.Fprintf(w, "%s\t", databaseDisplayValue(item.GetValue(field.GetID())))
		}
		fmt.Fprintln(w)
		count++
	}
	w.Flush()
	if grouped && 0 == count {
		fmt.Fprintln(writer, "(empty)")
	}
	return
}

func databaseViewBase(viewable av.Viewable) (ret *av.BaseInstance) {
	switch view := viewable.(type) {
	case *av.Table:
		ret = view.BaseInstance
	case *av.Gallery:
		ret = view.BaseInstance
	case *av.Kanban:
		ret = view.BaseInstance
	}
	return
}

func visibleDatabaseFields(fields []av.Field) (ret []av.Field) {
	for _, field := range fields {
		if nil != field && !databaseFieldHidden(field) {
			ret = append(ret, field)
		}
	}
	return
}

func databaseFieldHidden(field av.Field) bool {
	switch typed := field.(type) {
	case *av.TableColumn:
		return typed.Hidden
	case *av.GalleryField:
		return typed.Hidden
	case *av.KanbanField:
		return typed.Hidden
	}
	return false
}

func databaseFieldName(attrView *av.AttributeView, field av.Field) string {
	if nil != attrView {
		if key, err := attrView.GetKey(field.GetID()); nil == err && nil != key && "" != key.Name {
			return key.Name
		}
	}
	return field.GetID()
}

func databaseDisplayValue(value *av.Value) string {
	content := value.String(true)
	content = strings.NewReplacer("\t", " ", "\r", " ", "\n", " ").Replace(content)
	return truncate(content, 80)
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
	databaseKeyAddCmd.Flags().String("type", "", "key type (required): text/number/date/select/mSelect/url/email/phone/mAsset/template/created/updated/checkbox/relation/rollup/lineNumber")
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
