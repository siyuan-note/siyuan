// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func MoveLocalShorthands(boxID string) (retIDs []string, err error) {
	shorthandsDir := filepath.Join(util.ShortcutsPath, "shorthands")
	if !gulu.File.IsDir(shorthandsDir) {
		return
	}
	if !syncLock.TryLock() {
		err = errors.New(Conf.Language(222))
		return
	}
	defer syncLock.Unlock()

	if !IsShorthandSaveBoxAvailable(boxID) {
		err = errors.New(Conf.Language(375))
		return
	}
	if err = AcquireEncryptedBoxOperation(boxID); err != nil {
		return
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	entries, err := os.ReadDir(shorthandsDir)
	if err != nil {
		return retIDs, err
	}

	assetsDir := filepath.Join(util.DataDir, "assets")
	for _, entry := range entries {
		if entry.IsDir() && "assets" == entry.Name() {
			assetsEntries, readErr := os.ReadDir(filepath.Join(shorthandsDir, entry.Name()))
			if nil != readErr {
				logging.LogErrorf("read dir [%s] failed: %s", shorthandsDir, readErr)
				return retIDs, readErr
			}
			for _, assetEntry := range assetsEntries {
				if assetEntry.IsDir() {
					continue
				}

				p := filepath.Join(shorthandsDir, entry.Name(), assetEntry.Name())
				assetWritePath := filepath.Join(assetsDir, assetEntry.Name())
				if renameErr := os.Rename(p, assetWritePath); nil != renameErr {
					logging.LogErrorf("rename file [%s] to [%s] failed: %s", p, assetWritePath, renameErr)
					return retIDs, renameErr
				}
			}
		}
	}

	// Complete attachment migration before creating content or consuming a recovered source.
	if recovered, recoveryErr := recoverLocalShorthandCreation(boxID); recoveryErr != nil {
		return nil, recoveryErr
	} else if recovered != "" {
		retIDs = append(retIDs, recovered)
	}

	hPath := Conf.FileTree.Load().ShorthandSavePath
	if "" != hPath {
		var renderErr error
		hPath, renderErr = RenderGoTemplateInBox(hPath, boxID)
		if nil != renderErr {
			logging.LogErrorf("render shorthand save path failed: %s", renderErr)
			hPath = ""
		}
	}

	var toRemoves []string
	// 中途失败也清理已确认写入的源条目，避免下次消费重复创建之前成功的文档。
	defer func() {
		for _, p := range toRemoves {
			if removeErr := os.Remove(p); removeErr != nil && !os.IsNotExist(removeErr) {
				logging.LogErrorf("remove file [%s] failed: %s", p, removeErr)
			}
		}
	}()

	if "" == hPath { // hPath 为空的话每一个速记对应创建一个文档记录
		for _, entry := range entries {
			if filepath.Ext(entry.Name()) != ".md" {
				continue
			}

			p := filepath.Join(shorthandsDir, entry.Name())
			data, readErr := os.ReadFile(p)
			if nil != readErr {
				logging.LogErrorf("read file [%s] failed: %s", p, readErr)
				continue
			}

			content := string(bytes.TrimSpace(data))
			if "" == content {
				toRemoves = append(toRemoves, p)
				continue
			}

			t := strings.TrimSuffix(entry.Name(), ".md")
			i, parseErr := strconv.ParseInt(t, 10, 64)
			if nil != parseErr {
				logging.LogErrorf("parse [%s] to int failed: %s", t, parseErr)
				continue
			}
			created := time.UnixMilli(i)
			hPath = "/" + created.Format("2006-01-02 15:04:05")
			// 块 ID 用速记输入时刻，而非 kernel 消费时刻
			dom := shorthandDOM(content, created)
			docID := util.NodeIDByTime(created)
			var retID string
			retID, err = createShorthandDocByDOM(boxID, hPath, dom, docID, map[string][]byte{p: data})
			if nil != err {
				logging.LogErrorf("create doc failed: %s", err)
				return
			}

			retIDs = append(retIDs, retID)
			toRemoves = append(toRemoves, p)
		}
	} else { // 不为空的话将所有速记合并到指定路径的文档中
		if !strings.HasPrefix(hPath, "/") {
			hPath = "/" + hPath
		}

		type shorthand struct {
			content string
			created time.Time
		}
		var shorthands []shorthand
		var pendingRemoves []string
		sources := map[string][]byte{}
		for _, entry := range entries {
			if filepath.Ext(entry.Name()) != ".md" {
				continue
			}

			p := filepath.Join(shorthandsDir, entry.Name())
			data, readErr := os.ReadFile(p)
			if nil != readErr {
				logging.LogErrorf("read file [%s] failed: %s", p, readErr)
				continue
			}

			content := string(bytes.TrimSpace(data))
			if "" == content {
				toRemoves = append(toRemoves, p)
				continue
			}

			t := strings.TrimSuffix(entry.Name(), ".md")
			i, parseErr := strconv.ParseInt(t, 10, 64)
			var created time.Time
			if nil != parseErr {
				// 文件名不是时间戳时退化为消费时刻，避免丢失速记内容
				created = time.Now()
			} else {
				created = time.UnixMilli(i)
			}
			shorthands = append(shorthands, shorthand{content: content, created: created})
			pendingRemoves = append(pendingRemoves, p)
			sources[p] = data
		}

		if 0 < len(shorthands) {
			plan, planErr := planShorthandDocument(boxID, hPath, ast.NewNodeID(), true)
			if planErr != nil {
				return retIDs, planErr
			}
			bt := treenode.GetBlockTreeInExactBox(plan.ExistingID, boxID)
			if nil == bt {
				// 目标文档不存在，新建文档：根文档块 ID 取所有速记中最早的输入时刻
				earliest := shorthands[0].created
				for _, s := range shorthands[1:] {
					if s.created.Before(earliest) {
						earliest = s.created
					}
				}
				buff := bytes.Buffer{}
				for _, s := range shorthands {
					buff.WriteString(shorthandDOM(s.content, s.created))
				}
				dom := buff.String()
				docID := util.NodeIDByTime(earliest)
				var retID string
				retID, err = createShorthandDocByDOM(boxID, hPath, dom, docID, sources)
				if nil != err {
					logging.LogErrorf("create doc failed: %s", err)
					return
				}
				retIDs = append(retIDs, retID)
			} else {
				var tree *parse.Tree
				tree, err = loadTreeByBlockTree(bt)
				if nil != err {
					logging.LogErrorf("load tree by block tree failed: %s", err)
					return
				}
				var last *ast.Node
				for c := tree.Root.FirstChild; nil != c; c = c.Next {
					last = c
				}

				// 按条独立解析，每条速记的块 ID 用其各自的输入时刻
				luteEngine := util.NewStdLute()
				var nodes []*ast.Node
				for _, s := range shorthands {
					inputTree := parseShorthandMarkdown(s.content, s.created, luteEngine)
					if nil == inputTree {
						continue
					}
					for c := inputTree.Root.FirstChild; nil != c; c = c.Next {
						nodes = append(nodes, c)
					}
				}
				slices.Reverse(nodes)
				blockIDs := make([]string, 0, len(nodes))
				for _, node := range nodes {
					last.InsertAfter(node)
					if node.IsBlock() && node.ID != "" {
						blockIDs = append(blockIDs, node.ID)
					}
				}
				if err = beginLocalShorthandCreation(boxID, tree.ID, tree.Path, blockIDs, sources); err != nil {
					return
				}

				if err = indexWriteTreeUpsertQueue(tree); nil != err {
					logging.LogErrorf("upsert shorthand merged tree failed: %s", err)
					return
				}
				if _, err = recoverLocalShorthandCreation(boxID); err != nil {
					return
				}
				util.PushReloadProtyle(tree.ID)
			}
			toRemoves = append(toRemoves, pendingRemoves...)
		}
	}

	FlushTxQueue()
	box := Conf.Box(boxID)
	for _, id := range retIDs {
		b, _ := GetBlock(id, nil)
		PushCreate(box, b.Path, nil)
	}
	return
}

// resetBlockIDsByTime 递归地将节点及其子孙块的 ID 重置为基于指定时间。
// 无论节点原本是否有 ID 都会主动分配，以兼容上游 lute 未开启 KramdownBlockIAL 的解析路径。
// 重赋 ID 后同步更新 IAL 中的 id 和 updated（updated 取 ID 前 14 位，对齐 createDoc 新建块的处理）。
func resetBlockIDsByTime(node *ast.Node, created time.Time) {
	if nil == node {
		return
	}
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || ast.NodeKramdownBlockIAL == n.Type {
			return ast.WalkContinue
		}
		n.ID = util.NodeIDByTime(created)
		n.SetIALAttr("id", n.ID)
		n.SetIALAttr("updated", util.TimeFromID(n.ID))
		return ast.WalkContinue
	})
}

// shorthandDOM 将速记 markdown 解析为 DOM，并把所有块 ID 替换为基于速记输入时刻。
func shorthandDOM(md string, created time.Time) string {
	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	tree := parseShorthandMarkdown(md, created, luteEngine)
	if nil == tree {
		return ""
	}
	return luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
}

// createShorthandDocByDOM 创建速记文档，使用指定的 DOM 和文档块 ID（均基于速记输入时刻）。
// 速记场景无需 tags、父文档、数学公式、剪藏链接等处理，直接基于 DOM 和指定 docID 落盘。
func createShorthandDocByDOM(boxID, hPath, dom, docID string, sources ...map[string][]byte) (retID string, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()

	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	FlushTxQueue()
	plan, err := planShorthandDocument(boxID, hPath, docID, false)
	if err != nil {
		return "", err
	}
	plan.Steps[len(plan.Steps)-1].DOM = &dom
	if len(sources) > 0 {
		plannedPaths, pathErr := documentCreationPlanPaths(plan)
		if pathErr != nil {
			return "", pathErr
		}
		var blockIDs []string
		for node := util.NewLute().BlockDOM2Tree(dom).Root.FirstChild; node != nil; node = node.Next {
			if node.IsBlock() && node.ID != "" {
				blockIDs = append(blockIDs, node.ID)
			}
		}
		if err = beginLocalShorthandCreation(boxID, docID, plannedPaths[docID], blockIDs, sources[0]); err != nil {
			return "", err
		}
	}
	document, err := executeDocumentCreationPlan(plan, true)
	if nil != err {
		var failure *DocumentCreateFailure
		if len(sources) > 0 && errors.As(err, &failure) && failure.CommitState == "none" {
			_ = os.Remove(localShorthandCreationPath())
		}
		return
	}
	retID = document.ID

	bt := treenode.GetBlockTree(retID)
	if err = verifyShorthandDocPersisted(bt, retID); nil != err {
		return
	}
	if len(sources) > 0 {
		if _, err = recoverLocalShorthandCreation(boxID); err != nil {
			return
		}
	}

	FlushTxQueue()
	PushCreate(box, bt.Path, nil)
	return
}

func planShorthandDocument(boxID, template, id string, reuse bool) (*DocumentCreatePlan, error) {
	if treenode.DocumentMetadataState(boxID) != "ready" {
		if err := recoverDocumentMetadata(boxID); err != nil {
			return nil, err
		}
	}
	// 调用方已按原速记规则渲染模板，不再解释其中产生的 Go 模板语法。
	return PlanDocumentCreation(DocumentPlanRequest{Notebook: boxID, Purpose: "document", ID: id, Reuse: reuse,
		Target: &EffectiveDocumentTarget{Notebook: boxID, Path: template, Rendered: true}})
}

func verifyShorthandDocPersisted(bt *treenode.BlockTree, expectedID string) (err error) {
	if nil == bt {
		return fmt.Errorf("get block tree by id [%s] failed after create", expectedID)
	}
	// 清除写入缓存，确保从文件系统重新读取并验证文档。
	cache.RemoveTreeDataInBox(expectedID, bt.BoxID)
	persisted, err := loadTreeByBlockTree(bt)
	if nil != err {
		return fmt.Errorf("load created shorthand document [%s] failed: %w", expectedID, err)
	}
	if nil == persisted || persisted.ID != expectedID {
		return fmt.Errorf("verify created shorthand document [%s] failed", expectedID)
	}
	return nil
}

var consumeShorthandsLock = sync.Mutex{}
var shorthandSaveBoxUnavailableNotified bool

func isShorthandSaveBoxAvailable(box *Box) bool {
	return nil != box && !box.Closed && !box.Encrypted && !IsUserGuide(box.ID)
}

func selectShorthandSaveBox(configuredID string, boxes []*Box) *Box {
	if "" != configuredID {
		for _, box := range boxes {
			if nil != box && box.ID == configuredID && isShorthandSaveBoxAvailable(box) {
				return box
			}
		}
		return nil
	}

	for _, box := range boxes {
		if isShorthandSaveBoxAvailable(box) {
			return box
		}
	}
	return nil
}

func IsShorthandSaveBoxAvailable(boxID string) bool {
	return isShorthandSaveBoxAvailable(Conf.GetBox(boxID))
}

func consumeShorthands() {
	if !util.IsMobileContainer() {
		return
	}
	if isSyncing.Load() {
		return
	}

	// 消费速记涉及读取临时文件、创建/追加文档、删除临时文件等非原子操作，
	// 启动同步、同步流程、定时任务都可能并发调用，这里串行化避免重复消费或丢失
	consumeShorthandsLock.Lock()
	defer consumeShorthandsLock.Unlock()

	defer logging.Recover()

	shorthandsDir := filepath.Join(util.ShortcutsPath, "shorthands")
	if !gulu.File.IsDir(shorthandsDir) {
		return
	}

	entries, err := os.ReadDir(shorthandsDir)
	if nil != err {
		return
	}

	hasShorthand := false
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".md" {
			hasShorthand = true
			break
		}
	}

	if !hasShorthand {
		shorthandSaveBoxUnavailableNotified = false
		return
	}

	boxes := Conf.GetBoxes()
	box := selectShorthandSaveBox(Conf.FileTree.Load().ShorthandSaveBox, boxes)
	if nil == box {
		logging.LogWarnf("auto consume shorthands failed: no available notebook found")
		if !shorthandSaveBoxUnavailableNotified {
			util.PushErrMsg(Conf.Language(375), 7000)
			shorthandSaveBoxUnavailableNotified = true
		}
		return
	}

	if _, err = MoveLocalShorthands(box.ID); nil != err {
		logging.LogErrorf("auto consume shorthands failed: %s", err)
		return
	}
	shorthandSaveBoxUnavailableNotified = false
}

func AutoConsumeShorthandsJob() {
	consumeShorthands()
}
