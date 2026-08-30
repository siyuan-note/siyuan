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

package model

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type TemplateRenderMode string

const (
	TemplateRenderModeContent      TemplateRenderMode = "content"
	TemplateRenderModePreview      TemplateRenderMode = "preview"
	TemplateRenderModeEditorInsert TemplateRenderMode = "editorInsert"

	maxTemplateDocTreeDepth      = 16
	maxTemplateDocTreeDocs       = 128
	maxTemplateCallDepth         = 32
	maxTemplateDocTreeOutputSize = 8 * 1024 * 1024
	maxTemplateDocTreePlans      = 16
	templateDocTreePlanTTL       = 10 * time.Minute
)

// TemplateDocTreeNode 是模板声明的单个子文档，解析时先分配 ID，绑定父文档后再补全位置。
type TemplateDocTreeNode struct {
	ID       string                 `json:"id"`
	RootID   string                 `json:"-"`
	Title    string                 `json:"title"`
	ParentID string                 `json:"parentID"`
	HPath    string                 `json:"hPath"`
	Depth    int                    `json:"depth"`
	Template string                 `json:"-"`
	Define   string                 `json:"-"`
	Children []*TemplateDocTreeNode `json:"-"`

	path string
	tree *parse.Tree
}

type TemplateDocTreePlanSummary struct {
	ID    string                 `json:"id"`
	Count int                    `json:"count"`
	Nodes []*TemplateDocTreeNode `json:"nodes"`
}

type templateDocTreePlan struct {
	id        string
	rootID    string
	boxID     string
	rootPath  string
	rootHPath string
	nodes     []*TemplateDocTreeNode
	trees     []*parse.Tree
	createdAt time.Time
	expiresAt time.Time
}

type templateDocTreeCollector struct {
	rootID        string
	boxID         string
	rootPath      string
	rootHPath     string
	templatePath  string
	nodes         []*TemplateDocTreeNode
	enabled       bool
	allowCreation bool
	totalOutput   int
}

var (
	templateDocTreePlans     sync.Map
	templateDocTreePlansLock sync.Mutex
)

func parseTemplateDocTreeDefinition(def any) ([]*TemplateDocTreeNode, error) {
	state := &templateDocTreeParseState{}
	nodes, err := state.parseNodes(def, 1)
	if nil != err {
		return nil, err
	}
	if 0 == len(nodes) {
		return nil, errors.New("createDocTree requires at least one document")
	}
	return nodes, nil
}

type templateDocTreeParseState struct {
	count int
}

func (state *templateDocTreeParseState) parseNodes(value any, depth int) ([]*TemplateDocTreeNode, error) {
	if maxTemplateDocTreeDepth < depth {
		return nil, fmt.Errorf("createDocTree exceeds the maximum depth of %d", maxTemplateDocTreeDepth)
	}
	values, ok := value.([]any)
	if !ok {
		return nil, errors.New("createDocTree definition must be a list")
	}
	if 0 == len(values) {
		return nil, errors.New("createDocTree document list must not be empty")
	}

	nodes := make([]*TemplateDocTreeNode, 0, len(values))
	for _, value := range values {
		definition, ok := value.(map[string]any)
		if !ok {
			return nil, errors.New("createDocTree document must be a dictionary")
		}
		for key := range definition {
			switch key {
			case "title", "template", "define", "children":
			default:
				return nil, fmt.Errorf("createDocTree document contains unknown field [%s]", key)
			}
		}

		titleValue, ok := definition["title"]
		if !ok {
			return nil, errors.New("createDocTree document title is required")
		}
		title, ok := titleValue.(string)
		if !ok {
			return nil, errors.New("createDocTree document title must be a string")
		}
		title = normalizeDocTitle(title)
		if "" == title {
			return nil, errors.New("createDocTree document title must not be empty")
		}
		if 512 < utf8.RuneCountInString(title) {
			return nil, fmt.Errorf("createDocTree document title exceeds %d characters", 512)
		}

		templateName, err := templateDocTreeStringField(definition, "template")
		if nil != err {
			return nil, err
		}
		defineName, err := templateDocTreeStringField(definition, "define")
		if nil != err {
			return nil, err
		}
		if "" != templateName && "" != defineName {
			return nil, errors.New("createDocTree document template and define are mutually exclusive")
		}

		state.count++
		if maxTemplateDocTreeDocs < state.count {
			return nil, fmt.Errorf("createDocTree exceeds the maximum document count of %d", maxTemplateDocTreeDocs)
		}
		id := ast.NewNodeID()
		node := &TemplateDocTreeNode{
			ID:       id,
			RootID:   id,
			Title:    title,
			Depth:    depth,
			Template: templateName,
			Define:   defineName,
		}
		if childrenValue, exists := definition["children"]; exists {
			children, parseErr := state.parseNodes(childrenValue, depth+1)
			if nil != parseErr {
				return nil, parseErr
			}
			node.Children = children
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

func templateDocTreeStringField(definition map[string]any, key string) (string, error) {
	value, exists := definition[key]
	if !exists {
		return "", nil
	}
	ret, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("createDocTree document %s must be a string", key)
	}
	ret = strings.TrimSpace(ret)
	if "" == ret {
		return "", fmt.Errorf("createDocTree document %s must not be empty", key)
	}
	return ret, nil
}

func (collector *templateDocTreeCollector) create(def any) (string, error) {
	if !collector.enabled || !collector.allowCreation {
		return "", errors.New("createDocTree is only available when manually inserting a template in the editor")
	}
	nodes, err := parseTemplateDocTreeDefinition(def)
	if nil != err {
		return "", err
	}
	if maxTemplateDocTreeDocs < len(flattenTemplateDocTreeNodes0(collector.nodes))+len(flattenTemplateDocTreeNodes0(nodes)) {
		return "", fmt.Errorf("createDocTree exceeds the maximum document count of %d", maxTemplateDocTreeDocs)
	}
	collector.bindNodes(nodes, collector.rootID, collector.rootPath, collector.rootHPath)
	collector.nodes = append(collector.nodes, nodes...)
	return "", nil
}

func (collector *templateDocTreeCollector) bindNodes(nodes []*TemplateDocTreeNode, parentID, parentPath, parentHPath string) {
	for _, node := range nodes {
		node.ParentID = parentID
		node.path = strings.TrimSuffix(parentPath, ".sy") + "/" + node.ID + ".sy"
		node.HPath = path.Join(parentHPath, node.Title)
		collector.bindNodes(node.Children, node.ID, node.path, node.HPath)
	}
}

func (collector *templateDocTreeCollector) renderDocRef(mode string, value any) (any, error) {
	if !collector.enabled {
		return nil, errors.New("renderDocRef is only available when manually inserting or previewing a template")
	}
	switch mode {
	case "children":
		id, ok := value.(string)
		if !ok {
			return nil, errors.New("renderDocRef children target must be a document ID")
		}
		if collector.rootID == id {
			return collector.nodes, nil
		}
		for _, node := range flattenTemplateDocTreeNodes0(collector.nodes) {
			if node.ID == id {
				return node.Children, nil
			}
		}
		return []*TemplateDocTreeNode{}, nil
	case "path":
		hPath, ok := value.(string)
		if !ok {
			return "", errors.New("renderDocRef path target must be a document path")
		}
		requestedPath := path.Clean(hPath)
		for _, node := range flattenTemplateDocTreeNodes0(collector.nodes) {
			relativePath := strings.TrimPrefix(node.HPath, collector.rootHPath)
			if node.HPath == requestedPath || relativePath == requestedPath {
				return fmt.Sprintf("((%s %q))", node.RootID, node.HPath), nil
			}
		}
		return "", nil
	default:
		return nil, fmt.Errorf("unsupported renderDocRef query mode [%s]", mode)
	}
}

func flattenTemplateDocTreeNodes0(nodes []*TemplateDocTreeNode) (ret []*TemplateDocTreeNode) {
	for _, node := range nodes {
		ret = append(ret, node)
		ret = append(ret, flattenTemplateDocTreeNodes0(node.Children)...)
	}
	return
}

func (collector *templateDocTreeCollector) validateLocations() error {
	box := Conf.Box(collector.boxID)
	if nil == box {
		return ErrBoxNotFound
	}
	allowCreateDeeper := nil != Conf.FileTree && Conf.FileTree.AllowCreateDeeper
	for _, node := range flattenTemplateDocTreeNodes0(collector.nodes) {
		if depth := strings.Count(node.path, "/"); 7 < depth && !allowCreateDeeper {
			return errors.New(Conf.Language(118))
		}
		if box.Exist(node.path) {
			return fmt.Errorf("document path [%s] already exists", node.path)
		}
	}
	return nil
}

func (collector *templateDocTreeCollector) buildTree(node *TemplateDocTreeNode, renderedTree *parse.Tree) {
	renderedRootID := renderedTree.Root.ID
	renderedTree.Box = collector.boxID
	renderedTree.Path = node.path
	renderedTree.HPath = node.HPath
	renderedTree.ID = node.ID
	renderedTree.Root.ID = node.ID
	renderedTree.Root.Spec = treenode.CurrentSpec
	templateIALs := parse.IAL2Map(renderedTree.Root.KramdownIAL)
	renderedTree.Root.KramdownIAL = [][]string{
		{"id", node.ID},
		{"title", html.EscapeAttrVal(node.Title)},
		{"updated", util.TimeFromID(node.ID)},
	}
	for key, value := range templateIALs {
		if "name" == key || "alias" == key || "bookmark" == key || "memo" == key || "icon" == key ||
			strings.HasPrefix(key, "custom-") {
			renderedTree.Root.SetIALAttr(key, value)
		}
	}
	if nil == renderedTree.Root.FirstChild {
		renderedTree.Root.AppendChild(treenode.NewParagraph(""))
	}
	if "" != renderedRootID && renderedRootID != node.ID {
		rewriteTemplateDocTreeRootRefs(renderedTree.Root, renderedRootID, node.ID)
	}
	node.tree = renderedTree
}

func rewriteTemplateDocTreeRootRefs(root *ast.Node, oldID, newID string) {
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.IsTextMarkType("block-ref") && node.TextMarkBlockRefID == oldID {
			node.TextMarkBlockRefID = newID
		} else if ast.NodeBlockRef == node.Type {
			if refID := node.ChildByType(ast.NodeBlockRefID); nil != refID && refID.TokensStr() == oldID {
				refID.Tokens = []byte(newID)
			}
		} else if treenode.IsBlockLink(node) && node.TextMarkAHref == "siyuan://blocks/"+oldID {
			node.TextMarkAHref = "siyuan://blocks/" + newID
		} else if ast.NodeBlockQueryEmbedScript == node.Type {
			node.Tokens = []byte(strings.ReplaceAll(string(node.Tokens), oldID, newID))
		}
		return ast.WalkContinue
	})
}

func (collector *templateDocTreeCollector) summary(id string) *TemplateDocTreePlanSummary {
	nodes := flattenTemplateDocTreeNodes0(collector.nodes)
	return &TemplateDocTreePlanSummary{ID: id, Count: len(nodes), Nodes: nodes}
}

func (collector *templateDocTreeCollector) storePlan() *TemplateDocTreePlanSummary {
	id := ast.NewNodeID()
	plan := &templateDocTreePlan{
		id:        id,
		rootID:    collector.rootID,
		boxID:     collector.boxID,
		rootPath:  collector.rootPath,
		rootHPath: collector.rootHPath,
		nodes:     flattenTemplateDocTreeNodes0(collector.nodes),
		createdAt: time.Now(),
		expiresAt: time.Now().Add(templateDocTreePlanTTL),
	}
	for _, node := range plan.nodes {
		plan.trees = append(plan.trees, node.tree)
	}
	templateDocTreePlansLock.Lock()
	var count int
	var oldest *templateDocTreePlan
	templateDocTreePlans.Range(func(_, value any) bool {
		stored, ok := value.(*templateDocTreePlan)
		if !ok {
			return true
		}
		count++
		if nil == oldest || stored.createdAt.Before(oldest.createdAt) {
			oldest = stored
		}
		return true
	})
	if maxTemplateDocTreePlans <= count && nil != oldest {
		templateDocTreePlans.Delete(oldest.id)
	}
	templateDocTreePlans.Store(id, plan)
	templateDocTreePlansLock.Unlock()
	time.AfterFunc(templateDocTreePlanTTL, func() {
		templateDocTreePlans.Delete(id)
	})
	return collector.summary(id)
}

func resolveTemplatePackageFile(rootTemplatePath, relativePath string) (string, error) {
	relativePath = strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(relativePath)), "/")
	cleanPath := filepath.Clean(filepath.FromSlash(relativePath))
	if "" == cleanPath || "." == cleanPath || filepath.IsAbs(cleanPath) || ".." == cleanPath ||
		strings.HasPrefix(cleanPath, ".."+string(os.PathSeparator)) {
		return "", errors.New("invalid child template path")
	}
	templatesRoot := filepath.Clean(filepath.Join(util.DataDir, "templates"))
	relRootTemplate, err := filepath.Rel(templatesRoot, filepath.Clean(rootTemplatePath))
	if nil != err || strings.HasPrefix(relRootTemplate, ".."+string(os.PathSeparator)) {
		return "", errors.New("template path is outside templates directory")
	}
	parts := strings.Split(filepath.ToSlash(relRootTemplate), "/")
	packageRoot := templatesRoot
	if 1 < len(parts) {
		packageRoot = filepath.Join(templatesRoot, parts[0])
	}
	absPath := filepath.Join(packageRoot, cleanPath)
	if !gulu.File.IsSubPath(packageRoot, absPath) || !filelock.IsExist(absPath) {
		return "", fmt.Errorf("child template [%s] not found in the current template package", relativePath)
	}
	realRoot, err := filepath.EvalSymlinks(packageRoot)
	if nil != err {
		return "", err
	}
	realPath, err := filepath.EvalSymlinks(absPath)
	if nil != err {
		return "", err
	}
	info, err := os.Stat(realPath)
	if nil != err || !info.Mode().IsRegular() {
		return "", fmt.Errorf("child template [%s] is not a regular file", relativePath)
	}
	if !gulu.File.IsSubPath(realRoot, realPath) {
		return "", errors.New("child template path is outside the current template package")
	}
	return realPath, nil
}

func templateDocTreeDataModel(node *TemplateDocTreeNode) map[string]string {
	return map[string]string{
		"title":    node.Title,
		"id":       node.ID,
		"parentID": node.ParentID,
		"rootID":   node.RootID,
		"hPath":    node.HPath,
		"name":     "",
		"alias":    "",
	}
}

// AttachTemplateDocTreePlans 将一次性计划转换为内核事务操作，父文档内容与全部子文档共用一条撤销记录。
func AttachTemplateDocTreePlans(transactions []*Transaction) (attached bool, err error) {
	var target *Transaction
	for _, transaction := range transactions {
		if nil == transaction || "" == transaction.TemplateDocTreePlanID {
			continue
		}
		if nil != target || 1 != len(transactions) {
			return false, errors.New("a document tree plan must be applied in a single transaction")
		}
		target = transaction
	}
	if nil == target {
		return false, nil
	}
	if target.isReplay {
		return false, errors.New("template document tree plans cannot be attached to replay transactions")
	}
	if 0 == len(target.DoOperations) || 0 == len(target.UndoOperations) {
		return false, errors.New("template document tree plan requires reversible parent operations")
	}
	if err = validateTemplateDocTreeParentOperations(target); nil != err {
		return false, err
	}
	for _, operation := range append(append([]*Operation{}, target.DoOperations...), target.UndoOperations...) {
		if nil != operation && ("restoreCreatedDoc" == operation.Action || "removeCreatedDoc" == operation.Action) {
			return false, errors.New("template document tree transaction contains a reserved operation")
		}
	}

	planID := target.TemplateDocTreePlanID
	target.TemplateDocTreePlanID = ""
	value, loaded := templateDocTreePlans.LoadAndDelete(planID)
	if !loaded {
		return false, errors.New("template document tree plan is missing or has expired")
	}
	plan, ok := value.(*templateDocTreePlan)
	if !ok || plan.id != planID || time.Now().After(plan.expiresAt) {
		return false, errors.New("template document tree plan is invalid or has expired")
	}
	if !transactionTargetsTemplateRoot(target, plan.rootID, plan.boxID) {
		return false, errors.New("template document tree plan does not match the edited document")
	}
	rootTree, loadErr := LoadTreeByBlockID(plan.rootID)
	if nil != loadErr || nil == rootTree || rootTree.Box != plan.boxID || rootTree.Path != plan.rootPath ||
		rootTree.HPath != plan.rootHPath {
		return false, errors.New("the document used to render the template has changed")
	}
	target.templateDocTreeRootSnapshot = rootTree
	box := Conf.Box(plan.boxID)
	if nil == box {
		return false, ErrBoxNotFound
	}
	for _, tree := range plan.trees {
		if nil == tree || nil == tree.Root || tree.ID != tree.Root.ID || tree.Box != plan.boxID || box.Exist(tree.Path) {
			return false, errors.New("template document tree plan contains an invalid document snapshot")
		}
	}

	for _, tree := range plan.trees {
		target.DoOperations = append(target.DoOperations, &Operation{
			Action:                "restoreCreatedDoc",
			ID:                    tree.ID,
			Tree:                  tree,
			templateDocTreeRootID: plan.rootID,
		})
	}
	for index := len(plan.trees) - 1; 0 <= index; index-- {
		tree := plan.trees[index]
		target.UndoOperations = append(target.UndoOperations, &Operation{
			Action:                "removeCreatedDoc",
			ID:                    tree.ID,
			Tree:                  tree,
			templateDocTreeRootID: plan.rootID,
		})
	}
	return true, nil
}

func validateTemplateDocTreeParentOperations(transaction *Transaction) error {
	inverseActions := map[string]string{
		"insert":        "delete",
		"delete":        "insert",
		"update":        "update",
		"foldHeading":   "unfoldHeading",
		"unfoldHeading": "foldHeading",
		"setAttrs":      "setAttrs",
	}
	undoOperations := map[string]int{}
	for _, operation := range transaction.UndoOperations {
		if nil == operation || "" == operation.ID {
			return errors.New("template document tree plan contains an invalid parent undo operation")
		}
		if _, supported := inverseActions[operation.Action]; !supported || "" != operation.RootID {
			return errors.New("template document tree plan contains an unsupported parent undo operation")
		}
		undoOperations[operation.Action+"\x00"+operation.ID]++
	}

	hasContentMutation := false
	for _, operation := range transaction.DoOperations {
		if nil == operation || "" == operation.ID {
			return errors.New("template document tree plan contains an invalid parent operation")
		}
		inverseAction, supported := inverseActions[operation.Action]
		if !supported || "" != operation.RootID {
			return errors.New("template document tree plan contains an unsupported parent operation")
		}
		if "insert" == operation.Action || "delete" == operation.Action || "update" == operation.Action {
			hasContentMutation = true
		}
		key := inverseAction + "\x00" + operation.ID
		if 1 > undoOperations[key] {
			return errors.New("template document tree plan parent operations are not reversible")
		}
		undoOperations[key]--
	}
	if !hasContentMutation {
		return errors.New("template document tree plan requires a parent content operation")
	}
	for _, count := range undoOperations {
		if 0 != count {
			return errors.New("template document tree plan parent operations are not reversible")
		}
	}
	return nil
}

func transactionTargetsTemplateRoot(transaction *Transaction, rootID, boxID string) bool {
	matched := false
	for operationSetIndex, operations := range [][]*Operation{transaction.DoOperations, transaction.UndoOperations} {
		for _, operation := range operations {
			if nil == operation {
				continue
			}
			ids := []string{operation.ID}
			if "insert" == operation.Action {
				ids = append(ids, operation.ParentID, operation.PreviousID, operation.NextID)
			}
			for _, id := range ids {
				if rootID == id {
					if 0 == operationSetIndex {
						matched = true
					}
					continue
				}
				if "" == id {
					continue
				}
				if blockTree := treenode.GetBlockTreeInBox(id, boxID); nil != blockTree {
					if blockTree.RootID != rootID {
						return false
					}
					if 0 == operationSetIndex {
						matched = true
					}
				}
			}
		}
	}
	return matched
}
