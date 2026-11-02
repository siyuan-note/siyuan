// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type DocumentTitleData struct {
	ID, Notebook, Format, Text, BlockDOM, Revision string
	Empty                                          bool
	Source                                         *ast.DocumentTitle
}

func GetDocTitle(id, boxID string) (*DocumentTitleData, error) {
	FlushTxQueue()
	tree, err := loadTreeByBlockIDInBox(id, boxID)
	if err != nil {
		return nil, err
	}
	if tree.ID != id {
		return nil, errors.New("title source requires a document ID")
	}
	paragraph, err := treenode.DocumentTitleParagraph(tree.Root)
	if err != nil {
		return nil, err
	}
	paragraph.Parent = nil
	paragraph.ID = id
	paragraph.SetIALAttr("id", id)
	luteEngine := util.NewLute()
	fragment := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}, Context: &parse.Context{ParseOption: luteEngine.ParseOptions}}
	fragment.Root.AppendChild(paragraph)
	dom := luteEngine.Tree2BlockDOM(fragment, luteEngine.RenderOptions, luteEngine.ParseOptions)
	dom = strings.Replace(dom, "<div ", "<div data-document-title=\"true\" ", 1)
	summary := treenode.ReadDocumentTitle(tree.Root)
	return &DocumentTitleData{ID: id, Notebook: tree.Box, Format: summary.Format, Text: summary.Text,
		Empty: summary.Empty, BlockDOM: dom, Source: tree.Root.DocumentTitle,
		Revision: treenode.DocumentTitleRevision(tree.Root)}, nil
}

type documentTitleSnapshot struct {
	source   *ast.DocumentTitle
	text     string
	empty    bool
	revision string
}

type documentTitleUndoState struct {
	before, after documentTitleSnapshot
}

type documentTitleWriteState struct {
	id       string
	original []byte
	title    treenode.DocumentTitle
}

// 标题 CAS 保护整个写盘窗口；重放同样从认证快照载入最新正文，而不是恢复旧文档树。
func (tx *Transaction) loadDocumentTitleTree(id string) (*parse.Tree, error) {
	tree, err := tx.loadTree(id)
	if err != nil {
		return nil, err
	}
	tree, original, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, tx.luteEngine)
	if err != nil {
		return nil, err
	}
	tx.trees[tree.ID] = tree
	tx.documentTitleWrite = &documentTitleWriteState{id: tree.ID, original: original,
		title: treenode.ReadDocumentTitle(tree.Root)}
	return tree, nil
}

func (tx *Transaction) writeDocumentTitleTree(tree *parse.Tree, preflight func() error) error {
	snapshot := tx.documentTitleWrite
	if snapshot == nil || snapshot.id != tree.ID {
		return errors.New("document title source snapshot is missing")
	}
	write := func(source *parse.Tree) (uint64, error) {
		return filesys.WriteTreeIfUnchangedWithPreflight(source, snapshot.original, preflight)
	}
	var size uint64
	var err error
	current := treenode.ReadDocumentTitle(tree.Root)
	if snapshot.title.Text != current.Text || snapshot.title.Empty != current.Empty {
		size, err = writeRenameDocWith(tree, write)
	} else {
		size, err = write(tree)
	}
	if errors.Is(err, util.ErrFileChanged) {
		return documentTitleConflict(tree.ID)
	}
	if err != nil {
		return err
	}
	sql.UpsertTreeQueueWithChanges(tree, tx.treeIndexChanges(tree))
	refreshDocInfoWithSize(tree, size)
	return nil
}

var ErrDocumentTitleConflict = errors.New("document title revision conflict")

func documentTitleConflict(id string) *TxErr {
	return &TxErr{code: TxErrCodePushMsg, msg: Conf.Language(445), id: id, cause: ErrDocumentTitleConflict}
}

func captureDocumentTitle(root *ast.Node) documentTitleSnapshot {
	title := treenode.ReadDocumentTitle(root)
	ret := documentTitleSnapshot{source: root.DocumentTitle, text: title.Text, empty: title.Empty,
		revision: treenode.DocumentTitleRevision(root)}
	if ret.source != nil {
		copy := *ret.source
		ret.source = &copy
	}
	return ret
}

func restoreDocumentTitle(root *ast.Node, snapshot documentTitleSnapshot) error {
	root.DocumentTitle = snapshot.source
	root.SetIALAttr("title", snapshot.text)
	if snapshot.empty {
		root.SetIALAttr(treenode.DocumentTitleEmptyAttr, "true")
	} else {
		root.RemoveIALAttr(treenode.DocumentTitleEmptyAttr)
	}
	return treenode.RefreshDocumentTitle(root)
}

// doSetDocTitle 修改独立标题源，内核生成只包含标题的撤销快照，保留同期正文修改。
func (tx *Transaction) doSetDocTitle(operation *Operation) *TxErr {
	fail := func(err error) *TxErr {
		return &TxErr{code: TxErrCodePushMsg, msg: Conf.Language(447), id: operation.ID, cause: err}
	}
	if len(tx.DoOperations) != 1 {
		return fail(errors.New("document title requires a separate transaction"))
	}
	tree, err := tx.loadDocumentTitleTree(operation.ID)
	if err != nil {
		return loadTreeTxErr(operation.ID, err)
	}
	if operation.ID != tree.ID || IsBoxDoc(tree.Box, tree.ID) {
		return fail(errors.New("rich titles require a regular document root"))
	}
	before := captureDocumentTitle(tree.Root)
	if tx.isReplay {
		if operation.documentTitleState == nil {
			return fail(errors.New("document title undo state is unavailable"))
		}
		expected, target := operation.documentTitleState.before, operation.documentTitleState.after
		if operation.documentTitleUndo {
			expected, target = target, expected
		}
		if before.revision != expected.revision {
			return documentTitleConflict(operation.ID)
		}
		if err = restoreDocumentTitle(tree.Root, target); err != nil {
			return fail(err)
		}
	} else {
		data, marshalErr := json.Marshal(operation.Data)
		if marshalErr != nil {
			return fail(marshalErr)
		}
		var request struct {
			BlockDOM         *string         `json:"blockDOM"`
			Source           json.RawMessage `json:"source"`
			ExpectedRevision string          `json:"expectedRevision"`
		}
		if json.Unmarshal(data, &request) != nil || request.ExpectedRevision == "" ||
			(request.BlockDOM == nil) == (len(request.Source) == 0) {
			return fail(errors.New("invalid document title operation"))
		}
		if request.ExpectedRevision != before.revision {
			return documentTitleConflict(operation.ID)
		}
		var paragraph *ast.Node
		if request.BlockDOM != nil {
			if len(*request.BlockDOM) > 4*1024*1024 {
				return fail(errors.New("document title content is too large"))
			}
			dom := strings.ReplaceAll(*request.BlockDOM, editor.FrontEndCaret, "")
			fragment := tx.luteEngine.BlockDOM2Tree(dom)
			for node := fragment.Root.FirstChild; node != nil; node = node.Next {
				if node.Type == ast.NodeKramdownBlockIAL {
					continue
				}
				if node.Type != ast.NodeParagraph || paragraph != nil {
					return fail(errors.New("document titles support inline elements only"))
				}
				paragraph = node
			}
			if paragraph == nil {
				return fail(errors.New("document title paragraph is missing"))
			}
		} else {
			source, parseErr := ast.ParseDocumentTitleJSON(request.Source)
			if parseErr != nil {
				return fail(parseErr)
			}
			paragraph, err = parse.ParseDocumentTitle(source)
			if err != nil {
				return fail(err)
			}
		}
		if tx.degradeCrossBoundaryBlockRefs(paragraph, tree.Box) != 0 {
			return &TxErr{code: TxErrCodePushMsg, msg: Conf.Language(391), id: operation.ID}
		}
		previousParagraph, parseErr := treenode.DocumentTitleParagraph(tree.Root)
		if parseErr != nil {
			return fail(parseErr)
		}
		previousSource, parseErr := render.NewDocumentTitle(previousParagraph)
		if parseErr != nil {
			return fail(parseErr)
		}
		nextSource, parseErr := render.NewDocumentTitle(paragraph)
		if parseErr != nil {
			return fail(parseErr)
		}
		_, plain := treenode.PlainDocumentTitle(paragraph)
		if previousSource.Content == nextSource.Content && !(plain && tree.Root.DocumentTitle != nil) {
			operation.RetData = before.revision
			tx.UndoOperations = nil
			delete(tx.trees, tree.ID)
			tx.documentTitleWrite = nil
			return nil
		}
		if err = treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
			return fail(err)
		}
		if _, err = refreshDocumentTitleAnchors(tree.Root, tree); err != nil {
			return fail(err)
		}
		after := captureDocumentTitle(tree.Root)
		state := &documentTitleUndoState{before: before, after: after}
		operation.documentTitleState = state
		tx.UndoOperations = []*Operation{{Action: "setDocTitle", ID: tree.ID, Data: operation.Data,
			documentTitleState: state, documentTitleUndo: true, RetData: before.revision}}
	}
	if tx.isReplay {
		if _, err = refreshDocumentTitleAnchors(tree.Root, tree); err != nil {
			return fail(err)
		}
	}
	parent, err := documentParentDisplayPath(tree.Box, tree.Path)
	if err != nil {
		return fail(err)
	}
	tree.HPath = parent + "/" + treenode.ReadDocumentTitle(tree.Root).Text
	tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	treenode.UpgradeSpec(tree)
	tx.nodes[tree.ID] = tree.Root
	tx.writeTree(tree)
	operation.RetData = treenode.DocumentTitleRevision(tree.Root)
	return nil
}
