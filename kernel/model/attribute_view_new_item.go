// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// NewItemTemplatePreview 描述新增条目模板在当前数据库实例中的解析结果。
type NewItemTemplatePreview struct {
	PrimaryKey string   `json:"primaryKey"`
	BoxID      string   `json:"boxID,omitempty"`
	HPath      string   `json:"hPath,omitempty"`
	Warnings   []string `json:"warnings,omitempty"`

	plan *DocumentCreatePlan
}

// CreateAttributeViewItemResult 描述按模板创建数据库条目的结果。
type CreateAttributeViewItemResult struct {
	ItemID          string   `json:"itemID"`
	BlockID         string   `json:"blockID"`
	Content         string   `json:"content"`
	IsDetached      bool     `json:"isDetached"`
	Warnings        []string `json:"warnings,omitempty"`
	OpenAfterCreate *bool    `json:"openAfterCreate,omitempty"`
	// 自动打开时使用当前分屏；false 或省略时向右分屏打开。
	OpenInCurrentTab bool         `json:"openInCurrentTab,omitempty"`
	Transaction      *Transaction `json:"-"`
}

// CreateAttributeViewItemMarkdown 描述通过数据库条目模板创建文档时使用的 Markdown 内容。
type CreateAttributeViewItemMarkdown struct {
	Title        string
	Markdown     string
	Tags         string
	WithMath     bool
	ClippingHref string
	ListDocTree  bool
}

const (
	CreateAttributeViewItemDocsSaveModeSubDoc   = "subDoc"
	CreateAttributeViewItemDocsSaveModeTemplate = "template"
)

var attributeViewItemDocsLocks sync.Map

// CreateAttributeViewItemDocsResult 描述将游离条目批量转换为文档后的结果。
type CreateAttributeViewItemDocsResult struct {
	ItemIDs        []string     `json:"itemIDs"`
	BlockIDs       []string     `json:"blockIDs"`
	SkippedItemIDs []string     `json:"skippedItemIDs,omitempty"`
	Warnings       []string     `json:"warnings,omitempty"`
	Transaction    *Transaction `json:"-"`
}

// CreateAttributeViewItem 按指定模板创建一个数据库条目。templateID 为空时创建空白游离条目。
func CreateAttributeViewItem(avID, blockID, viewID, templateID, previousID, groupID string, calendarDates ...*int64) (*CreateAttributeViewItemResult, error) {
	return createAttributeViewItem(avID, blockID, viewID, templateID, previousID, groupID, nil, nil, nil, calendarDates...)
}

func CreateAttributeViewItemWithSelection(avID, blockID, viewID, templateID, previousID, groupID string,
	calendarDate *int64, selection *DocumentSelection) (*CreateAttributeViewItemResult, error) {
	return createAttributeViewItem(avID, blockID, viewID, templateID, previousID, groupID, nil, nil, selection, calendarDate)
}

// CreateAttributeViewItemWithMarkdown 按指定的文档类型模板创建数据库条目，并使用传入的 Markdown 创建绑定文档。
func CreateAttributeViewItemWithMarkdown(avID, blockID, viewID, templateID, previousID, groupID string,
	document *CreateAttributeViewItemMarkdown, selections ...*DocumentSelection) (*CreateAttributeViewItemResult, error) {
	if nil == document {
		return nil, errors.New("attribute view item markdown is nil")
	}
	var selection *DocumentSelection
	if len(selections) > 0 {
		selection = selections[0]
	}
	return createAttributeViewItem(avID, blockID, viewID, templateID, previousID, groupID, document, nil, selection)
}

type attributeViewItemCreationOptions struct {
	storageBoxID    string
	storageKnown    bool
	templateTime    time.Time
	primaryFallback string
	expectedPrimary string
	primaryOverride *string
	operations      func(string) (do, undo []*Operation)
}

func createAttributeViewItem(avID, blockID, viewID, templateID, previousID, groupID string,
	document *CreateAttributeViewItemMarkdown, options *attributeViewItemCreationOptions, selection *DocumentSelection, calendarDates ...*int64) (*CreateAttributeViewItemResult, error) {
	var attrView *av.AttributeView
	var err error
	if options != nil && options.storageKnown {
		attrView, err = av.ParseAttributeViewWithStorageContext(avID, options.storageBoxID)
	} else {
		attrView, err = avParseView(avID, blockID)
	}
	if nil != err {
		return nil, err
	}
	createdAt := time.Now()
	renderAt := createdAt
	if options != nil {
		renderAt = options.templateTime
	}
	if selection != nil {
		if options != nil && !selection.Time.Equal(renderAt) {
			return nil, errors.New("new item template preview time changed")
		}
		renderAt = selection.Time
	}
	itemTemplate := attrView.GetNewItemTemplate(templateID)
	var prunedOptions []*av.PrunedNewItemTemplateOption
	if "" != templateID && nil == itemTemplate {
		return nil, fmt.Errorf("new item template [%s] not found", templateID)
	}
	if nil == itemTemplate {
		itemTemplate = &av.NewItemTemplate{TargetType: av.NewItemTargetDetached}
	} else {
		cloned := *attrView
		prunedOptions = cloned.PruneInvalidNewItemTemplateFieldValues()
		if err = cloned.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{itemTemplate}}); nil != err {
			return nil, err
		}
		attrView = &cloned
		itemTemplate = cloned.NewItemTemplates[0]
	}
	if nil != document && av.NewItemTargetDocument != itemTemplate.TargetType {
		return nil, fmt.Errorf("new item template [%s] does not create a bound block", templateID)
	}
	if selection != nil && itemTemplate.TargetType != av.NewItemTargetDocument {
		return nil, documentAddressingError("planChanged", errors.New("new item template target changed after selection"))
	}
	primaryFallback := ""
	if options != nil {
		primaryFallback = options.primaryFallback
	}
	if nil != document {
		primaryFallback = document.Title
	}
	_, templateBoxID := attrView.StoragePath()
	allowCarrierless := options != nil && options.storageKnown
	preview, err := resolveAttributeViewNewItemTemplateWithDocumentContext(blockID, templateBoxID, itemTemplate, renderAt, primaryFallback, allowCarrierless, selection)
	if nil != err {
		return nil, err
	}
	if options != nil && preview.PrimaryKey != options.expectedPrimary {
		return nil, errors.New("new item template preview changed")
	}
	if options != nil && options.primaryOverride != nil {
		preview.PrimaryKey = *options.primaryOverride
		if av.NewItemTargetDocument == itemTemplate.TargetType {
			preview, err = resolveAttributeViewItemDocumentInStorage(blockID, templateBoxID, allowCarrierless, *options.primaryOverride, itemTemplate, renderAt, selection)
			if nil != err {
				return nil, err
			}
		}
	}
	if options != nil && options.storageKnown && itemTemplate.TargetType == av.NewItemTargetDocument && !IsSameCryptoBoundary(options.storageBoxID, preview.BoxID) {
		return nil, errors.New(Conf.Language(381))
	}
	for _, prunedOption := range prunedOptions {
		if templateID == prunedOption.TemplateID {
			preview.Warnings = append(preview.Warnings, fmt.Sprintf(Conf.Language(353),
				prunedOption.KeyID, strings.Join(prunedOption.Values, ", ")))
		}
	}

	dbUpdated := ""
	if blockID != "" {
		var dbTree *parse.Tree
		var loadErr error
		if options != nil && options.storageKnown {
			dbTree, loadErr = LoadTreeByBlockIDInExactBox(blockID, options.storageBoxID)
		} else {
			dbTree, loadErr = LoadTreeByBlockID(blockID)
		}
		if loadErr != nil {
			return nil, loadErr
		}
		dbNode := treenode.GetNodeInTree(dbTree, blockID)
		if dbNode == nil {
			return nil, ErrBlockNotFound
		}
		dbUpdated, templateBoxID = dbNode.IALAttr("updated"), dbTree.Box
	}
	itemID := ast.NewNodeID()
	var additionalDo, additionalUndo []*Operation
	if options != nil {
		additionalDo, additionalUndo = options.operations(itemID)
	}
	fieldValues, err := resolveNewItemFieldValues(attrView, itemTemplate, renderAt, templateBoxID)
	if nil != err {
		return nil, err
	}
	if len(calendarDates) > 0 && nil != calendarDates[0] {
		if err = setNewCalendarItemDate(attrView, blockID, viewID, *calendarDates[0], fieldValues); nil != err {
			return nil, err
		}
	}
	filterContext, err := resolveAttributeViewFilterContext(attrView, nil, blockID)
	if nil != err {
		return nil, err
	}
	if nil != filterContext && 1 > len(filterContext.CurrentDocumentItemIDs) {
		return nil, av.ErrAttributeViewContextNotBound
	}
	// 模板字段会在插入条目后写入，需提前合并上下文关系，避免覆盖插入阶段自动填充的当前文档。
	applyAttributeViewContextFilterDefaultValue(attrView, itemID, filterContext, fieldValues)
	boundBlockID := itemID
	isDetached := av.NewItemTargetDocument != itemTemplate.TargetType
	if isDetached && itemTemplate.Icon != "" {
		fieldValues[attrView.GetBlockKeyValues().Key.ID] = &av.Value{
			Type: av.KeyTypeBlock, IsDetached: true,
			Block: &av.ValueBlock{Content: preview.PrimaryKey, Icon: itemTemplate.Icon},
		}
	}
	var createdTree *parse.Tree
	var createdSources *relationCreatedDocuments
	if options != nil && options.storageKnown {
		createdSources = &relationCreatedDocuments{files: map[string]*documentSourceFile{}}
	}
	if !isDetached {
		boundBlockID, createdTree, err = createAttributeViewItemDocumentWithMarkdown(preview, itemTemplate, document, createdSources)
		if nil != err {
			return nil, err
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
	fieldOperations := buildNewItemFieldValueOperations(attrView, fieldValues, itemID, blockID)
	doOperations = append(doOperations, fieldOperations...)
	doOperations = append(doOperations, additionalDo...)
	if blockID != "" {
		doOperations = append(doOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})
	}

	undoOperations := append(additionalUndo, &Operation{Action: "removeAttrViewBlock", AvID: avID, BlockID: blockID, SrcIDs: []string{itemID}})
	if nil != createdTree {
		undoOperations = append(undoOperations, &Operation{Action: "removeCreatedDoc", ID: boundBlockID, Tree: createdTree})
	}
	if blockID != "" {
		undoOperations = append(undoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: dbUpdated})
	}
	tx := &Transaction{DoOperations: doOperations, UndoOperations: undoOperations, Timestamp: createdAt.UnixMilli()}
	// 关联新建在没有启用自动化时也保留数据库和载体快照，覆盖联合写入失败后的恢复。
	tx.attributeViewItemCreation = options != nil || attrView.HasSubItems()
	tx.MarkFromAPI()
	if err = PerformTxSync(tx); nil != err {
		// 事务回滚可能已经移除新条目，只有仍存在时才清理，避免再次改动恢复后的关联。
		var current *av.AttributeView
		var cleanupErr error
		if options != nil && options.storageKnown {
			current, cleanupErr = av.ParseAttributeViewWithStorageContext(avID, options.storageBoxID)
			if cleanupErr == nil && current.GetBlockValue(itemID) != nil {
				cleanupErr = errors.New("relation item creation recovery is incomplete")
			}
		} else {
			current, cleanupErr = avParseView(avID, blockID)
			if cleanupErr == nil && current.GetBlockValue(itemID) != nil {
				cleanupErr = removeAttributeViewBlock([]string{itemID}, avID, blockID, nil)
			}
		}
		if createdSources != nil {
			if cleanupErr == nil {
				cleanupErr = createdSources.cleanup()
			} else {
				cleanupErr = createdSources.retainedError(cleanupErr)
			}
		} else if nil != createdTree {
			cleanupErr = errors.Join(cleanupErr, removeCreatedNewItemDoc(boundBlockID))
		}
		return nil, newItemCreationError(err, cleanupErr)
	}

	content := preview.PrimaryKey
	if !isDetached {
		var blockTree *treenode.BlockTree
		if options != nil && options.storageKnown {
			blockTree = treenode.GetBlockTreeInExactBox(boundBlockID, options.storageBoxID)
		} else {
			blockTree = treenode.GetBlockTree(boundBlockID)
		}
		if nil != blockTree {
			content = documentTitleText(blockTree.BoxID, blockTree.RootID)
		}
	}
	return &CreateAttributeViewItemResult{
		ItemID: itemID, BlockID: boundBlockID, Content: content, IsDetached: isDetached,
		Warnings: preview.Warnings, Transaction: tx,
		OpenAfterCreate:  itemTemplate.OpenAfterCreate,
		OpenInCurrentTab: itemTemplate.OpenInCurrentTab,
	}, nil
}

// CreateAttributeViewItemDocs 将指定条目中的游离条目批量创建为文档并绑定。
func CreateAttributeViewItemDocs(avID, blockID, saveMode string, itemIDs []string, selections ...*DocumentSelection) (*CreateAttributeViewItemDocsResult, error) {
	unlock := lockAttributeViewItemDocs(avID)
	defer unlock()

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return nil, err
	}
	itemTemplate, err := attributeViewItemDocumentTemplate(attrView, saveMode)
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

	type itemDoc struct {
		itemID   string
		original *av.Value
		bound    *av.Value
		preview  *NewItemTemplatePreview
		docID    string
		tree     *parse.Tree
	}
	createdAt := time.Now()
	var selection *DocumentSelection
	if len(selections) > 0 {
		selection = selections[0]
	}
	if selection != nil {
		createdAt = selection.Time
	}
	seen := map[string]bool{}
	var items []*itemDoc
	ret := &CreateAttributeViewItemDocsResult{}
	for _, itemID := range itemIDs {
		if "" == itemID || seen[itemID] {
			continue
		}
		seen[itemID] = true
		value := attrView.GetBlockValue(itemID)
		if nil == value || !value.IsDetached || nil == value.Block {
			ret.SkippedItemIDs = append(ret.SkippedItemIDs, itemID)
			continue
		}
		preview, resolveErr := resolveAttributeViewItemDocument(blockID, value.Block.Content, itemTemplate, createdAt, selection)
		if nil != resolveErr {
			return nil, resolveErr
		}
		original := value.Clone()
		if nil == original {
			return nil, fmt.Errorf("clone attribute view item [%s] failed", itemID)
		}
		items = append(items, &itemDoc{itemID: itemID, original: original, preview: preview})
		ret.Warnings = append(ret.Warnings, preview.Warnings...)
	}
	if 0 == len(items) {
		return ret, nil
	}
	plans := make([]*DocumentCreatePlan, 0, len(items))
	for _, item := range items {
		plans = append(plans, item.preview.plan)
	}
	coalesceDocumentPlanAncestors(plans)

	cleanupCreatedDocs := func() error {
		var cleanupErr error
		for i := len(items) - 1; 0 <= i; i-- {
			if "" != items[i].docID {
				cleanupErr = errors.Join(cleanupErr, removeCreatedNewItemDoc(items[i].docID))
			}
		}
		return cleanupErr
	}
	for _, item := range items {
		// 条目已设置的图标优先用于新建文档，未设置时沿用文档模板。
		documentTemplate := *itemTemplate
		if icon, valid := util.FilterIconValue(item.original.Block.Icon); valid && icon != "" {
			documentTemplate.Icon = icon
		}
		item.docID, item.tree, err = createAttributeViewItemDocument(item.preview, &documentTemplate)
		if nil != err {
			return nil, newItemCreationError(err, cleanupCreatedDocs())
		}
		icon, _ := getNodeAvBlockText(item.tree.Root, "")
		item.bound, err = newBoundAttributeViewItemValue(item.original, item.docID, icon)
		if nil != err {
			return nil, newItemCreationError(fmt.Errorf("bind attribute view item [%s] failed: %w", item.itemID, err), cleanupCreatedDocs())
		}
		ret.ItemIDs = append(ret.ItemIDs, item.itemID)
		ret.BlockIDs = append(ret.BlockIDs, item.docID)
	}

	var doOperations, undoOperations []*Operation
	for _, item := range items {
		doOperations = append(doOperations,
			&Operation{Action: "restoreCreatedDoc", ID: item.docID, Tree: item.tree},
			&Operation{
				Action: "replaceAttrViewBlock", AvID: avID, BlockID: blockID, PreviousID: item.itemID, NextID: item.docID,
				IsDetached: false,
			},
			&Operation{
				Action: "updateAttrViewCell", ID: item.bound.ID, AvID: avID, KeyID: item.bound.KeyID,
				RowID: item.itemID, Data: item.bound,
			},
		)
		undoOperations = append(undoOperations,
			&Operation{
				Action: "replaceAttrViewBlock", AvID: avID, BlockID: blockID, PreviousID: item.itemID,
				IsDetached: true,
			},
			&Operation{
				Action: "updateAttrViewCell", ID: item.original.ID, AvID: avID, KeyID: item.original.KeyID,
				RowID: item.itemID, Data: item.original,
			},
			&Operation{Action: "removeCreatedDoc", ID: item.docID, Tree: item.tree},
		)
	}
	doOperations = append(doOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})
	undoOperations = append(undoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: dbNode.IALAttr("updated")})
	tx := &Transaction{DoOperations: doOperations, UndoOperations: undoOperations, Timestamp: createdAt.UnixMilli()}
	tx.MarkFromAPI()
	if err = PerformTxSync(tx); nil != err {
		var cleanupErr error
		for _, item := range items {
			_, _, detachErr := replaceAttributeViewBlock(avID, item.itemID, "", true, nil)
			cleanupErr = errors.Join(cleanupErr, detachErr)
			_, restoreErr := UpdateAttributeViewCell(nil, avID, item.original.KeyID, item.itemID, item.original)
			cleanupErr = errors.Join(cleanupErr, restoreErr)
		}
		cleanupErr = errors.Join(cleanupErr, cleanupCreatedDocs())
		ReloadAttrView(avID)
		return nil, newItemCreationError(err, cleanupErr)
	}
	ret.Transaction = tx
	return ret, nil
}

func newBoundAttributeViewItemValue(original *av.Value, docID, icon string) (*av.Value, error) {
	bound := original.Clone()
	if nil == bound || nil == bound.Block {
		return nil, errors.New("clone attribute view item failed")
	}
	bound.IsDetached = false
	bound.Block.ID = docID
	bound.Block.Content = ""
	bound.Block.Icon = icon
	bound.Block.RefSubtype = av.BlockRefSubtypeDynamic
	return bound, nil
}

func lockAttributeViewItemDocs(avID string) func() {
	lockValue, _ := attributeViewItemDocsLocks.LoadOrStore(avID, &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock
}

func attributeViewItemDocumentTemplate(attrView *av.AttributeView, saveMode string) (*av.NewItemTemplate, error) {
	switch saveMode {
	case CreateAttributeViewItemDocsSaveModeSubDoc:
		return &av.NewItemTemplate{
			TargetType:   av.NewItemTargetDocument,
			SaveLocation: &av.NewItemSaveLocation{},
		}, nil
	case CreateAttributeViewItemDocsSaveModeTemplate:
		itemTemplate := attrView.GetNewItemTemplate(attrView.DefaultTemplateID)
		if nil != itemTemplate && av.NewItemTargetDocument == itemTemplate.TargetType {
			return itemTemplate, nil
		}
		return &av.NewItemTemplate{TargetType: av.NewItemTargetDocument}, nil
	default:
		return nil, fmt.Errorf("invalid create attribute view item documents save mode [%s]", saveMode)
	}
}

func resolveAttributeViewNewItemTemplateWithFallback(blockID string, itemTemplate *av.NewItemTemplate, createdAt time.Time,
	primaryFallback string, selections ...*DocumentSelection) (*NewItemTemplatePreview, error) {
	boxID := ""
	if blockTree := treenode.GetBlockTree(blockID); blockTree != nil {
		boxID = blockTree.BoxID
	} else {
		for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if blockTree := treenode.GetBlockTreeInBox(blockID, encBoxID); blockTree != nil {
				boxID = encBoxID
				break
			}
		}
	}
	return resolveAttributeViewNewItemTemplateWithFallbackInBox(blockID, boxID, itemTemplate, createdAt, primaryFallback, selections...)
}

func resolveAttributeViewNewItemTemplateWithFallbackInBox(blockID, boxID string, itemTemplate *av.NewItemTemplate, createdAt time.Time,
	primaryFallback string, selections ...*DocumentSelection) (*NewItemTemplatePreview, error) {
	return resolveAttributeViewNewItemTemplateWithDocumentContext(blockID, boxID, itemTemplate, createdAt, primaryFallback, false, selections...)
}

func resolveAttributeViewNewItemTemplateWithDocumentContext(blockID, boxID string, itemTemplate *av.NewItemTemplate, createdAt time.Time,
	primaryFallback string, allowCarrierless bool, selections ...*DocumentSelection) (*NewItemTemplatePreview, error) {
	primary, err := RenderGoTemplateAtInBox(itemTemplate.PrimaryKeyTemplate, createdAt, boxID)
	if nil != err {
		return nil, err
	}
	primary = strings.TrimSpace(primary)
	if "" == strings.TrimSpace(itemTemplate.PrimaryKeyTemplate) && "" != strings.TrimSpace(primaryFallback) {
		primary = strings.TrimSpace(primaryFallback)
	}
	preview := &NewItemTemplatePreview{PrimaryKey: primary}
	if av.NewItemTargetDocument != itemTemplate.TargetType {
		return preview, nil
	}
	return resolveAttributeViewItemDocumentInStorage(blockID, boxID, allowCarrierless, primary, itemTemplate, createdAt, selections...)
}

func resolveAttributeViewItemDocument(blockID, primary string, itemTemplate *av.NewItemTemplate, createdAt time.Time, selections ...*DocumentSelection) (*NewItemTemplatePreview, error) {
	return resolveAttributeViewItemDocumentInStorage(blockID, "", false, primary, itemTemplate, createdAt, selections...)
}

func resolveAttributeViewItemDocumentInStorage(blockID, storageBoxID string, allowCarrierless bool, primary string, itemTemplate *av.NewItemTemplate, createdAt time.Time, selections ...*DocumentSelection) (*NewItemTemplatePreview, error) {
	var blockTree *treenode.BlockTree
	if allowCarrierless {
		blockTree = treenode.GetBlockTreeInExactBox(blockID, storageBoxID)
	} else {
		blockTree = treenode.GetBlockTree(blockID)
		if blockTree == nil {
			for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if candidate := treenode.GetBlockTreeInBox(blockID, encBoxID); candidate != nil {
					blockTree = candidate
					break
				}
			}
		}
	}
	currentBoxID := storageBoxID
	var contextID *string
	if blockTree != nil {
		currentBoxID, contextID = blockTree.BoxID, &blockTree.RootID
	} else {
		if !allowCarrierless || blockID != "" {
			return nil, ErrBlockNotFound
		}
		if currentBoxID == "" && itemTemplate.SaveLocation != nil {
			currentBoxID = itemTemplate.SaveLocation.BoxID
		}
		if currentBoxID == "" {
			return nil, errors.New("new item document requires an explicit notebook without a database carrier")
		}
		if !IsSameCryptoBoundary(storageBoxID, currentBoxID) {
			return nil, errors.New(Conf.Language(381))
		}
	}
	primary = normalizeDocumentTitle(primary)

	target, err := resolveNewItemDocumentTarget(currentBoxID, itemTemplate.SaveLocation)
	if err != nil {
		return nil, err
	}
	if treenode.DocumentMetadataState(target.Notebook) != "ready" {
		if err = recoverDocumentMetadata(target.Notebook); err != nil {
			return nil, err
		}
	}
	request := DocumentPlanRequest{Notebook: currentBoxID, Purpose: "document", ContextID: contextID,
		ID: ast.NewNodeID(), Now: createdAt, Target: target, SkipContentTemplateCheck: true}
	request.SelectionRevision = treenode.DocumentRevision([]interface{}{1, blockID, itemTemplate, target})
	if blockTree == nil {
		request.SelectionRevision = treenode.DocumentRevision([]interface{}{1, blockID, currentBoxID, itemTemplate, target})
	}
	if len(selections) > 0 {
		selections[0].apply(&request)
	}
	if primary != "" {
		request.Title = &primary
	}
	plan, err := PlanDocumentCreation(request)
	if err != nil {
		var ambiguity *DocumentAncestorAmbiguity
		if errors.As(err, &ambiguity) {
			return &NewItemTemplatePreview{PrimaryKey: ambiguity.DocumentTitle, BoxID: target.Notebook, HPath: ambiguity.DisplayPath}, err
		}
		return nil, err
	}
	return &NewItemTemplatePreview{PrimaryKey: plan.Title, BoxID: plan.Notebook, HPath: plan.DisplayPath, plan: plan}, nil
}

func createAttributeViewItemDocument(preview *NewItemTemplatePreview, itemTemplate *av.NewItemTemplate) (docID string, tree *parse.Tree, err error) {
	return createAttributeViewItemDocumentWithMarkdown(preview, itemTemplate, nil)
}

func createAttributeViewItemDocumentWithMarkdown(preview *NewItemTemplatePreview, itemTemplate *av.NewItemTemplate,
	document *CreateAttributeViewItemMarkdown, recorders ...*relationCreatedDocuments) (docID string, tree *parse.Tree, err error) {
	var recorder *relationCreatedDocuments
	if len(recorders) > 0 {
		recorder = recorders[0]
	}
	cleanup := func() error {
		if recorder != nil {
			return recorder.cleanup()
		}
		return removeCreatedNewItemDoc(docID)
	}
	if preview.plan == nil || len(preview.plan.Steps) == 0 {
		return "", nil, errors.New("attribute view document creation plan is missing")
	}
	step := &preview.plan.Steps[len(preview.plan.Steps)-1]
	// 数据库正文模板由下方既有流程处理，避免同时应用普通新建模板。
	step.DocCreateTemplatePath = ""
	if nil != document {
		step.Tags, step.Markdown, step.ClippingHref = document.Tags, document.Markdown, document.ClippingHref
		step.WithMath = document.WithMath
		step.ListDocTree = document.ListDocTree && !itemTemplate.HideInFileTree
	}
	if recorder != nil {
		for index := range preview.plan.Steps {
			preview.plan.Steps[index].captureCreatedSource = recorder.capture
		}
	}
	_, err = executeDocumentCreationPlan(preview.plan, false)
	if nil != err {
		if recorder != nil {
			err = newItemCreationError(err, cleanup())
		}
		return
	}
	docID = step.ID
	if nil == document && "" != itemTemplate.ContentTemplatePath {
		if recorder != nil {
			sql.FlushQueue()
			err = applyDocContentTemplateWithRecorder(itemTemplate.ContentTemplatePath, docID, nil, recorder)
			sql.FlushQueue()
		} else {
			err = applyNewItemContentTemplate(itemTemplate.ContentTemplatePath, docID)
		}
		if nil != err {
			err = newItemCreationError(err, cleanup())
			return
		}
	}
	if recorder != nil {
		tree, err = LoadTreeByBlockIDInExactBox(docID, preview.BoxID)
	} else {
		tree, err = LoadTreeByBlockID(docID)
	}
	if nil != err {
		err = newItemCreationError(err, cleanup())
		return
	}
	if applyNewItemDocumentAttrs(tree, itemTemplate) {
		write := func() error { return indexWriteTreeUpsertQueue(tree) }
		if recorder != nil {
			err = recorder.recordOwnWrite(tree, write)
		} else {
			err = write()
		}
		if nil != err {
			err = newItemCreationError(err, cleanup())
			return
		}
		FlushTxQueue()
	}
	return
}

func applyNewItemDocumentAttrs(tree *parse.Tree, itemTemplate *av.NewItemTemplate) (changed bool) {
	if "" != itemTemplate.Icon && tree.Root.IALAttr("icon") != itemTemplate.Icon {
		tree.Root.SetIALAttr("icon", itemTemplate.Icon)
		changed = true
	}
	if itemTemplate.HideInFileTree {
		if "true" != tree.Root.IALAttr(DocHiddenAttr) {
			tree.Root.SetIALAttr(DocHiddenAttr, "true")
			changed = true
		}
	} else if "" != tree.Root.IALAttr(DocHiddenAttr) {
		tree.Root.RemoveIALAttr(DocHiddenAttr)
		changed = true
	}
	return
}

func resolveNewItemDocumentTarget(currentBoxID string, location *av.NewItemSaveLocation) (*EffectiveDocumentTarget, error) {
	var target *EffectiveDocumentTarget
	var err error
	if location == nil {
		target, err = GetDocCreateTarget(currentBoxID, "document")
	} else {
		boxID := location.BoxID
		if boxID == "" {
			boxID = currentBoxID
		}
		if Conf.Box(boxID) == nil {
			return nil, ErrBoxNotFound
		}
		target = &EffectiveDocumentTarget{Notebook: boxID, Path: location.PathTemplate}
	}
	if err != nil {
		return nil, err
	}
	if err = validateNewItemSaveBox(currentBoxID, target.Notebook); err != nil {
		return nil, err
	}
	return target, nil
}

func validateNewItemSaveBox(currentBoxID, targetBoxID string) error {
	if IsEncryptedBox(currentBoxID) && currentBoxID != targetBoxID {
		return errors.New("new attribute view item document in an encrypted notebook must be saved in the current notebook")
	}
	return nil
}

func resolveNewItemFieldValues(attrView *av.AttributeView, itemTemplate *av.NewItemTemplate, createdAt time.Time,
	carrierBoxID string) (ret map[string]*av.Value, err error) {
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
				filterNewItemTemplateRelationValue(attrView, key, value, carrierBoxID)
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

func filterNewItemTemplateRelationValue(attrView *av.AttributeView, key *av.Key, value *av.Value,
	carrierBoxID string) {
	if nil == key.Relation || nil == value.Relation {
		return
	}
	targetAv := attrView
	if key.Relation.AvID != attrView.ID {
		contextFilter := &av.AttributeViewContextFilter{
			Spec: av.AttributeViewContextFilterSpec, KeyID: key.ID,
		}
		targetAv, _ = resolveAttributeViewContextFilterTarget(attrView, contextFilter, carrierBoxID)
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

func buildNewItemFieldValueOperations(attrView *av.AttributeView, fieldValues map[string]*av.Value, itemID,
	blockID string) (ret []*Operation) {
	for _, keyValues := range attrView.KeyValues {
		if nil == keyValues || nil == keyValues.Key {
			continue
		}
		keyID := keyValues.Key.ID
		value := fieldValues[keyID]
		if nil == value {
			continue
		}
		ret = append(ret, &Operation{
			Action: "updateAttrViewCell", ID: ast.NewNodeID(), AvID: attrView.ID, BlockID: blockID,
			KeyID: keyID, RowID: itemID, Data: value,
		})
	}
	return
}

func applyNewItemContentTemplate(templatePath, docID string) error {
	return applyDocContentTemplateAfterIndex(templatePath, docID)
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
