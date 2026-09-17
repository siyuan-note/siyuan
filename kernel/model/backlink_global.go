package model

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const GlobalBacklinkPageSize = 50
const globalBacklinkSnapshotLimit = 16
const globalBacklinkSnapshotTTL = 5 * time.Minute

type GlobalBacklinkQuery struct {
	ID, Notebook, Keyword string
	Sort                  int
	ContainChildren       bool
	SourceFilter          *BacklinkSourceFilter
}

type GlobalBacklinkItem struct {
	ID, RootID, Box, HPath, Anchor string
	order                          int
}

// 快照只保存排序所需的轻量元数据，不保存正文；锁定笔记本时立即清除。
type globalBacklinkLocation struct{ ID, RootID, Box, Anchor string }
type globalBacklinkSnapshot struct {
	key     string
	box     string
	created time.Time
	items   []globalBacklinkLocation
	bytes   int
}

var globalBacklinkSnapshots = struct {
	sync.Mutex
	values map[string]*globalBacklinkSnapshot
}{values: map[string]*globalBacklinkSnapshot{}}

func ClearGlobalBacklinkSnapshots(boxID string) {
	globalBacklinkSnapshots.Lock()
	defer globalBacklinkSnapshots.Unlock()
	for token, snapshot := range globalBacklinkSnapshots.values {
		if snapshot.box == boxID {
			delete(globalBacklinkSnapshots.values, token)
			continue
		}
		for _, item := range snapshot.items {
			if item.Box == boxID {
				delete(globalBacklinkSnapshots.values, token)
				break
			}
		}
	}
}

func globalBacklinkQueryKey(query GlobalBacklinkQuery) string {
	query.Keyword = strings.TrimSpace(query.Keyword)
	query.SourceFilter = NormalizeBacklinkSourceFilter(query.SourceFilter)
	data, _ := json.Marshal(query)
	return util.DataDir + ":" + string(data)
}

func globalBacklinkSnapshotGet(query GlobalBacklinkQuery, token string, accessible func(string) bool) *globalBacklinkSnapshot {
	globalBacklinkSnapshots.Lock()
	snapshot := globalBacklinkSnapshots.values[token]
	if snapshot != nil && time.Since(snapshot.created) > globalBacklinkSnapshotTTL {
		delete(globalBacklinkSnapshots.values, token)
		snapshot = nil
	}
	globalBacklinkSnapshots.Unlock()
	if snapshot == nil || snapshot.key != globalBacklinkQueryKey(query) {
		return nil
	}
	checked := map[string]bool{}
	for _, item := range snapshot.items {
		if !checked[item.RootID] {
			if !accessible(item.RootID) || treenode.GetBlockTreeInBox(item.RootID, query.Notebook) == nil {
				return nil
			}
			checked[item.RootID] = true
		}
	}
	return snapshot
}

func globalBacklinkSnapshotPut(query GlobalBacklinkQuery, items []*GlobalBacklinkItem) (string, *globalBacklinkSnapshot, error) {
	var random [24]byte
	if _, err := rand.Read(random[:]); err != nil {
		panic(err)
	}
	token := hex.EncodeToString(random[:])
	snapshot := &globalBacklinkSnapshot{key: globalBacklinkQueryKey(query), box: query.Notebook, created: time.Now()}
	for _, item := range items {
		snapshot.bytes += len(item.ID) + len(item.RootID) + len(item.Box) + len(item.Anchor) + 128
		if snapshot.bytes > 64<<20 {
			return "", nil, fmt.Errorf("backlink snapshot exceeds memory limit")
		}
		snapshot.items = append(snapshot.items, globalBacklinkLocation{item.ID, item.RootID, item.Box, item.Anchor})
	}
	globalBacklinkSnapshots.Lock()
	defer globalBacklinkSnapshots.Unlock()
	for key, value := range globalBacklinkSnapshots.values {
		if time.Since(value.created) > globalBacklinkSnapshotTTL {
			delete(globalBacklinkSnapshots.values, key)
		}
	}
	for {
		bytes := snapshot.bytes
		for _, value := range globalBacklinkSnapshots.values {
			bytes += value.bytes
		}
		if len(globalBacklinkSnapshots.values) < globalBacklinkSnapshotLimit && bytes <= 64<<20 {
			break
		}
		oldest := ""
		for key, value := range globalBacklinkSnapshots.values {
			if oldest == "" || value.created.Before(globalBacklinkSnapshots.values[oldest].created) {
				oldest = key
			}
		}
		delete(globalBacklinkSnapshots.values, oldest)
	}
	globalBacklinkSnapshots.values[token] = snapshot
	return token, snapshot, nil
}

// 同一引用块只产生一个条目，按正文遍历选择首个命中的行内引用。
func globalBacklinkAnchor(node *ast.Node, targets map[string]bool) string {
	text := ""
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n != node && n.IsBlock() {
			return ast.WalkSkipChildren
		}
		id, anchor, _ := treenode.GetBlockRef(n)
		if id != "" && targets[id] {
			text = strings.TrimSpace(anchor)
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return text
}

func collectGlobalBacklinks(query GlobalBacklinkQuery, accessible func(string) bool) ([]*GlobalBacklinkItem, error) {
	definition := sql.GetBlockInBox(query.ID, query.Notebook)
	if definition == nil {
		return []*GlobalBacklinkItem{}, nil
	}
	refs := sql.QueryRefsByDefIDInBox(query.ID, query.ContainChildren, query.Notebook)
	targets := map[string]map[string]bool{}
	var ids []string
	for _, ref := range refs {
		if targets[ref.BlockID] == nil {
			targets[ref.BlockID] = map[string]bool{}
			ids = append(ids, ref.BlockID)
		}
		targets[ref.BlockID][ref.DefBlockID] = true
	}
	var blocks []*Block
	for start := 0; start < len(ids); start += 512 {
		for _, block := range sql.GetBlocksInBox(ids[start:min(start+512, len(ids))], query.Notebook) {
			if block != nil && accessible(block.RootID) {
				value := fromSQLBlock(block, "", 0)
				if matchBacklinkKeyword(value, strings.Fields(query.Keyword)) {
					blocks = append(blocks, value)
				}
			}
		}
	}
	blocks = filterBacklinkSourcesInBox(blocks, definition.RootID, query.Notebook, query.SourceFilter)
	byRoot := map[string]map[string]*Block{}
	for _, block := range blocks {
		if byRoot[block.RootID] == nil {
			byRoot[block.RootID] = map[string]*Block{}
		}
		byRoot[block.RootID][block.ID] = block
	}
	items := []*GlobalBacklinkItem{}
	for rootID, selected := range byRoot {
		tree, err := loadTreeByBlockIDInBox(rootID, query.Notebook)
		if err != nil {
			return nil, err
		}
		order := 0
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}
			order++
			if block := selected[n.ID]; block != nil {
				items = append(items, &GlobalBacklinkItem{ID: n.ID, RootID: rootID, Box: block.Box, HPath: block.HPath, Anchor: globalBacklinkAnchor(n, targets[n.ID]), order: order})
			}
			return ast.WalkContinue
		})
	}
	sort.Slice(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if a.Anchor == "" && b.Anchor != "" {
			return false
		}
		if a.Anchor != "" && b.Anchor == "" {
			return true
		}
		less, greater := util.NaturalCompare(a.Anchor, b.Anchor), util.NaturalCompare(b.Anchor, a.Anchor)
		if less != greater {
			if query.Sort == 2 {
				return greater
			}
			return less
		}
		if a.RootID != b.RootID {
			return a.RootID < b.RootID
		}
		if a.order != b.order {
			return a.order < b.order
		}
		return a.ID < b.ID
	})
	return items, nil
}

func GetGlobalBacklinks(query GlobalBacklinkQuery, token string, offset int, anchorID string, accessible func(string) bool) (snapshotID string, items []*GlobalBacklinkItem, total, start int, expired bool, err error) {
	items = []*GlobalBacklinkItem{}
	var snapshot *globalBacklinkSnapshot
	var initial []*GlobalBacklinkItem
	if token == "" {
		initial, err = collectGlobalBacklinks(query, accessible)
		if err != nil {
			return
		}
		token, snapshot, err = globalBacklinkSnapshotPut(query, initial)
		if err != nil {
			return
		}
	} else {
		snapshot = globalBacklinkSnapshotGet(query, token, accessible)
		if snapshot == nil {
			expired = true
			return
		}
	}
	if anchorID != "" {
		for i, item := range snapshot.items {
			if item.ID == anchorID {
				offset = i / GlobalBacklinkPageSize * GlobalBacklinkPageSize
				break
			}
		}
	}
	total = len(snapshot.items)
	start = min(max(offset, 0), max(total-1, 0)) / GlobalBacklinkPageSize * GlobalBacklinkPageSize
	end := min(start+GlobalBacklinkPageSize, total)
	snapshotID = token
	if initial != nil {
		items = initial[start:end]
		return
	}
	for _, location := range snapshot.items[start:end] {
		block := sql.GetBlockInBox(location.ID, query.Notebook)
		if block == nil || block.RootID != location.RootID || block.Box != location.Box {
			expired = true
			items = []*GlobalBacklinkItem{}
			return
		}
		items = append(items, &GlobalBacklinkItem{ID: location.ID, RootID: location.RootID, Box: location.Box, HPath: block.HPath, Anchor: location.Anchor})
	}
	return
}

func GetGlobalBacklinkContexts(query GlobalBacklinkQuery, token string, ids []string, accessible func(string) bool) (items []*Backlink, expired bool, err error) {
	items = []*Backlink{}
	snapshot := globalBacklinkSnapshotGet(query, token, accessible)
	if snapshot == nil {
		return items, true, nil
	}
	allowed := map[string]globalBacklinkLocation{}
	for _, item := range snapshot.items {
		allowed[item.ID] = item
	}
	trees := map[string]*parse.Tree{}
	for _, id := range uniqueBacklinkStrings(ids) {
		location, ok := allowed[id]
		if !ok {
			return nil, false, fmt.Errorf("block is outside backlink snapshot")
		}
		block := sql.GetBlockInBox(id, query.Notebook)
		if block == nil || block.RootID != location.RootID || block.Box != location.Box {
			return items, true, nil
		}
		tree := trees[location.RootID]
		if tree == nil {
			tree, err = loadTreeByBlockIDInBox(location.RootID, query.Notebook)
			if err != nil {
				return nil, false, err
			}
			trees[location.RootID] = tree
		}
		node := treenode.GetNodeInTree(tree, id)
		if node == nil {
			return items, true, nil
		}
		// 只渲染条目自身，父级通过面包屑按需展开，不将兄弟引用合并进当前条目。
		nodes := []*ast.Node{node}
		fillBlockRefCount(nodes, tree.Box)
		item := &Backlink{ID: id, Type: node.Type.String(), node: node, Expand: true, BlockPaths: buildBlockBreadcrumb(node, nil, false), DOM: renderVisibleBlockDOMByNodes(nodes, util.NewLute())}
		if node.Type == ast.NodeAttributeView {
			refs := sql.QueryRefsByDefIDInBox(query.ID, query.ContainChildren, query.Notebook)
			appendBacklinkAttributeViewTargets(item, nodes, backlinkAttributeViewTargets(tree, refs))
		}
		items = append(items, item)
	}
	return
}
