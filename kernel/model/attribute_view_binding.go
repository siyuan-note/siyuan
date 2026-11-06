// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"

	"github.com/88250/gulu"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// preflightAttributeViewCellBindings 按批量更新顺序合并主键副本，在产生反向绑定写入前校验整批目标。
func preflightAttributeViewCellBindings(tx *Transaction, attrView *av.AttributeView, cells []*AttrViewCellUpdate) error {
	key := attrView.GetBlockKey()
	if key == nil {
		return nil
	}
	values := map[string]*av.Value{}
	for _, cell := range cells {
		if cell == nil {
			return av.ErrKeyNotFound
		}
		if cell.KeyID != key.ID {
			continue
		}
		value := values[cell.RowID]
		if value == nil {
			original := attrView.GetBlockValue(cell.RowID)
			if original == nil {
				return av.ErrItemNotFound
			}
			value = original.Clone()
			if value == nil {
				return fmt.Errorf("clone attribute view value [%s] failed", original.ID)
			}
			values[cell.RowID] = value
		}
		data, err := gulu.JSON.MarshalJSON(cell.Data)
		if err != nil {
			return err
		}
		if err = gulu.JSON.UnmarshalJSON(data, value); err != nil {
			return err
		}
		if !value.IsDetached {
			if value.Block == nil {
				return ErrBlockNotFound
			}
			_, tree, loadErr := getNodeByBlockID(tx, value.Block.ID)
			if loadErr != nil {
				return loadErr
			}
			if err = tx.validateAttributeViewBinding(attrView.ID, tree); err != nil {
				return err
			}
		}
	}
	return nil
}

// attributeViewBindingBlockTree 只在数据库所属的加密边界内查找绑定块。
func attributeViewBindingBlockTree(blockID, boxID string) *treenode.BlockTree {
	var ret *treenode.BlockTree
	if boxID != "" {
		ret = treenode.GetBlockTreeInBox(blockID, boxID)
	} else {
		ret = treenode.GetBlockTree(blockID)
	}
	if ret == nil || !IsSameCryptoBoundary(boxID, ret.BoxID) {
		return nil
	}
	return ret
}

// validateAttributeViewBinding 在修改条目和块属性前校验绑定目标，允许事务中尚未入索引的新块。
func validateAttributeViewBinding(avID string, tree *parse.Tree) error {
	if tree == nil {
		return ErrBlockNotFound
	}
	avPath, boxID := av.FindAttributeViewPath(avID)
	if avPath == "" {
		return av.ErrAttributeViewNotFound
	}
	if !IsSameCryptoBoundary(boxID, tree.Box) {
		return errors.New(Conf.Language(381))
	}
	return nil
}

// 已固定边界的关联详情事务不能再次通过全局 ID 映射解释绑定目标。
func (tx *Transaction) validateAttributeViewBinding(avID string, tree *parse.Tree) error {
	if tx != nil {
		if boxID, scoped := tx.attributeViewStorageContexts[avID]; scoped {
			return validateAttributeViewBindingInStorage(avID, boxID, tree)
		}
	}
	return validateAttributeViewBinding(avID, tree)
}

func validateAttributeViewBindingInStorage(avID, boxID string, tree *parse.Tree) error {
	if tree == nil {
		return ErrBlockNotFound
	}
	if path, _ := av.FindAttributeViewPathInBox(avID, boxID); path == "" {
		return av.ErrAttributeViewNotFound
	}
	if !IsSameCryptoBoundary(boxID, tree.Box) {
		return errors.New(Conf.Language(381))
	}
	return nil
}
