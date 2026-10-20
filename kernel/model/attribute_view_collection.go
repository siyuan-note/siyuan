package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type attributeViewCollectionState struct {
	checked   map[string]bool
	before    map[string]*parse.Tree
	views     map[string]*av.AttributeView
	running   bool
	err       error
	requested map[string]map[string][]string
}

func collectionScopeMatches(source *av.AutomationBlockSource, tree *parse.Tree) bool {
	if source == nil || tree == nil {
		return false
	}
	if slices.Contains(source.NotebookIDs, tree.Box) {
		return true
	}
	for _, id := range source.DocumentIDs {
		if tree.ID == id || strings.Contains(tree.Path, "/"+id+"/") {
			return true
		}
	}
	return false
}

func collectionBlockConditionsMatch(source *av.AutomationBlockSource, node *ast.Node) bool {
	if len(source.Types) > 0 {
		typ := treenode.TypeAbbr(node.Type.String())
		matched := slices.Contains(source.Types, typ)
		if !matched && (typ == "h" || typ == "callout" || (typ == "l" || typ == "i") && node.ListData != nil) {
			matched = slices.Contains(source.Types, typ+":"+treenode.SubTypeAbbr(node))
		}
		if !matched {
			return false
		}
	}
	return collectionConditionsMatch(source.Attributes, source.AttributeMatch, func(attr *av.AutomationBlockAttribute) bool {
		return collectionAttributeMatches(attr, node)
	})
}

func collectionTagsMatch(source *av.AutomationBlockSource, root *ast.Node) bool {
	if root == nil {
		return false
	}
	tags := map[string]bool{}
	if root.Type == ast.NodeDocument {
		for tag := range strings.SplitSeq(root.IALAttr("tags"), ",") {
			tags[strings.Trim(strings.TrimSpace(tag), "#")] = true
		}
	}
	ast.Walk(root, func(current *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if current != root && current.IsBlock() {
			return ast.WalkSkipChildren
		}
		if current.Type == ast.NodeTag || current.Type == ast.NodeTextMark && current.IsTextMarkType("tag") {
			tags[strings.TrimSpace(current.Content())] = true
		}
		return ast.WalkContinue
	})
	return collectionConditionsMatch(source.Tags, source.TagMatch, func(tag string) bool {
		return tags[strings.Trim(strings.TrimSpace(tag), "#")]
	})
}

// 先匹配标签来源，再选择唯一的合格对象；类型和属性始终约束最终收集对象。
func collectionMatches(source *av.AutomationBlockSource, tree *parse.Tree) map[string]bool {
	ret := map[string]bool{}
	if !collectionScopeMatches(source, tree) {
		return ret
	}
	var containers []*ast.Node
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			if len(containers) > 0 && containers[len(containers)-1] == node {
				containers = containers[:len(containers)-1]
			}
			return ast.WalkContinue
		}
		if !node.IsBlock() || !ast.IsNodeIDPattern(node.ID) {
			return ast.WalkContinue
		}
		if len(source.Tags) == 0 {
			if collectionBlockConditionsMatch(source, node) {
				ret[node.ID] = true
			}
			return ast.WalkContinue
		}
		if source.TagTarget == "container" && node.IsContainerBlock() &&
			(node.Type != ast.NodeDocument || slices.Contains(source.Types, "d")) &&
			collectionBlockConditionsMatch(source, node) {
			containers = append(containers, node)
		}
		if !collectionTagsMatch(source, node) {
			return ast.WalkContinue
		}
		var target *ast.Node
		switch source.TagTarget {
		case "container":
			if len(containers) > 0 {
				target = containers[len(containers)-1]
			}
		case "block":
			if collectionBlockConditionsMatch(source, node) {
				target = node
			}
		default:
			parent := node.Parent
			if parent != nil && parent.Type == ast.NodeListItem && treenode.FirstLeafBlock(parent) == node &&
				collectionBlockConditionsMatch(source, parent) {
				target = parent
			} else if collectionBlockConditionsMatch(source, node) {
				target = node
			}
		}
		if target != nil && ast.IsNodeIDPattern(target.ID) {
			ret[target.ID] = true
		}
		return ast.WalkContinue
	})
	return ret
}

// 条件组为空时不限制，缺省保持全部匹配；不同条件组仍由调用方取交集。
func collectionConditionsMatch[T any](values []T, mode string, matches func(T) bool) bool {
	if len(values) == 0 {
		return true
	}
	if mode == "or" {
		return slices.ContainsFunc(values, matches)
	}
	return !slices.ContainsFunc(values, func(value T) bool { return !matches(value) })
}

func collectionAttributeMatches(attr *av.AutomationBlockAttribute, node *ast.Node) bool {
	if attr == nil {
		return false
	}
	value, present := "", false
	for _, pair := range node.KramdownIAL {
		if len(pair) == 2 && pair[0] == attr.Name {
			value, present = util.UnescapeHTML(pair[1]), true
			break
		}
	}
	switch attr.Operator {
	case "equals":
		return present && value == attr.Value
	case "contains":
		return present && strings.Contains(value, attr.Value)
	case "exists":
		return present
	case "notExists":
		return !present
	}
	return false
}

func (tx *Transaction) validateBlockCollectionRule(view *av.AttributeView, rule *av.AutomationRule, boxID string) error {
	source := rule.BlockSource
	if source == nil || len(source.NotebookIDs)+len(source.DocumentIDs) == 0 ||
		len(source.NotebookIDs)+len(source.DocumentIDs) > 100 || len(source.Tags) > 20 || len(source.Attributes) > 20 ||
		len(rule.Conditions) != 0 || rule.KeyID != "" || len(rule.Actions) != 1 {
		return fmt.Errorf("invalid block collection source")
	}
	if !slices.Contains([]string{"", "and", "or"}, source.TagMatch) ||
		!slices.Contains([]string{"", "and", "or"}, source.AttributeMatch) ||
		!slices.Contains([]string{"", "block", "container"}, source.TagTarget) {
		return fmt.Errorf("invalid block collection match mode")
	}
	for _, id := range source.NotebookIDs {
		if !ast.IsNodeIDPattern(id) || Conf.Box(id) == nil || !IsSameCryptoBoundary(boxID, id) {
			return fmt.Errorf("invalid block collection notebook [%s]", id)
		}
	}
	for _, id := range source.DocumentIDs {
		bt := attributeViewBindingBlockTree(id, boxID)
		if bt == nil || bt.Type != "d" {
			return fmt.Errorf("invalid block collection document [%s]", id)
		}
	}
	for _, typ := range source.Types {
		if !av.IsAutomationBlockType(typ) {
			return fmt.Errorf("invalid block collection type [%s]", typ)
		}
	}
	for _, tag := range source.Tags {
		if strings.Trim(strings.TrimSpace(tag), "#") == "" {
			return fmt.Errorf("empty collection tag")
		}
	}
	for _, attr := range source.Attributes {
		if attr == nil || !strings.HasPrefix(attr.Name, "custom-") || len(attr.Name) <= len("custom-") ||
			len(attr.Name) > 256 || !isValidAttrName(attr.Name) ||
			!slices.Contains([]string{"equals", "contains", "exists", "notExists"}, attr.Operator) {
			return fmt.Errorf("invalid collection attribute")
		}
	}
	action := rule.Actions[0]
	if action == nil || action.Type != "collect" || action.Target != "current" || action.AvID != "" || action.RelationKeyID != "" || len(action.Filters) != 0 {
		return fmt.Errorf("invalid block collection action")
	}
	for keyID, value := range action.Fields {
		key, err := view.GetKey(keyID)
		if err != nil || key.Type == av.KeyTypeBlock || !av.AutomationEditableKey(key.Type) || value == nil {
			return unavailableAutomationReference("fields", keyID, fmt.Sprintf("invalid collection field [%s]", keyID))
		}
		if value.Mode == "currentTime" && key.Type == av.KeyTypeDate {
			continue
		}
		if value.Mode == "template" {
			if err = av.ValidateAutomationTemplate(value.Template, rule.TimeZone); err != nil {
				return err
			}
			continue
		}
		if value.Mode != "static" || value.Value == nil || value.Value.Type != key.Type {
			return unavailableAutomationReference("fields", keyID, fmt.Sprintf("invalid collection field value [%s]", keyID))
		}
	}
	return nil
}

func (tx *Transaction) collectionState() *attributeViewCollectionState {
	if tx.attributeViewCollections == nil {
		tx.attributeViewCollections = &attributeViewCollectionState{checked: map[string]bool{}, before: map[string]*parse.Tree{},
			views: map[string]*av.AttributeView{}, requested: map[string]map[string][]string{}}
	}
	return tx.attributeViewCollections
}

// 在首次读取文档时记录修改前快照。自动动作及重放不再次产生块事件。
func (tx *Transaction) captureCollectionTree(tree *parse.Tree) (captureErr error) {
	if !tx.fromAPI || tx.isReplay || tree == nil {
		return nil
	}
	observesBlocks := false
	for _, op := range tx.DoOperations {
		switch op.Action {
		case "create", "update", "insert", "delete", "move", "append", "appendInsert", "prependInsert",
			"swapBlockRef", "convertList", "moveOutlineHeading", "setAttrs", "updateAttrs", "collectAttrViewBlocks", "cleanupAttrViewBlocks":
			observesBlocks = true
		}
	}
	if !observesBlocks {
		return nil
	}
	state := tx.collectionState()
	defer func() {
		if captureErr != nil {
			state.err = captureErr
		}
	}()
	if state.running || state.checked[tree.ID] {
		return state.err
	}
	state.checked[tree.ID] = true
	boxID := ""
	if IsEncryptedBox(tree.Box) {
		boxID = tree.Box
	}
	if boxID != "" {
		if tx.attributeViewRollback == nil {
			tx.attributeViewRollback = &attributeViewRollback{views: map[string]*av.AttributeView{}, trees: map[string]*parse.Tree{}, leases: map[string]bool{}}
		}
		if !tx.attributeViewRollback.leases[boxID] {
			if err := AcquireEncryptedBoxOperation(boxID); err != nil {
				return err
			}
			tx.attributeViewRollback.leases[boxID] = true
		}
	}
	ids, err := av.BlockCollectionViewIDsInBox(boxID)
	if err != nil {
		return err
	}
	matched := false
	for _, id := range ids {
		view := state.views[boxID+"/"+id]
		if view == nil {
			view, err = av.ParseAttributeViewForIndexInBox(id, boxID)
			if errors.Is(err, av.ErrViewNotFound) {
				continue
			}
			if err != nil {
				return err
			}
		}
		if view == nil || view.Automations == nil {
			continue
		}
		for _, rule := range view.Automations.Rules {
			if rule == nil || !rule.Enabled || rule.Trigger != "block" || !collectionScopeMatches(rule.BlockSource, tree) {
				continue
			}
			matched = true
			state.views[boxID+"/"+id] = view
		}
	}
	if !matched {
		return nil
	}
	if tx.attributeViewAutomations == nil {
		tx.attributeViewAutomations = &attributeViewAutomationState{time: time.Now().UnixMilli(), recordUndo: len(tx.UndoOperations) > 0}
	}
	if tx.attributeViewRollback == nil {
		tx.attributeViewRollback = &attributeViewRollback{views: map[string]*av.AttributeView{}, trees: map[string]*parse.Tree{}, leases: map[string]bool{}}
	}
	original, err := filesys.LoadTree(tree.Box, tree.Path, tx.luteEngine)
	if err != nil {
		if _, statErr := os.Stat(filepath.Join(util.DataDir, tree.Box, tree.Path)); !os.IsNotExist(statErr) {
			return err
		}
		original = nil
	}
	state.before[tree.ID] = original
	if original != nil {
		tx.attributeViewRollback.trees[tree.ID] = original
	}
	return nil
}

func collectionNodes(tree *parse.Tree) map[string]*ast.Node {
	ret := map[string]*ast.Node{}
	if tree != nil {
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.IsBlock() && ast.IsNodeIDPattern(node.ID) {
				ret[node.ID] = node
			}
			return ast.WalkContinue
		})
	}
	return ret
}

func (tx *Transaction) runAttributeViewCollections() error {
	state := tx.attributeViewCollections
	if state == nil || tx.isReplay {
		return nil
	}
	if state.err != nil {
		return state.err
	}
	state.running = true
	type collectionChange struct {
		viewID, boxID, blockID string
		rule                   *av.AutomationRule
	}
	var changes []collectionChange
	afterNodes := map[string]*ast.Node{}
	afterTrees := map[string]*parse.Tree{}
	for _, after := range tx.trees {
		for blockID, node := range collectionNodes(after) {
			afterNodes[blockID], afterTrees[blockID] = node, after
		}
	}
	blockIDs := []string{}
	for blockID := range afterNodes {
		blockIDs = append(blockIDs, blockID)
	}
	sort.Strings(blockIDs)
	viewKeys := []string{}
	for key := range state.views {
		viewKeys = append(viewKeys, key)
	}
	sort.Strings(viewKeys)
	for _, viewKey := range viewKeys {
		boxID, id, _ := strings.Cut(viewKey, "/")
		view, err := tx.readAttributeViewForMutation(id, "", boxID)
		if err != nil {
			return err
		}
		if view.Automations == nil {
			continue
		}
		var rules []*av.AutomationRule
		paused := false
		for _, rule := range view.Automations.Rules {
			if rule != nil && rule.Enabled && rule.Trigger == "block" {
				validationErr := tx.validateBlockCollectionRule(view, rule, boxID)
				if unavailable, ok := errors.AsType[*automationUnavailableReference](validationErr); ok {
					if err = tx.rememberAutomationView(view, ""); err != nil {
						return err
					}
					rule.Enabled, paused = false, true
					tx.attributeViewAutomations.paused = append(tx.attributeViewAutomations.paused, automationPausedRule{rule.Name, unavailable})
					continue
				}
				if validationErr != nil {
					return validationErr
				}
				rules = append(rules, rule)
			}
		}
		if paused {
			if err = av.SaveAttributeView(view); err != nil {
				return err
			}
			ReloadAttrView(id)
		}
		beforeMatches, afterMatches := map[*av.AutomationRule]map[string]bool{}, map[*av.AutomationRule]map[string]bool{}
		for _, rule := range rules {
			beforeMatches[rule], afterMatches[rule] = map[string]bool{}, map[string]bool{}
			for _, tree := range state.before {
				for id := range collectionMatches(rule.BlockSource, tree) {
					beforeMatches[rule][id] = true
				}
			}
			for _, tree := range tx.trees {
				for id := range collectionMatches(rule.BlockSource, tree) {
					afterMatches[rule][id] = true
				}
			}
		}
		for _, blockID := range blockIDs {
			tree := afterTrees[blockID]
			if !IsSameCryptoBoundary(boxID, tree.Box) {
				continue
			}
			var entering *av.AutomationRule
			row := view.GetBlockValueByBoundID(blockID)
			// 已有条目及用户字段始终保留，失配不触发隐式清理。
			if row != nil {
				// 连续输入可能使用绑定通知前的快照，按数据库现存条目补回绑定属性。
				if !slices.Contains(strings.Split(afterNodes[blockID].IALAttr(av.NodeAttrNameAvs), ","), id) {
					bindBlockAv0(tx, id, afterNodes[blockID], tree)
				}
				continue
			}
			for _, rule := range rules {
				before := beforeMatches[rule][blockID]
				after := afterMatches[rule][blockID]
				if after && (!before || slices.Contains(state.requested[id][rule.ID], blockID)) && entering == nil {
					entering = rule
				}
			}
			if entering == nil {
				continue
			}
			if err = tx.validateBlockCollectionRule(view, entering, boxID); err != nil {
				return err
			}
			changes = append(changes, collectionChange{viewID: id, boxID: boxID, blockID: blockID, rule: entering})
		}
	}
	// 各数据库共享原文修改后的匹配结果，自动绑定属性不会继续触发其他收集规则。
	for _, change := range changes {
		view, err := tx.readAttributeViewForMutation(change.viewID, "", change.boxID)
		if err != nil {
			return err
		}
		if err = tx.addCollectedItem(view, change.rule, change.blockID, change.boxID); err != nil {
			return err
		}
		if !slices.Contains(state.requested[change.viewID][change.rule.ID], change.blockID) {
			tx.automationResult(change.boxID, change.viewID, change.rule).record("collected", change.viewID, change.blockID)
		}
	}
	return nil
}

func (tx *Transaction) addCollectedItem(view *av.AttributeView, rule *av.AutomationRule, blockID, boxID string) error {
	id := ast.NewNodeID()
	op := &Operation{Action: "insertAttrViewBlock", AvID: view.ID, IgnoreDefaultFill: true,
		Srcs: []map[string]any{{"id": blockID, "itemID": id, "isDetached": false}}, attributeViewCollectionRuleID: rule.ID}
	if err := tx.applyAutomationOperation(op, &Operation{Action: "removeAttrViewBlock", AvID: view.ID, SrcIDs: []string{id}}); err != nil {
		return err
	}
	if len(rule.Actions[0].Fields) == 0 {
		return nil
	}
	current, err := tx.readAttributeViewForMutation(view.ID, "", boxID)
	if err != nil {
		return err
	}
	current, err = cloneAttributeViewForFieldMutation(current)
	if err != nil {
		return err
	}
	return tx.runAutomationAction(&attributeViewAutomationSource{before: view, boxID: boxID}, current, id,
		&av.AutomationAction{Type: "edit", Target: "current", Fields: rule.Actions[0].Fields}, rule.TimeZone, nil)
}

func (tx *Transaction) removeCollectedItem(view *av.AttributeView, row *av.Value, _ string) error {
	if err := tx.rememberAutomationView(view, ""); err != nil {
		return err
	}
	op := &Operation{Action: "removeAttrViewBlock", AvID: view.ID, SrcIDs: []string{row.BlockID}}
	inverse := &Operation{Action: "insertAttrViewBlock", AvID: view.ID,
		Srcs: []map[string]any{{"id": row.Block.ID, "itemID": row.BlockID, "isDetached": false}}}
	return tx.applyAutomationOperation(op, inverse)
}

func collectionRule(view *av.AttributeView, id string) (*av.AutomationRule, error) {
	if view != nil && view.Automations != nil {
		for _, rule := range view.Automations.Rules {
			if rule != nil && rule.ID == id && rule.Enabled && rule.Trigger == "block" {
				return rule, nil
			}
		}
	}
	return nil, fmt.Errorf("enabled block collection rule [%s] not found", id)
}

func PreviewAttributeViewCollection(avID, ruleID string, page int) (*apicontract.AVBlockCollectionPreview, error) {
	FlushTxQueue()
	tx := &Transaction{}
	defer tx.finishAttributeViewMutation(false)
	_, boxID := av.FindAttributeViewPath(avID)
	view, err := tx.readAttributeViewForMutation(avID, "", boxID)
	if err != nil {
		return nil, err
	}
	rule, err := collectionRule(view, ruleID)
	if err != nil {
		return nil, err
	}
	if err = tx.validateBlockCollectionRule(view, rule, boxID); err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if page > 100000 {
		return nil, fmt.Errorf("invalid collection preview page")
	}
	size := min(100, maxAutomationOperations/(len(rule.Actions[0].Fields)+1))
	if size < 1 {
		return nil, fmt.Errorf("too many collection fields")
	}
	ret := &apicontract.AVBlockCollectionPreview{Blocks: []*apicontract.AVBlockCollectionMatch{}}
	roots := treenode.GetBlockTreesByTypeInBox("d", boxID)
	sort.Slice(roots, func(i, j int) bool { return roots[i].ID < roots[j].ID })
	skipped := 0
	for _, bt := range roots {
		if !collectionScopeMatches(rule.BlockSource, &parse.Tree{ID: bt.ID, Box: bt.BoxID, Path: bt.Path}) {
			continue
		}
		tree, loadErr := filesys.LoadTree(bt.BoxID, bt.Path, util.NewLute())
		if loadErr != nil {
			return nil, loadErr
		}
		nodes := collectionNodes(tree)
		matches := collectionMatches(rule.BlockSource, tree)
		ids := []string{}
		for id := range nodes {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			if !matches[id] {
				continue
			}
			if skipped < (page-1)*size {
				skipped++
				continue
			}
			if len(ret.Blocks) == size {
				ret.HasMore = true
				return ret, nil
			}
			_, content := getNodeAvBlockText(nodes[id], avID)
			ret.Blocks = append(ret.Blocks, &apicontract.AVBlockCollectionMatch{ID: id, RootID: tree.ID,
				Content: util.UnescapeHTML(content), HPath: tree.HPath, Collected: view.GetBlockValueByBoundID(id) != nil})
		}
	}
	return ret, nil
}

func (tx *Transaction) doCollectAttrViewBlocks(op *Operation) *TxErr {
	if tx.isReplay {
		return nil
	}
	fail := func(err error) *TxErr { return &TxErr{code: TxErrHandleAttributeView, id: op.AvID, msg: err.Error()} }
	data, err := json.Marshal(op.Data)
	if err != nil {
		return fail(err)
	}
	var request apicontract.AVCollectBlocks
	if err = json.Unmarshal(data, &request); err != nil {
		return fail(err)
	}
	if len(request.BlockIDs) == 0 || len(request.BlockIDs) > 100 {
		return fail(fmt.Errorf("invalid collection block count"))
	}
	_, boxID := av.FindAttributeViewPath(op.AvID)
	view, err := tx.readAttributeViewForMutation(op.AvID, op.BlockID, boxID)
	if err != nil {
		return fail(err)
	}
	rule, err := collectionRule(view, request.RuleID)
	if err != nil {
		return fail(err)
	}
	if err = tx.validateBlockCollectionRule(view, rule, boxID); err != nil {
		return fail(err)
	}
	state := tx.collectionState()
	matchesByTree := map[string]map[string]bool{}
	if state.requested[op.AvID] == nil {
		state.requested[op.AvID] = map[string][]string{}
	}
	for _, id := range request.BlockIDs {
		bt := attributeViewBindingBlockTree(id, boxID)
		if bt == nil {
			return fail(ErrBlockNotFound)
		}
		tree, loadErr := tx.loadTreeByBlockTree(bt)
		if loadErr != nil {
			return fail(loadErr)
		}
		matches := matchesByTree[tree.ID]
		if matches == nil {
			matches = collectionMatches(rule.BlockSource, tree)
			matchesByTree[tree.ID] = matches
		}
		if matches[id] {
			state.requested[op.AvID][rule.ID] = append(state.requested[op.AvID][rule.ID], id)
		}
	}
	return nil
}

// 新建文档没有旧快照；收集事务失败时移除本事务已写入的新文件及派生索引。
func (tx *Transaction) rollbackCollectionCreatedTrees() {
	state := tx.attributeViewCollections
	if state == nil {
		return
	}
	for id, before := range state.before {
		if before != nil {
			continue
		}
		tree := tx.trees[id]
		if tree == nil {
			continue
		}
		if box := Conf.Box(tree.Box); box != nil && box.Exist(tree.Path) {
			if err := box.Remove(tree.Path); err != nil {
				logging.LogErrorf("rollback collected document [%s] failed: %s", id, err)
				continue
			}
		}
		cache.RemoveTreeDataInBox(id, tree.Box)
		cache.RemoveDocIALInBox(tree.Path, tree.Box)
		treenode.RemoveBlockTreesByRootID(tree.Box, id)
		sql.RemoveTreeQueue(tree.Box, id)
	}
}

// 属性 API 仍不生成编辑器撤销记录，但与自动收集共同提交；没有收集规则时沿用普通属性路径。
func performCollectionAttributeOperations(attrs []map[string]any, batch bool) (bool, error) {
	before := map[string]*parse.Tree{}
	active := false
	for _, item := range attrs {
		id := item["id"].(string)
		tree, err := LoadTreeByBlockID(id)
		if err != nil {
			return false, err
		}
		before[id] = tree
		boxID := ""
		if IsEncryptedBox(tree.Box) {
			boxID = tree.Box
		}
		ids, err := av.BlockCollectionViewIDsInBox(boxID)
		if err != nil {
			return false, err
		}
		active = active || len(ids) > 0
	}
	if !active {
		return false, nil
	}
	ops := []*Operation{}
	for _, item := range attrs {
		data, err := json.Marshal(item["attrs"])
		if err != nil {
			return true, err
		}
		ops = append(ops, &Operation{Action: "setAttrs", ID: item["id"].(string), Data: string(data)})
	}
	if err := PerformTxSync(&Transaction{DoOperations: ops, fromAPI: true}); err != nil {
		return true, err
	}
	for _, item := range attrs {
		id := item["id"].(string)
		tree, err := LoadTreeByBlockID(id)
		if err != nil {
			return true, err
		}
		node, oldNode := treenode.GetNodeInTree(tree, id), treenode.GetNodeInTree(before[id], id)
		if node == nil || oldNode == nil {
			continue
		}
		oldAttrs := parse.IAL2Map(oldNode.KramdownIAL)
		newAttrs := parse.IAL2Map(node.KramdownIAL)
		cache.PutBlockIALInBox(id, tree.Box, newAttrs)
		if oldAttrs[DocSortModeAttr] != newAttrs[DocSortModeAttr] && node.Type == ast.NodeDocument {
			cache.RemoveDocIALInBox(tree.Path, tree.Box)
			cache.PutDocIALInBox(tree.Path, tree.Box, newAttrs)
		}
		pushBlockAttrs(oldAttrs, node)
		pushDocSortModeChanged(oldAttrs, node, tree)
		if !batch {
			values := item["attrs"].(map[string]string)
			if (oldAttrs[DocHiddenAttr] == "true") != (newAttrs[DocHiddenAttr] == "true") {
				ReloadFiletree()
			}
			if attrsAffectRefText(values) {
				refreshDynamicRefText(node, tree)
			}
			if attrsAffectAvBlock(values) {
				updateAttributeViewBlockText(map[string]*ast.Node{id: node})
			}
		}
	}
	return true, nil
}
