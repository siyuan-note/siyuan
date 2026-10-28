// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"os"
	"sort"
	"sync"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 源替换和摘要发布共用提交范围，条件创建可以在这里复核名称后立即落盘。
var documentSourceWriteLock sync.Mutex

func lockDocumentSource() func() {
	documentSourceWriteLock.Lock()
	return documentSourceWriteLock.Unlock
}

// LockDocumentConfiguration 与源提交互斥，配置发布后旧的创建预览不能继续落盘。
// 持锁范围不能调用源写入或等待事务队列；配置反应在释放后执行。
func LockDocumentConfiguration() func() { return lockDocumentSource() }

// RecoverDocumentMetadataWrite 根据认证后的源完成中断写入，不用待写入的标题覆盖实际源。
func RecoverDocumentMetadataWrite(doc *treenode.BlockTree) error {
	unlock := lockDocumentSource()
	defer unlock()
	return recoverDocumentMetadataWrite(doc)
}

func recoverDocumentMetadataWrite(doc *treenode.BlockTree) error {
	return newDocumentMetadataReader().recover(doc)
}

func (reader *documentMetadataReader) recover(doc *treenode.BlockTree) error {
	cache.RemoveTreeDataInBox(doc.ID, doc.BoxID)
	cache.RemoveDocIALInBox(doc.Path, doc.BoxID)
	cache.RemoveBlockIALInBox(doc.ID, doc.BoxID)
	tree, err := reader.tree(doc.BoxID, doc.Path)
	if os.IsNotExist(err) {
		if current := treenode.GetBlockTreeInExactBox(doc.ID, doc.BoxID); current != nil && current.Path != doc.Path {
			// 目录变更失败时源可能仍在原位置，不能按未完成的目标路径删除原摘要。
			tree, err = reader.tree(doc.BoxID, current.Path)
		}
	}
	if os.IsNotExist(err) {
		return treenode.FinishDocumentMetadataRecovery(doc.BoxID, doc.ID, true)
	}
	if err != nil {
		return err
	}
	tree.HPath, err = reader.hpath(tree)
	if err != nil {
		return err
	}
	if err = treenode.CommitDocumentMetadataWrite(tree); err != nil {
		return err
	}
	return treenode.FinishDocumentMetadataRecovery(doc.BoxID, doc.ID, false)
}

// MutateDocumentSources 将原始源变更纳入同一提交范围；恢复失败保留标记，不误报源未写入。
// 相同身份的最后一个路径为操作后的预期位置，目录操作按父级先于子级恢复。
func MutateDocumentSources(documents []*treenode.BlockTree, mutate func() error) error {
	if len(documents) == 0 {
		return mutate()
	}
	return MutateDocumentSourceSet(func() ([]*treenode.BlockTree, error) { return documents, nil }, mutate)
}

// MutateDocumentSourceSet 在提交范围内枚举目录，防止遗漏检查期间新增的文档。
func MutateDocumentSourceSet(collect func() ([]*treenode.BlockTree, error), mutate func() error) error {
	unlock := lockDocumentSource()
	defer unlock()
	documents, err := collect()
	if err != nil {
		return err
	}
	unique := map[string]*treenode.BlockTree{}
	for _, doc := range documents {
		unique[doc.BoxID+"/"+doc.ID] = doc
	}
	pending := make([]*treenode.BlockTree, 0, len(unique))
	for _, doc := range unique {
		marked, err := treenode.BeginDocumentMetadataRecovery(doc)
		if err != nil {
			return err
		}
		if marked {
			pending = append(pending, doc)
		}
	}
	err = mutate()
	sort.Slice(pending, func(i, j int) bool { return pending[i].Path < pending[j].Path })
	reader := newDocumentMetadataReader()
	for _, doc := range pending {
		if recoveryErr := reader.recover(doc); recoveryErr != nil {
			logging.LogErrorf("recover document metadata [%s/%s] failed: %s", doc.BoxID, doc.ID, recoveryErr)
		}
	}
	return err
}

func finishDocumentMetadataWrite(tree *parse.Tree, pending bool, err *error) {
	if pending && *err == nil {
		*err = treenode.CommitDocumentMetadataWrite(tree)
	}
}
