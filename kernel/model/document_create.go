// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type DocumentCreateRequest struct {
	Notebook               string
	ParentID               *string
	ID                     string
	TitleFormat            string
	Title                  string
	Markdown               string
	ExpectedParentRevision *string
	ExpectedTarget         *DocumentTargetRevision
	NameConditions         []treenode.DocumentNameCondition
	Tags                   string
	WithMath               bool
	ClippingHref           string
	Sorts                  []string
	SortTargetID           string
	SortPosition           string
	DocCreateTemplatePath  string
	ListDocTree            bool
	Attributes             map[string]string
	TemplateTime           *time.Time
	// DOM 仅供已有块身份的内核业务使用，不能经 Markdown 重解析重分配 ID。
	DOM *string
}

type DocumentCreateFailure struct {
	Reason      string
	CommitState string
	ID          string
	Stage       string
	Completed   []string
	Cause       error
}

func (err *DocumentCreateFailure) Error() string { return err.Cause.Error() }
func (err *DocumentCreateFailure) Unwrap() error { return err.Cause }

func documentCreateFailure(err error, state, id, stage string, completed []string) error {
	reason := "writeFailed"
	var addressingErr *DocumentAddressingError
	if errors.As(err, &addressingErr) {
		reason = addressingErr.Reason
	}
	return &DocumentCreateFailure{Reason: reason, CommitState: state, ID: id, Stage: stage,
		Completed: completed, Cause: err}
}

// documentCreateParent 只沿精确身份读取；不把正文块、外部笔记本或缺失父级转换成根位置。
func documentCreateParent(request *DocumentCreateRequest) (folder, revision string, ancestors map[string]bool, err error) {
	folder, revision = "/", documentRootRevision(request.Notebook)
	ancestors = map[string]bool{"": true}
	if request.ParentID == nil {
		return
	}
	parentID := *request.ParentID
	if !ast.IsNodeIDPattern(parentID) {
		err = documentAddressingError("parentUnavailable", errors.New("invalid parent document ID"))
		return
	}
	parent, readErr := getDocumentPath(request.Notebook, parentID)
	if readErr != nil {
		err = documentAddressingError("parentUnavailable", readErr)
		return
	}
	if IsBoxDoc(request.Notebook, parentID) {
		return
	}
	folder, revision = strings.TrimSuffix(parent.Path, ".sy"), parent.Revision
	for _, segment := range parent.Segments {
		ancestors[segment.ID] = true
	}
	return
}

func checkDocumentCreatePlan(request *DocumentCreateRequest, folder string) error {
	if err := checkDocumentTargetRevision(request); err != nil {
		return err
	}
	if err := checkDocumentPathNotebook(request.Notebook); err != nil {
		return err
	}
	currentFolder, revision, ancestors, err := documentCreateParent(request)
	if err != nil {
		return err
	}
	if currentFolder != folder || request.ExpectedParentRevision != nil && *request.ExpectedParentRevision != revision {
		return documentAddressingError("planChanged", errors.New("parent document changed after planning"))
	}
	for i := range request.NameConditions {
		condition := &request.NameConditions[i]
		parentID := ""
		if condition.ParentID != nil {
			parentID = *condition.ParentID
			if IsBoxDoc(request.Notebook, parentID) {
				condition.ParentID, parentID = nil, ""
			}
		}
		if !ancestors[parentID] {
			return errors.New("name condition is outside the target ancestor chain")
		}
		if condition.Title == "" {
			return documentAddressingError("invalidTitle", errors.New("name condition title must not be empty"))
		}
		if err = ValidateDocumentTitle("plain", condition.Title); err != nil {
			return err
		}
		if condition.ExpectedID != nil && !ast.IsNodeIDPattern(*condition.ExpectedID) {
			return errors.New("invalid expected document ID")
		}
	}
	matched, err := treenode.CheckDocumentNameConditions(request.Notebook, request.Notebook, request.NameConditions)
	if err != nil {
		return documentAddressingError("indexUnavailable", err)
	}
	if !matched {
		return documentAddressingError("planChanged", errors.New("document name matches changed after planning"))
	}
	// 身份索引不是源存在性的替代品，避免外部移除文件后自动重建父目录。
	if folder != "/" {
		if _, err = filesys.ReadDocumentMetadataTree(request.Notebook, folder+".sy"); err != nil {
			return documentAddressingError("parentUnavailable", err)
		}
	}
	if request.SortTargetID != "" {
		target := treenode.GetBlockTreeInExactBox(request.SortTargetID, request.Notebook)
		if !isSortableDocument(target) || path.Dir(target.Path) != folder {
			return documentAddressingError("planChanged", errors.New("sort target is no longer a sibling"))
		}
	}
	return nil
}

// CreateDocByParent 先排空已排队编辑，再锁定父身份；源提交前在公共写入范围内复核名称条件。
// 源一旦提交就不删除或换 ID 重试，排序、正文模板失败返回可恢复的已提交状态。
func CreateDocByParent(request DocumentCreateRequest) (document *treenode.DocumentPath, err error) {
	return createDocByParent(request, false)
}

func createDocByParent(request DocumentCreateRequest, creationLocked bool) (document *treenode.DocumentPath, err error) {
	if !ast.IsNodeIDPattern(request.ID) || len(request.NameConditions) > 128 {
		return nil, errors.New("invalid document ID or too many name conditions")
	}
	if err = ValidateDocumentTitle(request.TitleFormat, request.Title); err != nil {
		return nil, documentCreateFailure(err, "none", "", "validate", []string{})
	}
	if len(request.Sorts) > 0 && request.SortTargetID != "" ||
		(request.SortTargetID == "") != (request.SortPosition == "") ||
		request.SortPosition != "" && request.SortPosition != "before" && request.SortPosition != "after" {
		return nil, errors.New("invalid or conflicting document sort options")
	}
	if err = AcquireEncryptedBoxOperation(request.Notebook); err != nil {
		return
	}
	defer ReleaseEncryptedBoxOperation(request.Notebook)
	if request.ExpectedTarget != nil && request.ExpectedTarget.Notebook != request.Notebook {
		if err = AcquireEncryptedBoxOperation(request.ExpectedTarget.Notebook); err != nil {
			return
		}
		defer ReleaseEncryptedBoxOperation(request.ExpectedTarget.Notebook)
	}
	if !creationLocked {
		createDocLock.Lock()
		defer createDocLock.Unlock()
	}
	var tree *parse.Tree
	var sourceAttempted, sourceWritten bool
	err = func() error {
		flushLock.Lock()
		defer flushLock.Unlock()
		for _, queued := range takeQueuedTransactions() {
			flushTx(queued)
		}
		hpathRefresh.Lock()
		defer hpathRefresh.Unlock()
		if err := checkDocumentPathNotebook(request.Notebook); err != nil {
			return err
		}
		if request.ID == request.Notebook || treenode.GetBlockTree(request.ID) != nil {
			return documentAddressingError("documentIDConflict", errors.New("document ID already exists"))
		}
		folder, _, _, err := documentCreateParent(&request)
		if err != nil {
			return err
		}
		if err = checkDocumentCreatePlan(&request, folder); err != nil {
			return err
		}
		p := path.Join(folder, request.ID+".sy")
		if _, statErr := os.Stat(filepath.Join(util.DataDir, request.Notebook, p)); !os.IsNotExist(statErr) {
			if statErr != nil {
				return statErr
			}
			return documentAddressingError("documentIDConflict", errors.New("document file already exists"))
		}
		validation, err := validateCreateDoc(request.Notebook, p, request.Title, request.Title == "")
		if err != nil {
			return err
		}
		luteEngine := util.NewLute()
		if request.WithMath {
			luteEngine.SetInlineMath(true)
		}
		luteEngine.SetHTMLTag2TextMark(true)
		if strings.HasPrefix(request.ClippingHref, "https://ld246.com/article/") ||
			strings.HasPrefix(request.ClippingHref, "https://liuyun.io/article/") {
			enableLuteInlineSyntax(luteEngine)
		}
		dom := markdownWithFootnotes2BlockDOM(luteEngine, request.Markdown)
		if request.DOM != nil {
			dom = *request.DOM
		}
		attrs := map[string]string{}
		for name, value := range request.Attributes {
			attrs[name] = value
		}
		if request.Tags != "" {
			tags := strings.Split(strings.ReplaceAll(strings.TrimSpace(request.Tags), "，", ","), ",")
			for i := range tags {
				tags[i] = strings.TrimSpace(tags[i])
			}
			attrs["tags"] = strings.Join(tags, ",")
		}
		tree, err = buildCreateDocTree(request.Notebook, validation, dom, attrs)
		if err != nil {
			return err
		}
		var writeErr error
		tx := &Transaction{DoOperations: []*Operation{{Action: "create", Tree: tree}}, fromAPI: true}
		tx.writeTransactionTree = func(source *parse.Tree) error {
			if source.ID != request.ID || source.Box != request.Notebook {
				return writeTreeUpsertQueueWithChanges(source, tx.treeIndexChanges(source))
			}
			size, saveErr := filesys.WriteTreeWithPreflight(source, func() error {
				if err := checkDocumentCreatePlan(&request, folder); err != nil {
					return err
				}
				if _, statErr := os.Stat(filepath.Join(util.DataDir, source.Box, source.Path)); !os.IsNotExist(statErr) {
					if statErr != nil {
						return statErr
					}
					return documentAddressingError("documentIDConflict", errors.New("document file already exists"))
				}
				sourceAttempted = true
				return nil
			})
			sourceWritten = saveErr == nil || size > 0
			if saveErr != nil {
				writeErr = saveErr
				return saveErr
			}
			sql.UpsertTreeQueueWithChanges(source, tx.treeIndexChanges(source))
			refreshDocInfoWithSize(source, size)
			refreshBoxDocInfo(source)
			return nil
		}
		if err = performTxSyncLocked(tx); err != nil {
			if writeErr != nil {
				return writeErr
			}
			return err
		}
		document, err = getDocumentPath(tree.Box, tree.ID)
		return err
	}()
	if err != nil {
		state, confirmedID := "none", ""
		completed := []string{}
		if tree != nil && sourceAttempted {
			if sourceWritten {
				state, confirmedID, completed = "committed", tree.ID, []string{"source"}
			} else if _, readErr := os.Stat(filepath.Join(util.DataDir, tree.Box, tree.Path)); !os.IsNotExist(readErr) {
				state = "unknown"
			} else {
				treenode.RemoveBlockTreesByRootID(tree.Box, tree.ID)
			}
		} else if tree != nil {
			if _, statErr := os.Stat(filepath.Join(util.DataDir, tree.Box, tree.Path)); os.IsNotExist(statErr) {
				treenode.RemoveBlockTreesByRootID(tree.Box, tree.ID)
			}
		}
		return nil, documentCreateFailure(err, state, confirmedID, "source", completed)
	}
	box := Conf.Box(tree.Box)
	PushCreate(box, tree.Path, map[string]any{"listDocTree": request.ListDocTree})
	IncSync()
	if request.SortTargetID != "" {
		_, err = ReorderDocs([]string{tree.ID}, request.SortTargetID, request.SortPosition)
	} else if len(request.Sorts) > 0 {
		err = changeFileTreeSort(tree.Box, request.Sorts)
	} else {
		position := "after"
		if *Conf.FileTree.Load().CreateDocAtTop {
			position = "before"
		}
		err = box.placeDocInSiblingOrder(path.Dir(tree.Path), tree.ID, "", position)
	}
	if err != nil {
		return nil, documentCreateFailure(err, "committed", tree.ID, "sort", []string{"source"})
	}
	if request.Markdown == "" && request.DOM == nil && request.DocCreateTemplatePath != "" {
		sql.FlushQueue()
		if err = applyDocContentTemplateAt(request.DocCreateTemplatePath, tree.ID, request.TemplateTime); err != nil {
			return nil, documentCreateFailure(err, "committed", tree.ID, "template", []string{"source", "sort"})
		}
		sql.FlushQueue()
	}
	return
}
