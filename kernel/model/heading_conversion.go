// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"

	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type headingConversionIO struct {
	write  func(*parse.Tree, []byte) ([]byte, error)
	remove func(*parse.Tree, []byte) error
}

// 转换完成后统一发布引用和索引；失败及进程中断由共用日志恢复原始认证源。
func commitHeadingConversion(source, target *parse.Tree, sourceBefore, targetBefore []byte, removeSource bool, io headingConversionIO) error {
	sourceSnapshot, _, err := filesys.LoadTreeSnapshot(source.Box, source.Path, util.NewLute())
	if err != nil {
		return err
	}
	var targetSnapshot *parse.Tree
	if targetBefore != nil {
		targetSnapshot, _, err = filesys.LoadTreeSnapshot(target.Box, target.Path, util.NewLute())
		if err != nil {
			return err
		}
	}
	if err = commitDocumentConversionWithIO(source, target, sourceBefore, targetBefore, removeSource, true,
		func(tree *parse.Tree, expected []byte) error {
			_, writeErr := io.write(tree, expected)
			return writeErr
		}, io.remove); err != nil {
		return err
	}
	sql.DeleteRefsTreeQueue(sourceSnapshot)
	if targetSnapshot != nil {
		sql.DeleteRefsTreeQueue(targetSnapshot)
	}
	if removeSource {
		sql.RemoveTreeQueue(source.Box, source.ID)
	} else {
		sql.UpsertTreeQueue(source)
		refreshDocInfo(source)
	}
	sql.UpsertTreeQueue(target)
	refreshDocInfo(target)
	return nil
}

func headingConversionPath(tree *parse.Tree) string {
	return filepath.Join(util.DataDir, tree.Box, tree.Path)
}

func headingConversionDocument(tree *parse.Tree) []*treenode.BlockTree {
	return []*treenode.BlockTree{{ID: tree.ID, RootID: tree.ID, BoxID: tree.Box, Path: tree.Path, Type: "d"}}
}

func checkHeadingConversionBytes(tree *parse.Tree, expected []byte) error {
	current, err := filelock.ReadFile(headingConversionPath(tree))
	if os.IsNotExist(err) && expected == nil {
		return nil
	}
	if err != nil {
		return err
	}
	if !bytes.Equal(current, expected) {
		return errors.New("document changed during heading conversion")
	}
	return nil
}

func sameHeadingConversionTree(left, right *parse.Tree) bool {
	engine := util.NewLute()
	encode := func(tree *parse.Tree) []byte {
		cloned := *tree
		cloned.Root = cloneBlockSwapNode(tree.Root)
		return render.NewJSONRenderer(&cloned, engine.RenderOptions, engine.ParseOptions).Render()
	}
	return bytes.Equal(encode(left), encode(right))
}

func defaultHeadingConversionIO() headingConversionIO {
	return headingConversionIO{
		write: func(tree *parse.Tree, expected []byte) ([]byte, error) {
			var writeErr error
			if expected == nil {
				_, writeErr = filesys.WriteTreeWithPreflight(tree, func() error {
					return checkHeadingConversionBytes(tree, expected)
				})
			} else {
				_, writeErr = filesys.WriteTreeIfUnchanged(tree, expected)
			}
			// 元数据发布可能在文件已写入后失败；只返回确属本次写入的认证源作为补偿基线。
			written, data, readErr := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
			if readErr != nil {
				return nil, errors.Join(writeErr, readErr)
			}
			if !sameHeadingConversionTree(written, tree) {
				return nil, errors.Join(writeErr, errors.New("document changed during heading conversion write"))
			}
			return data, writeErr
		},
		remove: func(tree *parse.Tree, expected []byte) error {
			return filesys.MutateDocumentSources(headingConversionDocument(tree), func() error {
				if err := checkHeadingConversionBytes(tree, expected); err != nil {
					return err
				}
				box := Conf.Box(tree.Box)
				if box == nil {
					return ErrBlockNotFound
				}
				if err := box.Remove(tree.Path); err != nil {
					return err
				}
				cache.RemoveTreeDataInBox(tree.ID, tree.Box)
				cache.RemoveDocIALInBox(tree.Path, tree.Box)
				return nil
			})
		},
	}
}
