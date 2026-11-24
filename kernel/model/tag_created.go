// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"maps"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type tagDates map[string]int64

type blockTagDates struct {
	stored tagDates
	dates  tagDates
}

func readTagDates(raw string) tagDates {
	var dates tagDates
	if raw != "" && json.Unmarshal([]byte(raw), &dates) == nil {
		return dates
	}
	return nil
}

func setTagDates(node *ast.Node, dates tagDates) {
	if len(dates) == 0 {
		node.RemoveIALAttr(treenode.TagCreatedAttr)
		return
	}
	data, _ := json.Marshal(dates)
	node.SetIALAttr(treenode.TagCreatedAttr, string(data))
}

func collectBlockTagDates(root *ast.Node) map[string]blockTagDates {
	blocks := map[string]blockTagDates{}
	add := func(node *ast.Node, label string) {
		if label == "" {
			return
		}
		record := blocks[node.ID]
		if record.dates == nil {
			record = blockTagDates{stored: readTagDates(node.IALAttr(treenode.TagCreatedAttr)), dates: tagDates{}}
			blocks[node.ID] = record
		}
		label = util.UnescapeHTML(label)
		record.dates[label] = record.stored[label]
	}
	treenode.WalkWithInlineTitles(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.Type == ast.NodeDocument {
			for label := range strings.SplitSeq(node.IALAttr("tags"), ",") {
				add(node, label)
			}
		}
		if node.Type == ast.NodeTextMark && node.IsTextMarkType("tag") {
			if owner := treenode.ParentBlock(node); owner != nil {
				add(owner, strings.TrimSuffix(node.Content(), string(gulu.ZWJ)))
			}
		}
		if node.Type == ast.NodeCustomBlock {
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	return blocks
}

func tracksTagDates(operation *Operation) bool {
	switch operation.Action {
	case "create", "setDocTitle", "update", "insert", "append", "appendInsert", "prependInsert", "move", "delete", "convertList":
		return true
	case "setAttrs":
		var attrs map[string]string
		if value, ok := operation.Data.(string); ok && json.Unmarshal([]byte(value), &attrs) == nil {
			for name := range attrs {
				if strings.EqualFold(name, "tags") || name == treenode.TagCreatedAttr {
					return true
				}
			}
		}
	}
	return false
}

func setNodeAttrsWithTagDates(node *ast.Node, attrs map[string]string, box string) (map[string]string, error) {
	var before tagDates
	if node.Type == ast.NodeDocument {
		for name := range attrs {
			if strings.EqualFold(name, "tags") {
				before = collectBlockTagDates(node)[node.ID].dates
				break
			}
		}
	}
	old, err := setNodeAttrsData(node, attrs, box)
	if err == nil && node.Type == ast.NodeDocument && old["tags"] != node.IALAttr("tags") {
		after := collectBlockTagDates(node)[node.ID].dates
		dates := reconcileBlockTagDates(before, after, time.Now().UnixMilli(), false)
		setTagDates(node, dates)
	}
	return old, err
}

func (tx *Transaction) captureTagDates(tree *parse.Tree) {
	if !tx.trackTagDates || IsEncryptedBox(tree.Box) {
		return
	}
	for id, record := range collectBlockTagDates(tree.Root) {
		tx.previousTagDates[id] = record.dates
	}
}

func (tx *Transaction) reconcileTagDates() []string {
	if !tx.trackTagDates {
		return nil
	}
	now := time.Now().UnixMilli()
	var changed []string
	seen := map[string]bool{}
	for _, tree := range tx.trees {
		if IsEncryptedBox(tree.Box) {
			continue
		}
		records := collectBlockTagDates(tree.Root)
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !node.IsBlock() || node.ID == "" || node.Type == ast.NodeKramdownBlockIAL {
				return ast.WalkContinue
			}
			before := tx.previousTagDates[node.ID]
			after := records[node.ID].dates
			raw := node.IALAttr(treenode.TagCreatedAttr)
			replayed, recorded := tx.replayedTagDates[node.ID]
			if len(before) == 0 && len(after) == 0 && raw == "" && !recorded {
				return ast.WalkContinue
			}
			seen[node.ID] = true
			original := before
			if tx.tagDateRename[0] != "" {
				before = renameTagDates(before, tx.tagDateRename[0], tx.tagDateRename[1])
			}
			dates := reconcileBlockTagDates(before, after, now, tx.isReplay)
			// 重放使用历史记录中的关联时间，空记录表示当时的时间未知。
			if recorded {
				for label := range dates {
					delete(dates, label)
				}
				for label := range after {
					if date := replayed[label]; date > 0 {
						dates[label] = date
					}
				}
			}
			if !maps.Equal(dates, readTagDates(raw)) || len(dates) == 0 && raw != "" {
				setTagDates(node, dates)
			}
			if equalRecordedTagDates(original, dates) {
				return ast.WalkContinue
			}
			changed = append(changed, node.ID)
			if !tx.isReplay && len(tx.UndoOperations) > 0 {
				tx.DoOperations = append(tx.DoOperations, tagDatesOperation(node.ID, dates))
				tx.UndoOperations = append(tx.UndoOperations, tagDatesOperation(node.ID, original))
			}
			return ast.WalkContinue
		})
	}
	for id, previous := range tx.previousTagDates {
		if seen[id] || equalRecordedTagDates(previous, nil) {
			continue
		}
		changed = append(changed, id)
		if !tx.isReplay && len(tx.UndoOperations) > 0 {
			tx.UndoOperations = append(tx.UndoOperations, tagDatesOperation(id, previous))
		}
	}
	return changed
}

func reconcileBlockTagDates(before, after tagDates, now int64, replay bool) tagDates {
	dates := tagDates{}
	for label, current := range after {
		previous, existed := before[label]
		switch {
		case replay && !existed:
			previous = current
		case !replay && !existed:
			previous = now
		}
		if previous > 0 {
			dates[label] = previous
		}
	}
	return dates
}

func equalRecordedTagDates(left, right tagDates) bool {
	for label, value := range left {
		if value > 0 && right[label] != value {
			return false
		}
	}
	for label, value := range right {
		if value > 0 && left[label] != value {
			return false
		}
	}
	return true
}

func renameTagDates(dates tagDates, oldLabel, newLabel string) tagDates {
	ret := make(tagDates, len(dates))
	for label, value := range dates {
		if label == oldLabel || strings.HasPrefix(label, oldLabel+"/") {
			label = newLabel + strings.TrimPrefix(label, oldLabel)
		}
		ret[label] = max(ret[label], value)
	}
	return ret
}

func tagDatesOperation(id string, dates tagDates) *Operation {
	recorded := tagDates{}
	for label, value := range dates {
		if value > 0 {
			recorded[label] = value
		}
	}
	var value []byte
	if len(recorded) > 0 {
		value, _ = json.Marshal(recorded)
	}
	data, _ := json.Marshal(map[string]string{treenode.TagCreatedAttr: string(value)})
	return &Operation{Action: "setAttrs", ID: id, Data: string(data), tagDatesReplay: true}
}

func pruneInactiveTagDates(root *ast.Node) []string {
	var records map[string]blockTagDates
	var changed []string
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !node.IsBlock() || node.Type == ast.NodeKramdownBlockIAL || node.ID == "" {
			return ast.WalkContinue
		}
		raw := node.IALAttr(treenode.TagCreatedAttr)
		if raw == "" {
			return ast.WalkContinue
		}
		if records == nil {
			records = collectBlockTagDates(root)
		}
		dates := records[node.ID].dates
		known := reconcileBlockTagDates(dates, dates, 0, true)
		if !maps.Equal(readTagDates(raw), known) || len(known) == 0 {
			setTagDates(node, known)
			changed = append(changed, node.ID)
		}
		return ast.WalkContinue
	})
	return changed
}

func publishTagDateChanges(ids []string) {
	if len(ids) == 0 {
		return
	}
	for _, id := range ids {
		cache.RemoveBlockIAL(id)
	}
	ReloadTag()
}
