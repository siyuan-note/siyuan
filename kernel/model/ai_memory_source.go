package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func memoryDatabasePathID(name string) string {
	const prefix = "/storage/av/"
	if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".json") {
		return ""
	}
	id := strings.TrimSuffix(strings.TrimPrefix(name, prefix), ".json")
	if !ast.IsNodeIDPattern(id) {
		return ""
	}
	return id
}

// 只从已提交的数据库写入日志提取变化，读取和相同字节写入不产生整理任务。
func (tx *Transaction) memoryChangedDatabaseIDs() []string {
	ids := map[string]bool{}
	collect := func(file *documentSourceFile) {
		if file == nil || file.Kind != "database" || file.Box != "" || bytes.Equal(file.Before, file.After) {
			return
		}
		if id := memoryDatabasePathID(file.Path); id != "" {
			ids[id] = true
		}
	}
	if tx.sourceJournal != nil {
		for _, file := range tx.sourceJournal.Files {
			collect(file)
		}
	}
	for _, file := range tx.sourceDatabaseBefore {
		collect(file)
	}
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

var memoryDatabaseQueue = struct {
	sync.Mutex
	workspace string
	ids       map[string]bool
	timer     *time.Timer
}{ids: map[string]bool{}}

// 数据库文件变更只复核已有记忆引用的来源，不把整张表或所有笔记提交给模型。
func QueueAIMemoryDatabaseSources(ids []string) {
	if len(ids) == 0 || Conf == nil || util.ReadOnly || util.IsDisabledFeature("ai") {
		return
	}
	workspace := util.DataDir
	memoryDatabaseQueue.Lock()
	defer memoryDatabaseQueue.Unlock()
	if memoryDatabaseQueue.workspace != workspace {
		memoryDatabaseQueue.workspace = workspace
		memoryDatabaseQueue.ids = map[string]bool{}
	}
	for _, id := range ids {
		if ast.IsNodeIDPattern(id) {
			memoryDatabaseQueue.ids[id] = true
		}
	}
	if len(memoryDatabaseQueue.ids) == 0 {
		return
	}
	if memoryDatabaseQueue.timer != nil {
		memoryDatabaseQueue.timer.Stop()
	}
	memoryDatabaseQueue.timer = time.AfterFunc(1500*time.Millisecond, func() {
		memoryDatabaseQueue.Lock()
		if memoryDatabaseQueue.workspace != workspace || util.DataDir != workspace {
			memoryDatabaseQueue.Unlock()
			return
		}
		pending := memoryDatabaseQueue.ids
		memoryDatabaseQueue.ids = map[string]bool{}
		memoryDatabaseQueue.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		sources, err := memoryDatabaseSourceIDs(ctx, workspace, pending)
		if util.DataDir != workspace || Conf == nil {
			return
		}
		if err != nil {
			recordAIMemoryFailure("database-source-change:"+ast.NewNodeID(), err)
			return
		}
		if len(sources) > 0 {
			QueueAIMemorySources(sources)
		}
	})
}

func memoryDatabaseSourceIDs(ctx context.Context, workspace string, databaseIDs map[string]bool) ([]string, error) {
	ids := map[string]bool{}
	err := memoryExistingSources(ctx, workspace, func(source memo.Source) {
		var evidence struct {
			Databases []struct {
				ID string `json:"id"`
			} `json:"databases"`
		}
		if json.Unmarshal([]byte(source.Evidence), &evidence) != nil {
			return
		}
		for _, database := range evidence.Databases {
			if databaseIDs[database.ID] {
				ids[source.ID] = true
			}
		}
	})
	if err != nil {
		return nil, err
	}
	return memorySortedSourceIDs(ids), nil
}

// 文档变更保留原始事件，并补入该文档内已有记忆引用的小子树；不回扫笔记库。
func memoryAffectedSourceIDs(ctx context.Context, workspace string, pending []string) ([]string, error) {
	ids := map[string]bool{}
	for _, id := range pending {
		if ast.IsNodeIDPattern(id) {
			ids[id] = true
		}
	}
	roots := map[string]bool{}
	for id := range ids {
		roots[id] = true
	}
	err := memoryExistingSources(ctx, workspace, func(source memo.Source) {
		bt := treenode.GetBlockTree(source.ID)
		if bt != nil && roots[bt.RootID] && !IsEncryptedBox(bt.BoxID) {
			ids[source.ID] = true
		}
	})
	if err != nil {
		return nil, err
	}
	return memorySortedSourceIDs(ids), nil
}

func memoryExistingSources(ctx context.Context, workspace string, visit func(memo.Source)) error {
	store := memo.NewStore(workspace)
	for offset := 0; ; {
		page, err := store.Search(ctx, memo.SearchOptions{States: []string{"active", "candidate", "review"}, IncludeInactiveValidity: true, Limit: 100, Offset: offset})
		if err != nil {
			return err
		}
		if len(page.Errors) > 0 {
			return memo.ErrIncomplete
		}
		for _, entry := range page.Entries {
			for _, source := range entry.Record.Sources {
				if source.Kind != "block" || !ast.IsNodeIDPattern(source.ID) {
					continue
				}
				visit(source)
			}
		}
		if !page.Incomplete {
			break
		}
		if len(page.Entries) == 0 {
			return memo.ErrIncomplete
		}
		offset += len(page.Entries)
	}
	return nil
}

func memorySortedSourceIDs(ids map[string]bool) []string {
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

type memoryNativeField struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Type     av.KeyType `json:"type"`
	Value    *av.Value  `json:"value,omitempty"`
	Excluded bool       `json:"excluded,omitempty"`
}
type memoryNativeRow struct {
	BlockID string              `json:"blockID"`
	Fields  []memoryNativeField `json:"fields"`
}
type memoryNativeDatabase struct {
	ID                string              `json:"id"`
	Name              string              `json:"name"`
	Fields            []memoryNativeField `json:"fields"`
	Rows              []memoryNativeRow   `json:"rows"`
	OtherRowsExcluded bool                `json:"otherRowsExcluded"`
}

// memoryNativeEvidence 仅附加来源子树内绑定行的类型化值，不展开其他文档或关联汇总内容。
// 预算不足返回错误，不能把未处理的数据库伪装成完整原文。
func memoryNativeEvidence(tree *parse.Tree, node *ast.Node) ([]byte, error) {
	if tree == nil || node == nil || tree.Box == "" || IsEncryptedBox(tree.Box) {
		return nil, errors.New("memory native source unavailable")
	}
	ids := map[string]bool{}
	databases := map[string]bool{}
	nodes := 0
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		nodes++
		if nodes > 2048 {
			return ast.WalkStop
		}
		if n.ID != "" {
			ids[n.ID] = true
		}
		if n.Type == ast.NodeAttributeView && n.AttributeViewID != "" {
			databases[n.AttributeViewID] = true
		}
		for _, id := range strings.Split(n.IALAttr(av.NodeAttrNameAvs), ",") {
			if id != "" {
				databases[id] = true
			}
		}
		return ast.WalkContinue
	})
	if nodes > 2048 || len(databases) > 16 {
		return nil, errors.New("memory native source exceeds processing budget")
	}
	names := make([]string, 0, len(databases))
	for id := range databases {
		names = append(names, id)
	}
	sort.Strings(names)
	// Node 的 Tokens/Type/FirstChild 不直接参与 JSON 编码；使用原生 .sy
	// 渲染器投影当前 AST。渲染器会修改临时字段，因此只能操作独立子树副本。
	engine := util.NewLute()
	nativeNode := render.NewJSONRenderer(&parse.Tree{Root: cloneRenderNode(node)}, engine.RenderOptions, engine.ParseOptions).Render()
	result := struct {
		Node      json.RawMessage        `json:"node"`
		Databases []memoryNativeDatabase `json:"databases"`
	}{Node: nativeNode, Databases: []memoryNativeDatabase{}}
	for _, id := range names {
		if !ast.IsNodeIDPattern(id) {
			return nil, errors.New("invalid memory database reference")
		}
		// 普通来源只读取全局普通 AV 文件，不使用可能扫描已解锁加密笔记本的 fallback。
		raw, err := memorySyncRead(util.DataDir, "/storage/av/"+id+".json")
		if err != nil {
			return nil, fmt.Errorf("memory database source unavailable: %w", err)
		}
		var database av.AttributeView
		if err = json.Unmarshal(raw, &database); err != nil || database.ID != id || database.Spec > av.CurrentSpec {
			return nil, errors.New("invalid memory database source")
		}
		evidence, err := memoryDatabaseEvidence(&database, ids)
		if err != nil {
			return nil, err
		}
		result.Databases = append(result.Databases, evidence)
	}
	data, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if len(data) > 64*1024 {
		return nil, errors.New("memory native source exceeds processing budget")
	}
	return data, nil
}

func memoryDatabaseEvidence(database *av.AttributeView, sourceIDs map[string]bool) (memoryNativeDatabase, error) {
	ret := memoryNativeDatabase{ID: database.ID, Name: database.Name, Fields: []memoryNativeField{}, Rows: []memoryNativeRow{}, OtherRowsExcluded: true}
	if len(database.KeyValues) > 128 {
		return ret, errors.New("memory database columns exceed processing budget")
	}
	for _, kv := range database.KeyValues {
		if kv == nil || kv.Key == nil {
			return ret, errors.New("invalid memory database column")
		}
		for _, value := range kv.Values {
			if value == nil || value.Type != kv.Key.Type || (value.Type == av.KeyTypeBlock && value.Block == nil) {
				return ret, errors.New("invalid memory database value")
			}
		}
		ret.Fields = append(ret.Fields, memoryNativeField{ID: kv.Key.ID, Name: kv.Key.Name, Type: kv.Key.Type})
	}
	ids := make([]string, 0, len(sourceIDs))
	for id := range sourceIDs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		block := database.GetBlockValueByBoundID(id)
		if block == nil {
			continue
		}
		if block.IsDetached || block.Block == nil || block.Block.ID != id {
			continue
		}
		row := memoryNativeRow{BlockID: id, Fields: []memoryNativeField{}}
		for _, kv := range database.KeyValues {
			value := kv.GetValue(block.BlockID)
			if value == nil {
				continue
			}
			field := memoryNativeField{ID: kv.Key.ID, Name: kv.Key.Name, Type: kv.Key.Type}
			// 关联、汇总、模板及未知类型可能包含其他来源的缓存明文，明确排除而不加载关联表。
			switch value.Type {
			case av.KeyTypeBlock, av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect, av.KeyTypeURL, av.KeyTypeEmail, av.KeyTypePhone, av.KeyTypeLocation, av.KeyTypeMAsset, av.KeyTypeCreated, av.KeyTypeUpdated, av.KeyTypeCheckbox:
				field.Value = memoryNativeValue(value)
			default:
				field.Excluded = true
			}
			row.Fields = append(row.Fields, field)
		}
		ret.Rows = append(ret.Rows, row)
		if len(ret.Rows) > 128 {
			return ret, errors.New("memory database rows exceed processing budget")
		}
	}
	return ret, nil
}

// memoryNativeValue 仅复制所声明类型的值，不传递缓存渲染或不匹配类型的字段。
func memoryNativeValue(value *av.Value) *av.Value {
	ret := &av.Value{ID: value.ID, KeyID: value.KeyID, BlockID: value.BlockID, Type: value.Type, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
	switch value.Type {
	case av.KeyTypeBlock:
		ret.Block = value.Block
	case av.KeyTypeText:
		ret.Text = value.Text
	case av.KeyTypeNumber:
		ret.Number = value.Number
	case av.KeyTypeDate:
		ret.Date = value.Date
	case av.KeyTypeSelect, av.KeyTypeMSelect:
		ret.MSelect = value.MSelect
	case av.KeyTypeURL:
		ret.URL = value.URL
	case av.KeyTypeEmail:
		ret.Email = value.Email
	case av.KeyTypePhone:
		ret.Phone = value.Phone
	case av.KeyTypeLocation:
		ret.Location = value.Location
	case av.KeyTypeMAsset:
		ret.MAsset = value.MAsset
	case av.KeyTypeCreated:
		ret.Created = value.Created
	case av.KeyTypeUpdated:
		ret.Updated = value.Updated
	case av.KeyTypeCheckbox:
		ret.Checkbox = value.Checkbox
	}
	return ret
}
