package filesys

import (
	"encoding/json"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 已认证的磁盘属性决定排序依赖，正文和图标等不影响顺序的修改保留已有目录快照。
func beginDocumentTreeWrite(box, documentPath string, before, after []byte, sizeChanged bool) func() {
	var previous, next struct {
		Properties map[string]string
	}
	if json.Unmarshal(before, &previous) != nil || json.Unmarshal(after, &next) != nil ||
		previous.Properties == nil || next.Properties == nil {
		return cache.BeginDocTreeMutation(box)
	}
	changed := func(name string) bool { return previous.Properties[name] != next.Properties[name] }
	change := cache.DocTreeDocumentChange{
		Title: changed("title") || changed(treenode.DocumentTitleEmptyAttr), Updated: changed("updated"), Size: sizeChanged,
		Structure: changed("custom-hidden") || changed("custom-sy-subdoc-sort-mode"),
	}
	return cache.BeginDocTreeDocumentMutation(box, documentPath, change)
}
