package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

// itemKeyValues 组装一个条目的键值：主键（block）+ 一个日期字段。
// itemID 是条目 ID，boundBlockID 是绑定的文档根块 ID —— 自 v3.7.3 起两者不同。
func itemKeyValues(itemID, boundBlockID string, detached bool) []*av.KeyValues {
	blockValue := &av.Value{
		ID: "v-" + itemID, KeyID: "block", BlockID: itemID,
		Type: av.KeyTypeBlock, IsDetached: detached,
		Block: &av.ValueBlock{ID: boundBlockID, Content: itemID},
	}
	return []*av.KeyValues{
		{Key: &av.Key{ID: "block", Type: av.KeyTypeBlock}, Values: []*av.Value{blockValue}},
		{Key: &av.Key{ID: "date", Type: av.KeyTypeDate}, Values: []*av.Value{
			{ID: "d-" + itemID, KeyID: "date", BlockID: itemID, Type: av.KeyTypeDate,
				Date: &av.ValueDate{Content: 1, IsNotEmpty: true}},
		}},
	}
}

// K5: 日历条目就是文档以后，文档被删掉的条目必须从渲染里消失。
// 这里没有初始化 blocktree 库，treenode.ExistBlockTrees 对任何 ID 都返回 false，
// 也就是「绑定的文档都不存在了」这个场景。
func TestFilterNotFoundAttrViewItemsForCalendar(t *testing.T) {
	const (
		boundItemID     = "20260101000000-item001"
		boundBlockID    = "20260101000000-doc001"
		sharedItemA     = "20260101000000-item002"
		sharedItemB     = "20260101000000-item003"
		sharedBlockID   = "20260101000000-doc002"
		detachedItemID  = "20260101000000-item004"
		emptyBlockItem  = "20260101000000-item005"
		noBlockKeyItem  = "20260101000000-item006"
		nilBlockValItem = "20260101000000-item007"
	)

	keyValuesMap := map[string][]*av.KeyValues{
		// 绑定文档已被删除：必须按条目 ID 删除，而不是按绑定块 ID
		boundItemID: itemKeyValues(boundItemID, boundBlockID, false),
		// 两个条目绑定同一篇已删除的文档：两个都要消失
		sharedItemA: itemKeyValues(sharedItemA, sharedBlockID, false),
		sharedItemB: itemKeyValues(sharedItemB, sharedBlockID, false),
		// 游离条目没有文档，永远保留
		detachedItemID: itemKeyValues(detachedItemID, detachedItemID, true),
		// 绑定块 ID 为空 = 数据损坏，去掉
		emptyBlockItem: itemKeyValues(emptyBlockItem, "", false),
		// 没有主键值 = 不是一行，去掉
		noBlockKeyItem: {
			{Key: &av.Key{ID: "date", Type: av.KeyTypeDate}, Values: []*av.Value{
				{ID: "d", KeyID: "date", BlockID: noBlockKeyItem, Type: av.KeyTypeDate},
			}},
		},
		// 主键值的 Block 为 nil，同样不是一行
		nilBlockValItem: {
			{Key: &av.Key{ID: "block", Type: av.KeyTypeBlock}, Values: []*av.Value{
				{ID: "v", KeyID: "block", BlockID: nilBlockValItem, Type: av.KeyTypeBlock},
			}},
		},
	}

	filterNotFoundAttrViewItems(keyValuesMap)

	for _, itemID := range []string{boundItemID, sharedItemA, sharedItemB, emptyBlockItem, noBlockKeyItem, nilBlockValItem} {
		if _, ok := keyValuesMap[itemID]; ok {
			t.Fatalf("item %s whose bound document is gone must not be rendered; "+
				"filterNotFoundAttrViewItems collected the BOUND BLOCK id but deleted by ITEM id, "+
				"and since v3.7.3 those differ, which leaves a permanent ghost event on the calendar", itemID)
		}
	}
	if _, ok := keyValuesMap[detachedItemID]; !ok {
		t.Fatal("a detached item has no document and must always survive the filter")
	}
	if 1 != len(keyValuesMap) {
		t.Fatalf("expected only the detached item to survive, got %d entries", len(keyValuesMap))
	}
}
