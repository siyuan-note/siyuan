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

package model

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// NewItemTemplatePreview 描述新增条目模板在当前数据库实例中的解析结果。
type NewItemTemplatePreview struct {
	PrimaryKey string   `json:"primaryKey"`
	BoxID      string   `json:"boxID,omitempty"`
	HPath      string   `json:"hPath,omitempty"`
	Warnings   []string `json:"warnings,omitempty"`

	parentID string
}

// CreateAttributeViewItemResult 描述按模板创建数据库条目的结果。
type CreateAttributeViewItemResult struct {
	ItemID      string       `json:"itemID"`
	BlockID     string       `json:"blockID"`
	Content     string       `json:"content"`
	IsDetached  bool         `json:"isDetached"`
	Warnings    []string     `json:"warnings,omitempty"`
	Transaction *Transaction `json:"-"`
}

// CreateAttributeViewItem 按指定模板创建一个数据库条目。templateID 为空时创建空白游离条目。
func CreateAttributeViewItem(avID, blockID, viewID, templateID, previousID, groupID string) (*CreateAttributeViewItemResult, error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return nil, err
	}
	createdAt := time.Now()
	itemTemplate := attrView.GetNewItemTemplate(templateID)
	if "" != templateID && nil == itemTemplate {
		return nil, fmt.Errorf("new item template [%s] not found", templateID)
	}
	if nil == itemTemplate {
		itemTemplate = &av.NewItemTemplate{TargetType: av.NewItemTargetDetached}
	} else {
		cloned := *attrView
		cloned.PruneInvalidNewItemTemplateFieldValues()
		if err = cloned.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{itemTemplate}}); nil != err {
			return nil, err
		}
		attrView = &cloned
		itemTemplate = cloned.NewItemTemplates[0]
	}
	preview, err := resolveAttributeViewNewItemTemplate(blockID, itemTemplate, createdAt)
	if nil != err {
		return nil, err
	}

	itemID := ast.NewNodeID()
	fieldValues, err := resolveNewItemFieldValues(attrView, itemTemplate, createdAt)
	if nil != err {
		return nil, err
	}
	dbTree, err := LoadTreeByBlockID(blockID)
	if nil != err {
		return nil, err
	}
	dbNode := treenode.GetNodeInTree(dbTree, blockID)
	if nil == dbNode {
		return nil, ErrBlockNotFound
	}
	boundBlockID := itemID
	isDetached := av.NewItemTargetDocument != itemTemplate.TargetType
	var createdTree *parse.Tree
	if !isDetached {
		boundBlockID = ast.NewNodeID()
		arg := map[string]any{"titleEmpty": "" == preview.PrimaryKey}
		createdID, createErr := CreateWithMarkdown("", preview.BoxID, preview.HPath, "", preview.parentID, boundBlockID, false, "", arg)
		if nil != createErr {
			return nil, createErr
		}
		boundBlockID = createdID
		if "" != itemTemplate.ContentTemplatePath {
			if applyErr := applyNewItemContentTemplate(itemTemplate.ContentTemplatePath, boundBlockID); nil != applyErr {
				return nil, newItemCreationError(applyErr, removeCreatedNewItemDoc(boundBlockID))
			}
		}
		createdTree, err = LoadTreeByBlockID(boundBlockID)
		if nil != err {
			return nil, newItemCreationError(err, removeCreatedNewItemDoc(boundBlockID))
		}
		if "" != itemTemplate.Icon {
			createdTree.Root.SetIALAttr("icon", itemTemplate.Icon)
			if err = indexWriteTreeUpsertQueue(createdTree); nil != err {
				return nil, newItemCreationError(err, removeCreatedNewItemDoc(boundBlockID))
			}
			FlushTxQueue()
		}
	}

	doOperations := []*Operation{}
	if nil != createdTree {
		doOperations = append(doOperations, &Operation{Action: "restoreCreatedDoc", ID: boundBlockID, Tree: createdTree})
	}
	doOperations = append(doOperations, &Operation{
		Action: "insertAttrViewBlock", AvID: avID, BlockID: blockID, ViewID: viewID, GroupID: groupID,
		PreviousID: previousID, IgnoreDefaultFill: false,
		Srcs: []map[string]any{{"itemID": itemID, "id": boundBlockID, "content": preview.PrimaryKey, "isDetached": isDetached}},
	})
	fieldOperations := buildNewItemFieldValueOperations(attrView, fieldValues, itemID)
	doOperations = append(doOperations, fieldOperations...)
	doOperations = append(doOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})

	undoOperations := []*Operation{{Action: "removeAttrViewBlock", AvID: avID, SrcIDs: []string{itemID}}}
	if nil != createdTree {
		undoOperations = append(undoOperations, &Operation{Action: "removeCreatedDoc", ID: boundBlockID, Tree: createdTree})
	}
	undoOperations = append(undoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: dbNode.IALAttr("updated")})
	tx := &Transaction{DoOperations: doOperations, UndoOperations: undoOperations, Timestamp: createdAt.UnixMilli()}
	tx.MarkFromAPI()
	if err = PerformTxSync(tx); nil != err {
		cleanupErr := RemoveAttributeViewBlock([]string{itemID}, avID)
		if nil != createdTree {
			cleanupErr = errors.Join(cleanupErr, removeCreatedNewItemDoc(boundBlockID))
		}
		return nil, newItemCreationError(err, cleanupErr)
	}

	content := preview.PrimaryKey
	if !isDetached {
		if blockTree := treenode.GetBlockTree(boundBlockID); nil != blockTree {
			content = path.Base(blockTree.HPath)
		}
	}
	return &CreateAttributeViewItemResult{
		ItemID: itemID, BlockID: boundBlockID, Content: content, IsDetached: isDetached,
		Warnings: preview.Warnings, Transaction: tx,
	}, nil
}

func resolveAttributeViewNewItemTemplate(blockID string, itemTemplate *av.NewItemTemplate, createdAt time.Time) (*NewItemTemplatePreview, error) {
	blockTree := treenode.GetBlockTree(blockID)
	if nil == blockTree {
		return nil, ErrBlockNotFound
	}
	primary, err := RenderGoTemplateAt(itemTemplate.PrimaryKeyTemplate, createdAt)
	if nil != err {
		return nil, err
	}
	primary = strings.TrimSpace(primary)
	preview := &NewItemTemplatePreview{PrimaryKey: primary}
	if av.NewItemTargetDocument != itemTemplate.TargetType {
		return preview, nil
	}
	primary = normalizeDocTitle(primary)
	preview.PrimaryKey = primary

	boxID, pathTemplate, inherited, err := resolveNewItemSaveConfig(blockTree.BoxID, itemTemplate.SaveLocation)
	if nil != err {
		return nil, err
	}
	renderedPath, err := RenderGoTemplateAt(pathTemplate, createdAt)
	if nil != err {
		return nil, err
	}
	renderedPath = util.TrimSpaceInPath(strings.TrimSpace(renderedPath))
	if boxID != blockTree.BoxID && "" != renderedPath && !strings.HasPrefix(renderedPath, "/") {
		renderedPath = "/" + renderedPath
	}
	if "" == primary {
		primary = newItemTitleFromPath(renderedPath)
		preview.PrimaryKey = primary
	}
	parentTemplate := newItemParentPathTemplate(renderedPath)
	baseHPath := "/"
	if boxID == blockTree.BoxID && !strings.HasPrefix(parentTemplate, "/") {
		baseHPath = blockTree.HPath
		preview.parentID = blockTree.RootID
	}
	parentHPath := path.Clean(path.Join(baseHPath, parentTemplate))
	if "." == parentHPath || "" == parentHPath {
		parentHPath = "/"
	}
	if !strings.HasPrefix(parentHPath, "/") {
		parentHPath = "/" + parentHPath
	}
	if "" == primary {
		preview.HPath = strings.TrimSuffix(parentHPath, "/") + "/"
		if "/" == parentHPath {
			preview.HPath = "/"
		}
	} else {
		preview.HPath = path.Join(parentHPath, primary)
	}
	preview.BoxID = boxID
	if inherited && boxID != blockTree.BoxID {
		preview.parentID = ""
	}
	return preview, nil
}

func resolveNewItemSaveConfig(currentBoxID string, location *av.NewItemSaveLocation) (boxID, pathTemplate string, inherited bool, err error) {
	if nil != location {
		boxID = location.BoxID
		if "" == boxID {
			boxID = currentBoxID
		}
		if nil == Conf.Box(boxID) {
			return "", "", false, ErrBoxNotFound
		}
		if err = validateNewItemSaveBox(currentBoxID, boxID); nil != err {
			return "", "", false, err
		}
		return boxID, location.PathTemplate, false, nil
	}

	inherited = true
	boxID = currentBoxID
	pathTemplate = Conf.FileTree.DocCreateSavePath
	if box := Conf.Box(currentBoxID); nil != box {
		boxConf := box.GetConf()
		if "" != boxConf.DocCreateSaveBox || "" != boxConf.DocCreateSavePath {
			boxID = boxConf.DocCreateSaveBox
			pathTemplate = boxConf.DocCreateSavePath
		}
	}
	if "" == boxID {
		boxID = Conf.FileTree.DocCreateSaveBox
	}
	if "" == boxID || nil == Conf.Box(boxID) {
		boxID = currentBoxID
	}
	if "" == pathTemplate {
		pathTemplate = Conf.FileTree.DocCreateSavePath
	}
	err = validateNewItemSaveBox(currentBoxID, boxID)
	return
}

func validateNewItemSaveBox(currentBoxID, targetBoxID string) error {
	if IsEncryptedBox(currentBoxID) && currentBoxID != targetBoxID {
		return errors.New("new attribute view item document in an encrypted notebook must be saved in the current notebook")
	}
	return nil
}

func newItemParentPathTemplate(renderedPath string) string {
	if "" == renderedPath || strings.HasSuffix(renderedPath, "/") {
		return renderedPath
	}
	isAbsolute := strings.HasPrefix(renderedPath, "/")
	segments := strings.FieldsFunc(renderedPath, func(r rune) bool { return '/' == r })
	if 1 >= len(segments) {
		if isAbsolute {
			return "/"
		}
		return ""
	}
	parent := strings.Join(segments[:len(segments)-1], "/")
	if isAbsolute {
		parent = "/" + parent
	}
	return parent
}

func newItemTitleFromPath(renderedPath string) string {
	if "" == renderedPath || strings.HasSuffix(renderedPath, "/") {
		return ""
	}
	return normalizeDocTitle(path.Base(renderedPath))
}

func resolveNewItemFieldValues(attrView *av.AttributeView, itemTemplate *av.NewItemTemplate, createdAt time.Time) (ret map[string]*av.Value, err error) {
	ret = map[string]*av.Value{}
	for keyID, fieldValue := range itemTemplate.FieldValues {
		key, getErr := attrView.GetKey(keyID)
		if nil != getErr || nil == key {
			return nil, fmt.Errorf("new item template field [%s] not found", keyID)
		}
		var value *av.Value
		switch fieldValue.Mode {
		case av.NewItemFieldValueCurrentTime:
			if av.KeyTypeDate != key.Type {
				return nil, fmt.Errorf("new item template field [%s] current time value is invalid", keyID)
			}
			isNotTime := true
			if nil != key.Date {
				isNotTime = !key.Date.FillSpecificTime
			}
			value = &av.Value{Type: av.KeyTypeDate, Date: av.NewFormattedValueDate(createdAt.UnixMilli(), 0, av.DateFormatNone, isNotTime, false)}
		case av.NewItemFieldValueStatic:
			if nil == fieldValue.Value || fieldValue.Value.Type != key.Type {
				return nil, fmt.Errorf("new item template field [%s] value is invalid", keyID)
			}
			value = fieldValue.Value.Clone()
			if av.KeyTypeRelation == key.Type {
				filterNewItemTemplateRelationValue(attrView, key, value)
				if nil == value.Relation || 0 == len(value.Relation.BlockIDs) {
					continue
				}
			}
		default:
			return nil, fmt.Errorf("new item template field [%s] value mode is invalid", keyID)
		}
		ret[keyID] = value
	}
	return
}

func filterNewItemTemplateRelationValue(attrView *av.AttributeView, key *av.Key, value *av.Value) {
	if nil == key.Relation || nil == value.Relation {
		return
	}
	targetAv := attrView
	if key.Relation.AvID != attrView.ID {
		targetAv, _ = av.ParseAttributeView(key.Relation.AvID)
	}
	if nil == targetAv {
		value.Relation.BlockIDs = nil
		return
	}
	blockKey := targetAv.GetBlockKey()
	if nil == blockKey {
		value.Relation.BlockIDs = nil
		return
	}
	blockIDs := value.Relation.BlockIDs[:0]
	for _, blockID := range value.Relation.BlockIDs {
		if nil != targetAv.GetValue(blockKey.ID, blockID) {
			blockIDs = append(blockIDs, blockID)
		}
	}
	value.Relation.BlockIDs = blockIDs
}

func buildNewItemFieldValueOperations(attrView *av.AttributeView, fieldValues map[string]*av.Value, itemID string) (ret []*Operation) {
	for _, keyValues := range attrView.KeyValues {
		if nil == keyValues || nil == keyValues.Key {
			continue
		}
		keyID := keyValues.Key.ID
		value := fieldValues[keyID]
		if nil == value {
			continue
		}
		ret = append(ret, &Operation{Action: "updateAttrViewCell", ID: ast.NewNodeID(), AvID: attrView.ID, KeyID: keyID, RowID: itemID, Data: value})
	}
	return
}

func applyNewItemContentTemplate(templatePath, docID string) error {
	absPath, err := resolveNewItemContentTemplatePath(templatePath)
	if nil != err {
		return err
	}
	templateTree, templateDOM, err := RenderTemplate(absPath, docID, false)
	if nil != err {
		return err
	}
	if "" == templateDOM {
		return nil
	}
	tree, err := LoadTreeByBlockID(docID)
	if nil != err {
		return err
	}
	if nil != tree.Root.FirstChild {
		tree.Root.FirstChild.Unlink()
	}
	newTree := util.NewLute().BlockDOM2Tree(templateDOM)
	var children []*ast.Node
	for child := newTree.Root.FirstChild; nil != child; child = child.Next {
		children = append(children, child)
	}
	for _, child := range children {
		tree.Root.AppendChild(child)
	}
	templateIALs := parse.IAL2Map(templateTree.Root.KramdownIAL)
	for key, value := range templateIALs {
		if "name" == key || "alias" == key || "bookmark" == key || "memo" == key || "icon" == key || strings.HasPrefix(key, "custom-") {
			tree.Root.SetIALAttr(key, value)
		}
	}
	tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	if err = indexWriteTreeUpsertQueue(tree); nil != err {
		return err
	}
	FlushTxQueue()
	return nil
}

func resolveNewItemContentTemplatePath(templatePath string) (string, error) {
	cleanPath := filepath.Clean(filepath.FromSlash(strings.TrimSpace(templatePath)))
	if "" == cleanPath || "." == cleanPath || filepath.IsAbs(cleanPath) || ".." == cleanPath || strings.HasPrefix(cleanPath, ".."+string(os.PathSeparator)) {
		return "", errors.New("invalid content template path")
	}
	templateRoot := filepath.Join(util.DataDir, "templates")
	absPath := filepath.Join(templateRoot, cleanPath)
	rel, err := filepath.Rel(templateRoot, absPath)
	if nil != err || ".." == rel || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", errors.New("content template path is outside templates directory")
	}
	if !filelock.IsExist(absPath) {
		return "", fmt.Errorf("content template [%s] not found", templatePath)
	}
	realRoot, err := filepath.EvalSymlinks(templateRoot)
	if nil != err {
		return "", err
	}
	realPath, err := filepath.EvalSymlinks(absPath)
	if nil != err {
		return "", err
	}
	info, err := os.Stat(realPath)
	if nil != err || !info.Mode().IsRegular() {
		return "", fmt.Errorf("content template [%s] is not a regular file", templatePath)
	}
	realRel, err := filepath.Rel(realRoot, realPath)
	if nil != err || ".." == realRel || strings.HasPrefix(realRel, ".."+string(os.PathSeparator)) {
		return "", errors.New("content template path is outside templates directory")
	}
	return realPath, nil
}

func removeCreatedNewItemDoc(docID string) error {
	blockTree := treenode.GetBlockTree(docID)
	if nil == blockTree {
		return nil
	}
	return RemoveDoc(blockTree.BoxID, blockTree.Path)
}

func newItemCreationError(createErr, cleanupErr error) error {
	if nil == cleanupErr {
		return createErr
	}
	return fmt.Errorf("%w; cleanup failed: %v", createErr, cleanupErr)
}
