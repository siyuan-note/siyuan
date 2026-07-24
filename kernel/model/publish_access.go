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
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PublishAccessItem struct {
	ID       string `json:"id"`
	Visible  bool   `json:"visible"`  // 是否发布可见
	Password string `json:"password"` // 密码，为空字符串时表示无密码
	Disable  bool   `json:"disable"`  // 是否禁止发布
}

type PublishAccess []*PublishAccessItem

var (
	publishAccessLastModified int64
	publishAccess             PublishAccess
	publishAccessLock         = sync.Mutex{}
)

func GetPublishAccess() (ret PublishAccess) {
	ret = PublishAccess{}
	now := time.Now().UnixMilli()
	if now-publishAccessLastModified < 30*1000 {
		return publishAccess
	}

	publishAccessLock.Lock()
	defer publishAccessLock.Unlock()

	publishAccessLastModified = now

	publishAccessPath := filepath.Join(util.DataDir, ".siyuan", "publishAccess.json")
	err := os.MkdirAll(filepath.Dir(publishAccessPath), 0755)
	if err != nil {
		return
	}
	if !filelock.IsExist(publishAccessPath) {
		if err = filelock.WriteFile(publishAccessPath, []byte("[]")); err != nil {
			logging.LogErrorf("create publishAccess.json [%s] failed: %s", publishAccessPath, err)
			return
		}
	}
	data, err := os.ReadFile(publishAccessPath)
	if err != nil {
		logging.LogErrorf("read publishAccess.json [%s] failed: %s", publishAccessPath, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &publishAccess); err != nil {
		logging.LogWarnf("unmarshal publishAccess.json failed: %s", err)
		return
	}
	ret = publishAccess
	return
}

func SetPublishAccess(inputPublishAccess PublishAccess) (err error) {
	now := time.Now().UnixMilli()
	publishAccessLock.Lock()
	defer publishAccessLock.Unlock()
	publishAccessLastModified = now
	publishAccess = inputPublishAccess

	publishAccessPath := filepath.Join(util.DataDir, ".siyuan", "publishAccess.json")
	err = os.MkdirAll(filepath.Dir(publishAccessPath), 0755)
	if err != nil {
		msg := fmt.Sprintf("create dir for publishAccess.json [%s] failed: %s", publishAccessPath, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}

	data, err := gulu.JSON.MarshalJSON(inputPublishAccess)
	if err != nil {
		logging.LogErrorf("marshal publishAccess.json [%s] failed: %s", publishAccessPath, err)
		return
	}

	err = filelock.WriteFile(publishAccessPath, data)
	if err != nil {
		msg := fmt.Sprintf("write publishAccess.json [%s] failed: %s", publishAccessPath, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}
	return
}

func GetInvisiblePublishAccess(inputPublishAccess PublishAccess) (outputPublishAccess PublishAccess) {
	outputPublishAccess = PublishAccess{}
	for _, item := range inputPublishAccess {
		if !item.Visible {
			outputPublishAccess = append(outputPublishAccess, item)
		}
	}
	return
}

func GetDisablePublishAccess(inputPublishAccess PublishAccess) (outputPublishAccess PublishAccess) {
	outputPublishAccess = PublishAccess{}
	for _, item := range inputPublishAccess {
		if item.Disable {
			outputPublishAccess = append(outputPublishAccess, item)
		}
	}
	return
}

func PurgePublishAccess() {
	publishAccess := GetPublishAccess()
	IDs := []string{}
	for _, item := range publishAccess {
		IDs = append(IDs, item.ID)
	}

	boxes, err := ListNotebooks()
	if err != nil {
		return
	}
	// 必须在所有笔记本都打开的情况下才能执行清除工作，否则会把关闭的笔记本里文档的发布访问控制状态清除
	for _, box := range boxes {
		if box.Closed {
			return
		}
	}

	checkResult := treenode.ExistBlockTrees(IDs)
	tempPublishAccess := PublishAccess{}
	for i, ID := range IDs {
		if exists, ok := checkResult[ID]; ok && exists {
			tempPublishAccess = append(tempPublishAccess, publishAccess[i])
		} else {
			for _, box := range boxes {
				if box.ID == ID {
					tempPublishAccess = append(tempPublishAccess, publishAccess[i])
					break
				}
			}
		}
	}
	SetPublishAccess(tempPublishAccess)
	return
}

func CheckPathAccessableByPublishIgnore(box string, path string, publishIgnore PublishAccess) bool {
	for _, item := range publishIgnore {
		if item.ID == box || strings.Contains(path, item.ID) {
			return false
		}
	}
	return true
}

func GetPathPasswordByPublishAccess(box string, blockPath string, publishAccess PublishAccess) (passwordID string, password string) {
	currentPath := blockPath
	password = ""
	passwordID = ""
	for currentPath != "/" && password == "" {
		currentID := strings.TrimSuffix(path.Base(currentPath), ".sy")
		for _, accessItem := range publishAccess {
			if accessItem.ID == currentID {
				password = accessItem.Password
				passwordID = accessItem.ID
				break
			}
		}
		currentPath = path.Dir(currentPath)
	}
	if password == "" {
		for _, accessItem := range publishAccess {
			if accessItem.ID == box {
				password = accessItem.Password
				passwordID = accessItem.ID
				break
			}
		}
	}
	return
}

func CheckBlockIdAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, blockID string) bool {
	return CheckBlockIdAccessableByPublishAccessInBox(c, publishAccess, blockID, "")
}

func CheckBlockIdAccessableByPublishAccessInBox(c *gin.Context, publishAccess PublishAccess, blockID, boxID string) bool {
	bt := treenode.GetBlockTreeInBox(blockID, boxID)
	return checkBlockTreeAccessableByPublishAccess(c, publishAccess, bt)
}

func CheckBlockIdMetadataAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, blockID string) bool {
	return CheckBlockIdMetadataAccessableByPublishAccessInBox(c, publishAccess, blockID, "")
}

func CheckBlockIdMetadataAccessableByPublishAccessInBox(c *gin.Context, publishAccess PublishAccess, blockID, boxID string) bool {
	bt := treenode.GetBlockTreeInBox(blockID, boxID)
	return CheckBlockTreeMetadataAccessableByPublishAccess(c, publishAccess, bt)
}

func CheckBlockTreeMetadataAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, bt *treenode.BlockTree) bool {
	if bt == nil {
		return false
	}

	publishDisable := GetDisablePublishAccess(publishAccess)
	if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) {
		return false
	}

	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) {
		return true
	}

	passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
	return password == "" || CheckPublishAuthCookie(c, passwordID, password)
}

func CheckBlockIdDiscoverableByPublishAccessInBox(publishAccess PublishAccess, blockID, boxID string) bool {
	bt := treenode.GetBlockTreeInBox(blockID, boxID)
	return CheckBlockTreeDiscoverableByPublishAccess(publishAccess, bt)
}

func CheckBlockTreeDiscoverableByPublishAccess(publishAccess PublishAccess, bt *treenode.BlockTree) bool {
	if bt == nil {
		return false
	}

	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
	return CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) &&
		CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable)
}

func checkBlockTreeAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, bt *treenode.BlockTree) bool {
	if bt == nil {
		return false
	}

	publishIgnore := GetDisablePublishAccess(publishAccess)
	passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
	return CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password))
}

func SetPublishAuthCookie(c *gin.Context, ID string, password string) {
	authCookie := util.SHA256Hash([]byte(ID + password))
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "publish-auth-" + ID,
		Value:    authCookie,
		MaxAge:   24 * 60 * 60,
		Path:     "/",
		Secure:   util.SSL,
		HttpOnly: true,
	})
}

func CheckPublishAuthCookie(c *gin.Context, ID string, password string) bool {
	authCookie, err := c.Request.Cookie("publish-auth-" + ID)
	return err == nil && authCookie.Value == util.SHA256Hash([]byte(ID+password))
}

func CheckAbsPathAccessableByPublishAccess(c *gin.Context, absPath string, publishAccess PublishAccess) bool {
	absPath = filepath.Clean(absPath)

	if gulu.File.IsSubPath(util.HistoryDir, absPath) {
		return false
	}

	if gulu.File.IsSubPath(util.DataDir, absPath) {
		relPath, err := filepath.Rel(util.DataDir, absPath)
		if err != nil {
			return true
		}

		relPath = strings.ReplaceAll(relPath, "\\", "/")

		pathParts := strings.Split(relPath, "/")
		if len(pathParts) <= 1 {
			return true
		}

		if ast.IsNodeIDPattern(pathParts[0]) {
			box := pathParts[0]
			if 2 < len(pathParts) && "assets" == pathParts[1] {
				assetPath := strings.Join(pathParts[1:], "/")
				return checkAssetPathAccessableByPublishAccess(c, publishAccess, assetPath, box)
			}
			blockPath := "/" + strings.Join(pathParts[1:], "/")
			passwordID, password := GetPathPasswordByPublishAccess(box, blockPath, publishAccess)
			publishIgnore := GetDisablePublishAccess(publishAccess)
			return CheckPathAccessableByPublishIgnore(box, blockPath, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password))
		} else if pathParts[0] == "assets" {
			return checkAssetPathAccessableByPublishAccess(c, publishAccess, relPath, "")
		}
	}
	return false
}

func checkAssetPathAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, assetPath, boxID string) bool {
	publishIgnore := GetDisablePublishAccess(publishAccess)
	itemAccessCache := map[*av.AttributeView]map[string]bool{}
	itemFilter := func(attrView *av.AttributeView, itemID string) bool {
		itemAccess := itemAccessCache[attrView]
		if nil == itemAccess {
			itemAccess = map[string]bool{}
			itemAccessCache[attrView] = itemAccess
		}
		if accessable, ok := itemAccess[itemID]; ok {
			return accessable
		}

		accessable := checkAttributeViewItemIDAccessableByPublishAccess(c, publishAccess, attrView, itemID)
		itemAccess[itemID] = accessable
		return accessable
	}
	for _, bt := range treenode.GetBlockTreesByType("d") {
		if "" != boxID && bt.BoxID != boxID {
			continue
		}

		passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) ||
			("" != password && !CheckPublishAuthCookie(c, passwordID, password)) {
			continue
		}

		assets, _ := docAssets(bt.ID, false, itemFilter)
		if slices.Contains(assets, assetPath) {
			return true
		}
	}
	return false
}

func FilterViewByPublishAccess(c *gin.Context, publishAccess PublishAccess, viewable av.Viewable) (ret av.Viewable) {
	ret = viewable

	switch ret.GetType() {
	case av.LayoutTypeTable:
		table := ret.(*av.Table)
		filteredRows := []*av.TableRow{}
		for _, row := range table.Rows {
			if checkAttributeViewItemAccessableByPublishAccess(c, publishAccess, row) {
				filteredRows = append(filteredRows, row)
			}
		}
		table.Rows = filteredRows
		if table.Groups != nil {
			for i, viewable := range table.Groups {
				table.Groups[i] = FilterViewByPublishAccess(c, publishAccess, viewable)
			}
		}
	case av.LayoutTypeGallery:
		gallery := ret.(*av.Gallery)
		filteredCards := []*av.GalleryCard{}
		for _, card := range gallery.Cards {
			if checkAttributeViewItemAccessableByPublishAccess(c, publishAccess, card) {
				filteredCards = append(filteredCards, card)
			}
		}
		gallery.Cards = filteredCards
		if gallery.Groups != nil {
			for i, viewable := range gallery.Groups {
				gallery.Groups[i] = FilterViewByPublishAccess(c, publishAccess, viewable)
			}
		}
	case av.LayoutTypeKanban:
		kanban := ret.(*av.Kanban)
		filteredCards := []*av.KanbanCard{}
		for _, card := range kanban.Cards {
			if checkAttributeViewItemAccessableByPublishAccess(c, publishAccess, card) {
				filteredCards = append(filteredCards, card)
			}
		}
		kanban.Cards = filteredCards
		kanban.CardCount = len(kanban.Cards)
		if kanban.Groups != nil {
			for i, viewable := range kanban.Groups {
				kanban.Groups[i] = FilterViewByPublishAccess(c, publishAccess, viewable)
			}
		}
	}
	return
}

func CheckAttributeViewAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, avID string) bool {
	return CheckAttributeViewBlockAccessableByPublishAccess(c, publishAccess, avID, "")
}

func CheckAttributeViewBlockAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, avID, blockID string) bool {
	if !ast.IsNodeIDPattern(avID) {
		return false
	}
	blockIDs := treenode.GetMirrorAttrViewBlockIDs(avID)
	if "" != blockID {
		if !slices.Contains(blockIDs, blockID) {
			node, _, _ := getNodeByBlockID(nil, blockID)
			if nil == node || ast.NodeAttributeView != node.Type || avID != node.AttributeViewID {
				return false
			}
		}
		blockTree := treenode.GetBlockTree(blockID)
		if nil == blockTree {
			for _, encryptedBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if encryptedBlockTree := treenode.GetBlockTreeInBox(blockID, encryptedBoxID); nil != encryptedBlockTree {
					blockTree = encryptedBlockTree
					break
				}
			}
		}
		return checkBlockTreeAccessableByPublishAccess(c, publishAccess, blockTree)
	}
	return checkAttributeViewBlockTreesAccessableByPublishAccess(c, publishAccess, treenode.GetBlockTrees(blockIDs))
}

func checkAttributeViewBlockTreesAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, blockTrees map[string]*treenode.BlockTree) bool {
	for _, blockTree := range blockTrees {
		if checkBlockTreeAccessableByPublishAccess(c, publishAccess, blockTree) {
			return true
		}
	}
	return false
}

func FilterAttributeViewByPublishAccess(c *gin.Context, publishAccess PublishAccess, avID, blockID string, viewable av.Viewable) av.Viewable {
	viewable = FilterViewByPublishAccess(c, publishAccess, viewable)
	attrView, boxID := parseAttributeViewForPublishAccess(avID, blockID)
	filter := &attributeViewPublishAccessFilter{
		c:               c,
		publishAccess:   publishAccess,
		boxID:           boxID,
		attributeViews:  map[string]*av.AttributeView{},
		attributeAccess: map[string]bool{},
		itemAccess:      map[string]map[string]bool{},
	}
	if nil != attrView {
		filter.attributeViews[attrView.ID] = attrView
	}
	filter.filterViewable(attrView, viewable)
	return viewable
}

func parseAttributeViewForPublishAccess(avID, blockID string) (attrView *av.AttributeView, boxID string) {
	if "" != blockID {
		blockTree := treenode.GetBlockTree(blockID)
		if nil == blockTree {
			for _, encryptedBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if encryptedBlockTree := treenode.GetBlockTreeInBox(blockID, encryptedBoxID); nil != encryptedBlockTree {
					blockTree = encryptedBlockTree
					break
				}
			}
		}
		if nil != blockTree && IsEncryptedBox(blockTree.BoxID) {
			boxID = blockTree.BoxID
		}
	}
	if "" != boxID {
		attrView, _ = av.ParseAttributeViewInBox(avID, boxID)
	} else {
		attrView, _ = av.ParseAttributeView(avID)
	}
	return
}

type attributeViewPublishAccessFilter struct {
	c               *gin.Context
	publishAccess   PublishAccess
	boxID           string
	attributeViews  map[string]*av.AttributeView
	attributeAccess map[string]bool
	itemAccess      map[string]map[string]bool
}

func (filter *attributeViewPublishAccessFilter) filterViewable(attrView *av.AttributeView, viewable av.Viewable) {
	if nil == viewable {
		return
	}

	switch viewable.GetType() {
	case av.LayoutTypeTable:
		table := viewable.(*av.Table)
		filter.filterGroupValue(attrView, table.BaseInstance)
		for _, row := range table.Rows {
			if nil == row {
				continue
			}
			for _, cell := range row.Cells {
				if nil == cell {
					continue
				}
				filter.filterBaseValue(attrView, row.ID, cell.BaseValue)
			}
		}
		for _, group := range table.Groups {
			filter.filterViewable(attrView, group)
		}
	case av.LayoutTypeGallery:
		gallery := viewable.(*av.Gallery)
		filter.filterGroupValue(attrView, gallery.BaseInstance)
		for _, card := range gallery.Cards {
			if nil == card {
				continue
			}
			for _, value := range card.Values {
				if nil == value {
					continue
				}
				filter.filterBaseValue(attrView, card.ID, value.BaseValue)
			}
		}
		for _, group := range gallery.Groups {
			filter.filterViewable(attrView, group)
		}
	case av.LayoutTypeKanban:
		kanban := viewable.(*av.Kanban)
		filter.filterGroupValue(attrView, kanban.BaseInstance)
		for _, card := range kanban.Cards {
			if nil == card {
				continue
			}
			for _, value := range card.Values {
				if nil == value {
					continue
				}
				filter.filterBaseValue(attrView, card.ID, value.BaseValue)
			}
		}
		for _, group := range kanban.Groups {
			filter.filterViewable(attrView, group)
		}
	}
}

func (filter *attributeViewPublishAccessFilter) filterGroupValue(attrView *av.AttributeView, instance *av.BaseInstance) {
	if nil == instance || nil == instance.GroupValue {
		return
	}
	value, changed := filter.filterValue(attrView, instance.GroupKey, instance.GroupValue, instance.GroupValue.BlockID)
	if changed {
		instance.GroupValue = value
	}
}

func (filter *attributeViewPublishAccessFilter) filterBaseValue(attrView *av.AttributeView, itemID string, baseValue *av.BaseValue) {
	if nil == baseValue || nil == baseValue.Value {
		return
	}
	var key *av.Key
	if nil != attrView {
		key, _ = attrView.GetKey(baseValue.Value.KeyID)
	}
	value, changed := filter.filterValue(attrView, key, baseValue.Value, itemID)
	if changed {
		baseValue.Value = value
	}
}

func (filter *attributeViewPublishAccessFilter) filterValue(attrView *av.AttributeView, key *av.Key, value *av.Value, itemID string) (*av.Value, bool) {
	if nil == value {
		return value, false
	}
	switch value.Type {
	case av.KeyTypeRelation:
		return filter.filterRelationValue(key, value)
	case av.KeyTypeRollup:
		return filter.filterRollupValue(attrView, key, value, itemID)
	default:
		return value, false
	}
}

func (filter *attributeViewPublishAccessFilter) filterRelationValue(key *av.Key, value *av.Value) (*av.Value, bool) {
	if nil == value.Relation {
		return value, false
	}
	if 1 > len(value.Relation.BlockIDs) && 1 > len(value.Relation.Contents) {
		return value, false
	}
	if nil == key || nil == key.Relation || "" == key.Relation.AvID {
		return clearAttributeViewSensitiveValue(value), true
	}

	targetAttrView := filter.getAttributeView(key.Relation.AvID)
	if nil == targetAttrView || !filter.isAttributeViewAccessable(targetAttrView.ID) {
		return clearAttributeViewSensitiveValue(value), true
	}

	allowedItemIDs := map[string]bool{}
	changed := false
	for _, itemID := range value.Relation.BlockIDs {
		if filter.isItemAccessable(targetAttrView, itemID) {
			allowedItemIDs[itemID] = true
		} else {
			changed = true
		}
	}
	for _, content := range value.Relation.Contents {
		if nil == content || "" == content.BlockID || !allowedItemIDs[content.BlockID] {
			changed = true
		}
	}
	if !changed {
		return value, false
	}

	ret := cloneAttributeViewSensitiveValue(value)
	ret.Relation.BlockIDs = ret.Relation.BlockIDs[:0]
	for _, itemID := range value.Relation.BlockIDs {
		if allowedItemIDs[itemID] {
			ret.Relation.BlockIDs = append(ret.Relation.BlockIDs, itemID)
		}
	}
	ret.Relation.Contents = ret.Relation.Contents[:0]
	for _, content := range value.Relation.Contents {
		if nil != content && allowedItemIDs[content.BlockID] {
			ret.Relation.Contents = append(ret.Relation.Contents, content.Clone())
		}
	}
	return ret, true
}

func (filter *attributeViewPublishAccessFilter) filterRollupValue(attrView *av.AttributeView, key *av.Key, value *av.Value, itemID string) (*av.Value, bool) {
	if nil == value.Rollup || 1 > len(value.Rollup.Contents) {
		return value, false
	}

	targetAttrView, targetKey, targetItemIDs, ok := filter.getRollupTarget(attrView, key, itemID)
	if !ok {
		return clearAttributeViewSensitiveValue(value), true
	}
	for _, targetItemID := range targetItemIDs {
		if !filter.isItemAccessable(targetAttrView, targetItemID) ||
			!filter.checkKeyDependencies(targetAttrView, targetKey, targetItemID, map[string]bool{}) {
			return clearAttributeViewSensitiveValue(value), true
		}
	}

	var ret *av.Value
	for i, content := range value.Rollup.Contents {
		if nil == content {
			return clearAttributeViewSensitiveValue(value), true
		}
		filteredContent, changed := filter.filterValue(targetAttrView, targetKey, content, content.BlockID)
		if !changed {
			continue
		}
		if nil == ret {
			ret = cloneAttributeViewSensitiveValue(value)
		}
		ret.Rollup.Contents[i] = filteredContent
	}
	if nil == ret {
		return value, false
	}
	return ret, true
}

func (filter *attributeViewPublishAccessFilter) getRollupTarget(attrView *av.AttributeView, key *av.Key, itemID string) (targetAttrView *av.AttributeView, targetKey *av.Key, targetItemIDs []string, ok bool) {
	if nil == attrView || nil == key || nil == key.Rollup || "" == itemID {
		return
	}
	relationKey, _ := attrView.GetKey(key.Rollup.RelationKeyID)
	if nil == relationKey || nil == relationKey.Relation || "" == relationKey.Relation.AvID {
		return
	}
	relationValue := attrView.GetValue(relationKey.ID, itemID)
	if nil == relationValue || nil == relationValue.Relation {
		return
	}

	targetAttrView = filter.getAttributeView(relationKey.Relation.AvID)
	if nil == targetAttrView || !filter.isAttributeViewAccessable(targetAttrView.ID) {
		return nil, nil, nil, false
	}
	targetKey, _ = targetAttrView.GetKey(key.Rollup.KeyID)
	if nil == targetKey {
		return nil, nil, nil, false
	}
	targetItemIDs = relationValue.Relation.BlockIDs
	ok = true
	return
}

func (filter *attributeViewPublishAccessFilter) checkKeyDependencies(attrView *av.AttributeView, key *av.Key, itemID string, visited map[string]bool) bool {
	if nil == attrView || nil == key || "" == itemID {
		return false
	}
	visitKey := attrView.ID + "\x00" + key.ID + "\x00" + itemID
	if visited[visitKey] {
		return true
	}
	visited[visitKey] = true

	switch key.Type {
	case av.KeyTypeRelation:
		if nil == key.Relation || "" == key.Relation.AvID {
			return false
		}
		value := attrView.GetValue(key.ID, itemID)
		if nil == value || nil == value.Relation || 1 > len(value.Relation.BlockIDs) {
			return true
		}
		targetAttrView := filter.getAttributeView(key.Relation.AvID)
		if nil == targetAttrView || !filter.isAttributeViewAccessable(targetAttrView.ID) {
			return false
		}
		for _, targetItemID := range value.Relation.BlockIDs {
			if !filter.isItemAccessable(targetAttrView, targetItemID) {
				return false
			}
		}
	case av.KeyTypeRollup:
		targetAttrView, targetKey, targetItemIDs, ok := filter.getRollupTarget(attrView, key, itemID)
		if !ok {
			value := attrView.GetValue(key.ID, itemID)
			return nil == value || nil == value.Rollup || 1 > len(value.Rollup.Contents)
		}
		for _, targetItemID := range targetItemIDs {
			if !filter.isItemAccessable(targetAttrView, targetItemID) ||
				!filter.checkKeyDependencies(targetAttrView, targetKey, targetItemID, visited) {
				return false
			}
		}
	}
	return true
}

func (filter *attributeViewPublishAccessFilter) getAttributeView(avID string) *av.AttributeView {
	if attrView, ok := filter.attributeViews[avID]; ok {
		return attrView
	}
	var attrView *av.AttributeView
	if "" != filter.boxID {
		attrView, _ = av.ParseAttributeViewInBox(avID, filter.boxID)
	} else {
		attrView, _ = av.ParseAttributeView(avID)
	}
	filter.attributeViews[avID] = attrView
	return attrView
}

func (filter *attributeViewPublishAccessFilter) isAttributeViewAccessable(avID string) bool {
	if accessable, ok := filter.attributeAccess[avID]; ok {
		return accessable
	}
	accessable := CheckAttributeViewAccessableByPublishAccess(filter.c, filter.publishAccess, avID)
	filter.attributeAccess[avID] = accessable
	return accessable
}

func (filter *attributeViewPublishAccessFilter) isItemAccessable(attrView *av.AttributeView, itemID string) bool {
	if nil == attrView || "" == itemID {
		return false
	}
	access := filter.itemAccess[attrView.ID]
	if nil == access {
		access = map[string]bool{}
		filter.itemAccess[attrView.ID] = access
	}
	if accessable, ok := access[itemID]; ok {
		return accessable
	}
	accessable := checkAttributeViewItemIDAccessableByPublishAccess(filter.c, filter.publishAccess, attrView, itemID)
	access[itemID] = accessable
	return accessable
}

func cloneAttributeViewSensitiveValue(value *av.Value) *av.Value {
	ret := value.Clone()
	if nil != ret {
		return ret
	}
	return &av.Value{
		ID:         value.ID,
		KeyID:      value.KeyID,
		BlockID:    value.BlockID,
		Type:       value.Type,
		IsDetached: value.IsDetached,
		CreatedAt:  value.CreatedAt,
		UpdatedAt:  value.UpdatedAt,
	}
}

func clearAttributeViewSensitiveValue(value *av.Value) *av.Value {
	ret := cloneAttributeViewSensitiveValue(value)
	switch value.Type {
	case av.KeyTypeRelation:
		ret.Relation = &av.ValueRelation{}
	case av.KeyTypeRollup:
		ret.Rollup = &av.ValueRollup{}
	}
	return ret
}

func checkAttributeViewItemAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, item av.Item) bool {
	if nil == item {
		return false
	}

	blockValue := item.GetBlockValue()
	if nil == blockValue {
		return false
	}
	if blockValue.IsDetached {
		return true
	}
	if nil == blockValue.Block || "" == blockValue.Block.ID {
		return false
	}
	return CheckBlockIdAccessableByPublishAccess(c, publishAccess, blockValue.Block.ID)
}

func checkAttributeViewItemIDAccessableByPublishAccess(
	c *gin.Context,
	publishAccess PublishAccess,
	attrView *av.AttributeView,
	itemID string,
) bool {
	if nil == attrView || "" == itemID {
		return false
	}

	blockValue := attrView.GetBlockValue(itemID)
	if nil == blockValue {
		return false
	}
	if blockValue.IsDetached {
		return true
	}
	if nil == blockValue.Block || "" == blockValue.Block.ID {
		return false
	}
	return CheckBlockIdAccessableByPublishAccess(c, publishAccess, blockValue.Block.ID)
}

func FilterBlockAttributeViewKeysByPublishAccess(c *gin.Context, publishAccess PublishAccess, blockAttributeViewKeys []*BlockAttributeViewKeys) (ret []*BlockAttributeViewKeys) {
	publishIgnore := GetDisablePublishAccess(publishAccess)
	ret = []*BlockAttributeViewKeys{}
	for _, blockAttributeViewKey := range blockAttributeViewKeys {
		accessable := false
		bts := treenode.GetBlockTrees(blockAttributeViewKey.BlockIDs)
		for _, bt := range bts {
			passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if (password == "" || CheckPublishAuthCookie(c, passwordID, password)) && CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
				accessable = true
				break
			}
		}
		if accessable {
			blockAttributeViewKey.ItemPositions = nil
			ret = append(ret, blockAttributeViewKey)
		}
	}
	return
}

func FilterAttributeViewBacklinksByPublishAccess(c *gin.Context, publishAccess PublishAccess, backlinks *AttributeViewBacklinks) (ret *AttributeViewBacklinks) {
	ret = &AttributeViewBacklinks{Items: []*AttributeViewBacklink{}}
	if nil == backlinks {
		return
	}

	publishIgnore := GetDisablePublishAccess(publishAccess)
	accessibleTargetAvIDs := map[string]bool{}
	checkedTargetAvIDs := map[string]bool{}
	cachedBlockTrees := map[string]map[string]*treenode.BlockTree{}
	for _, backlink := range backlinks.Items {
		var relations []*AttributeViewBacklinkRelation
		for _, relation := range backlink.Relations {
			if !checkedTargetAvIDs[relation.TargetAvID] {
				checkedTargetAvIDs[relation.TargetAvID] = true
				for _, bt := range treenode.GetBlockTrees(treenode.GetMirrorAttrViewBlockIDs(relation.TargetAvID)) {
					passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
					if ("" == password || CheckPublishAuthCookie(c, passwordID, password)) &&
						CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
						accessibleTargetAvIDs[relation.TargetAvID] = true
						break
					}
				}
			}
			if accessibleTargetAvIDs[relation.TargetAvID] {
				relations = append(relations, relation)
			}
		}
		if 1 > len(relations) {
			continue
		}
		backlink.Relations = relations

		databaseAccessible := false
		blockTrees := cachedBlockTrees[backlink.AvID]
		if nil == blockTrees {
			blockTrees = treenode.GetBlockTrees(backlink.BlockIDs)
			cachedBlockTrees[backlink.AvID] = blockTrees
		}
		for _, blockID := range backlink.BlockIDs {
			bt := blockTrees[blockID]
			if nil == bt {
				continue
			}
			passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if ("" == password || CheckPublishAuthCookie(c, passwordID, password)) &&
				CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
				databaseAccessible = true
				backlink.DatabaseBlockID = bt.ID
				backlink.BoxID = bt.BoxID
				backlink.DatabasePath = bt.HPath
				break
			}
		}
		if !databaseAccessible {
			continue
		}
		if "" != backlink.BoundBlockID && !backlink.IsDetached {
			bt := treenode.GetBlockTree(backlink.BoundBlockID)
			if nil == bt {
				continue
			}
			passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if ("" != password && !CheckPublishAuthCookie(c, passwordID, password)) ||
				!CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
				continue
			}
		}
		ret.Items = append(ret.Items, backlink)
	}
	ret.Total = len(ret.Items)
	return
}

func FilterBlockInfoByPublishAccess(c *gin.Context, publishAccess PublishAccess, info *BlockInfo) (ret *BlockInfo) {
	ret = info
	if info == nil {
		return
	}

	publishIgnore := GetDisablePublishAccess(publishAccess)
	filteredAttrViews := []*AttrView{}
	avIDs := []string{}
	for _, attrView := range info.AttrViews {
		avBlocksAccessable := false
		if attrView.ID != "" {
			avBlockIDs := treenode.GetMirrorAttrViewBlockIDs(attrView.ID)
			avBlocks := treenode.GetBlockTrees(avBlockIDs)
			for _, avBlock := range avBlocks {
				passwordID, password := GetPathPasswordByPublishAccess(avBlock.BoxID, avBlock.Path, publishAccess)
				if (password == "" || CheckPublishAuthCookie(c, passwordID, password)) && CheckPathAccessableByPublishIgnore(avBlock.BoxID, avBlock.Path, publishIgnore) {
					avBlocksAccessable = true
					break
				}
			}
		}
		if avBlocksAccessable {
			filteredAttrViews = append(filteredAttrViews, attrView)
			avIDs = append(avIDs, attrView.ID)
		}
	}
	ret.AttrViews = filteredAttrViews
	ret.IAL[av.NodeAttrNameAvs] = strings.Join(avIDs, ",")

	bt := treenode.GetBlockTree(info.RootID)
	if bt != nil {
		passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if (password != "" && !CheckPublishAuthCookie(c, passwordID, password)) || !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
			ret.IAL["name"] = ""
			ret.IAL["alias"] = ""
			ret.IAL["memo"] = ""
			ret.IAL["bookmark"] = ""
			ret.IAL["tags"] = ""
			ret.RefCount = 0
			ret.RefIDs = []string{}
		}
	}
	return
}

func FilterContentByPublishAccess(c *gin.Context, publishAccess PublishAccess, box string, docPath string, content string, onlyIcon bool) (ret string) {
	ret = content

	// 密码访问
	passwordID, password := GetPathPasswordByPublishAccess(box, docPath, publishAccess)
	if password != "" {
		if !CheckPublishAuthCookie(c, passwordID, password) {
			if onlyIcon {
				passwordHTML := `<div class="protyle-password protyle-password--alert" data-node-id="%s">
	<span class="protyle-password__logo">🔒</span>
</div>`
				ret = fmt.Sprintf(passwordHTML, passwordID)
			} else {
				passwordHTML := `<div class="protyle-password" data-node-id="%s">
	<span class="protyle-password__logo">🔒</span>
	<label class="b3-form__icon protyle-password__content">
		<svg class="b3-form__icon-icon"><use xlink:href="#iconKey"></use></svg>
		<input type="text" class="b3-form__icon-input b3-text-field b3-form__icona-input" placeholder="%s"/>
		<svg class="protyle-password__button b3-form__icona-icon"><use xlink:href="#iconForward"></use></svg>
	</label>
</div>`
				ret = fmt.Sprintf(passwordHTML, passwordID, Conf.Language(283))
			}
		}
	}

	// 禁止访问
	ID := box
	if docPath != "/" {
		ID = strings.TrimSuffix(path.Base(docPath), ".sy")
	}
	publishIgnore := GetDisablePublishAccess(publishAccess)
	if !CheckPathAccessableByPublishIgnore(box, docPath, publishIgnore) {
		if onlyIcon {
			forbiddenHTML := `<div class="protyle-password protyle-password--alert" data-node-id="%s">
	<span class="protyle-password__logo">🚫</span>
</div>`
			ret = fmt.Sprintf(forbiddenHTML, ID)
		} else {
			forbiddenHTML := `<div class="protyle-password protyle-password--forbidden" data-node-id="%s">
	<span class="protyle-password__logo">🚫</span>
	<div class="protyle-password__tip">%s</div>
</div>`
			ret = fmt.Sprintf(forbiddenHTML, ID, Conf.Language(284))
		}
	}
	return
}

func FilterEmbedBlocksByPublishAccess(c *gin.Context, publishAccess PublishAccess, embedBlocks []*EmbedBlock) (ret []*EmbedBlock) {
	ret = []*EmbedBlock{}
	for _, embedBlock := range embedBlocks {
		if nil == embedBlock || nil == embedBlock.Block {
			continue
		}

		block := embedBlock.Block
		publishIgnore := GetDisablePublishAccess(publishAccess)
		passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
		accessible := CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) &&
			(password == "" || CheckPublishAuthCookie(c, passwordID, password))
		if !accessible {
			// 不返回不可访问的查询结果，避免泄漏结果数量、顺序和访问控制边界。
			continue
		}

		ret = append(ret, &EmbedBlock{
			Block: &Block{
				ID:      block.ID,
				Content: block.Content,
			},
			BlockPaths:          embedBlock.BlockPaths,
			AllowChildOperation: embedBlock.AllowChildOperation,
		})
	}
	return
}

func FilterPathsByPublishAccess(c *gin.Context, publishAccess PublishAccess, paths []*Path) (ret []*Path) {
	ret = []*Path{}
	IDs := []string{}

	publishIgnore := GetInvisiblePublishAccess(publishAccess)

	IDtoPathIndexMap := make(map[string]int)
	for i, path := range paths {
		IDs = append(IDs, path.ID)
		IDtoPathIndexMap[path.ID] = i
	}
	bts := treenode.GetBlockTrees(IDs)
	for _, bt := range bts {
		if bt == nil {
			continue
		}
		pathIndex := IDtoPathIndexMap[bt.ID]
		path := paths[pathIndex]
		passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
			ret = append(ret, path)
		}
	}
	return
}

func FilterBlocksByPublishAccess(c *gin.Context, publishAccess PublishAccess, blocks []*Block) (ret []*Block) {
	ret = []*Block{}

	publishIgnore := GetInvisiblePublishAccess(publishAccess)

	for _, block := range blocks {
		passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
		if CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) && (c == nil || password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
			ret = append(ret, block)
		}
	}
	return
}

func FilterSearchDocsByPublishAccess(c *gin.Context, publishAccess PublishAccess, docs []map[string]string) (ret []map[string]string) {
	ret = []map[string]string{}

	publishIgnore := GetInvisiblePublishAccess(publishAccess)

	for _, doc := range docs {
		box, docPath := doc["box"], doc["path"]
		if !ast.IsNodeIDPattern(box) || (docPath != "/" && !strings.HasPrefix(docPath, "/")) {
			continue
		}
		passwordID, password := GetPathPasswordByPublishAccess(box, docPath, publishAccess)
		if CheckPathAccessableByPublishIgnore(box, docPath, publishIgnore) &&
			(password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
			ret = append(ret, doc)
		}
	}
	return
}

func FilterBlockTreesByPublishIgnore(publishIgnore PublishAccess, bts map[string]*treenode.BlockTree) (ret map[string]*treenode.BlockTree) {
	ret = map[string]*treenode.BlockTree{}
	for id, bt := range bts {
		if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
			ret[id] = bt
		}
	}
	return
}

func FilterRefDefsByPublishIgnore(publishIgnore PublishAccess, refDefs []*RefDefs) (retRefDefs []*RefDefs, originalRefBlockIDs map[string]string) {
	retRefDefs = []*RefDefs{}
	IDs := []string{}
	for _, refDef := range refDefs {
		IDs = append(IDs, refDef.RefID)
		IDs = append(IDs, refDef.DefIDs...)
	}
	IDs = gulu.Str.RemoveDuplicatedElem(IDs)
	bts := treenode.GetBlockTrees(IDs)
	bts = FilterBlockTreesByPublishIgnore(publishIgnore, bts)
	visibles := make(map[string]bool)
	for _, ID := range IDs {
		visibles[ID] = false
	}
	for _, bt := range bts {
		visibles[bt.ID] = true
	}
	for _, refDef := range refDefs {
		if !visibles[refDef.RefID] {
			continue
		}
		newDefIDs := []string{}
		for i, defID := range refDef.DefIDs {
			if visibles[defID] {
				newDefIDs = append(newDefIDs, refDef.DefIDs[i])
			}
		}
		refDef.DefIDs = newDefIDs
		if len(refDef.DefIDs) > 0 {
			retRefDefs = append(retRefDefs, refDef)
		}
	}
	originalRefBlockIDs = buildBacklinkListItemRefs(retRefDefs)
	return
}

func FilterConfByPublishIgnore(publishIgnore PublishAccess, appConf *AppConf) (ret *AppConf) {
	ret = appConf
	if appConf == nil {
		return
	}

	appConf.UILayout = FilterUILayoutByPublishIgnore(publishIgnore, appConf.UILayout)
	return
}

func FilterUILayoutByPublishIgnore(publishIgnore PublishAccess, uiLayout *conf.UILayout) (ret *conf.UILayout) {
	ret = uiLayout
	if uiLayout == nil {
		return
	}

	layout, ok := (*uiLayout)["layout"].(map[string]any)
	if !ok {
		return
	}
	layout = filterLayoutItemByPublishIgnore(publishIgnore, layout)
	(*ret)["layout"] = layout
	return
}

func filterLayoutItemByPublishIgnore(publishIgnore PublishAccess, item map[string]any) (ret map[string]any) {
	ret = item
	if item == nil {
		return
	}

	instanceItem, exists := item["instance"]
	if !exists {
		return
	}
	instance := instanceItem.(string)
	if instance == "Tab" {
		childrenItem, exists := item["children"]
		if !exists {
			return
		}
		children := childrenItem.(map[string]any)
		if children == nil {
			return
		}
		rootIdItem, exists := children["rootId"]
		if rootIdItem == nil {
			return
		}
		rootId := children["rootId"].(string)
		bt := treenode.GetBlockTree(rootId)
		if bt == nil {
			return
		}
		if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
			ret = nil
		}
	} else {
		childrenItem, exists := item["children"]
		if !exists {
			return
		}
		children := childrenItem.([]any)
		if children == nil {
			return
		}
		newChildren := []any{}
		updateTabs := false
		for _, childItem := range children {
			child := childItem.(map[string]any)
			if child == nil {
				return
			}
			child = filterLayoutItemByPublishIgnore(publishIgnore, child)
			if child != nil {
				newChildren = append(newChildren, child)
			} else {
				updateTabs = true
			}
		}
		if updateTabs {
			hasActive := false
			activeTimes := []int64{}
			for _, childItem := range newChildren {
				child := childItem.(map[string]any)
				activeTimeStr := child["activeTime"].(string)
				var activeTime int64
				if len(activeTimeStr) > 0 {
					activeTime, _ = strconv.ParseInt(activeTimeStr, 10, 64)
				}
				activeTimes = append(activeTimes, activeTime)
				if active, exists := child["active"]; exists && active.(bool) {
					hasActive = true
				}
			}
			if !hasActive && len(activeTimes) > 0 {
				// 如果原本激活的tab刚好被去掉了，就选择日期最新的一个tab激活
				maxIndex := 0
				for i, activeTime := range activeTimes {
					if activeTime > activeTimes[maxIndex] {
						maxIndex = i
					}
				}
				newChildren[maxIndex].(map[string]any)["active"] = true
			}
			if len(newChildren) == 0 {
				child := make(map[string]any)
				child["instance"] = "Tab"
				child["children"] = make(map[string]any)
				newChildren = append(newChildren, child)
			}
		}
		ret["children"] = newChildren
	}
	return
}

func FilterGraphByPublishAccess(c *gin.Context, publishAccess PublishAccess, nodes []*GraphNode, links []*GraphLink) (retNodes []*GraphNode, retLinks []*GraphLink) {
	retNodes = []*GraphNode{}
	retLinks = []*GraphLink{}

	publishIgnore := GetInvisiblePublishAccess(publishAccess)
	nodeByID := make(map[string]*GraphNode, len(nodes))
	virtualNodeIDs := map[string]bool{}
	nodeBaseSizes := make(map[string]float64, len(nodes))
	for _, node := range nodes {
		if node.Box == "" && node.Path == "" {
			nodeByID[node.ID] = node
			virtualNodeIDs[node.ID] = true
		} else {
			if node.Box == "" || node.Path == "" || !CheckPathAccessableByPublishIgnore(node.Box, node.Path, publishIgnore) {
				continue
			}
			passwordID, password := GetPathPasswordByPublishAccess(node.Box, node.Path, publishAccess)
			if password != "" && !CheckPublishAuthCookie(c, passwordID, password) {
				continue
			}
			nodeByID[node.ID] = node
		}

		baseSize := node.Size
		if 0 < node.Defs {
			baseSize /= math.Log2(float64(node.Defs)) + 1
		}
		nodeBaseSizes[node.ID] = baseSize
	}

	filteredLinks := make([]*GraphLink, 0, len(links))
	for _, link := range links {
		if link.From == link.To || nodeByID[link.From] == nil || nodeByID[link.To] == nil {
			continue
		}
		filteredLinks = append(filteredLinks, link)
	}

	reachableNodeIDs := make(map[string]bool, len(nodeByID))
	for nodeID := range nodeByID {
		if !virtualNodeIDs[nodeID] {
			reachableNodeIDs[nodeID] = true
		}
	}
	for _, link := range filteredLinks {
		if virtualNodeIDs[link.From] && !virtualNodeIDs[link.To] {
			reachableNodeIDs[link.From] = true
		}
		if virtualNodeIDs[link.To] && !virtualNodeIDs[link.From] {
			reachableNodeIDs[link.To] = true
		}
	}

	for _, node := range nodes {
		if nodeByID[node.ID] != nil && reachableNodeIDs[node.ID] {
			node.Refs = 0
			node.Defs = 0
			node.Size = nodeBaseSizes[node.ID]
			retNodes = append(retNodes, node)
		}
	}
	for _, link := range filteredLinks {
		from, fromOK := nodeByID[link.From]
		to, toOK := nodeByID[link.To]
		if !fromOK || !toOK || !reachableNodeIDs[link.From] || !reachableNodeIDs[link.To] {
			continue
		}
		from.Refs++
		if link.Ref {
			to.Defs++
			to.Size = (math.Log2(float64(to.Defs)) + 1) * nodeBaseSizes[to.ID]
		}
		retLinks = append(retLinks, link)
	}
	return
}

func FilterTagsByPublishIgnore(publishIgnore PublishAccess, tags *Tags) (ret *Tags) {
	spans := sql.QueryTagSpans("")
	labelCounts := make(map[string]int)
	for _, span := range spans {
		if CheckPathAccessableByPublishIgnore(span.Box, span.Path, publishIgnore) {
			label := util.UnescapeHTML(span.Content)
			labelCounts[label] += 1
		}
	}

	ret = &Tags{}
	for _, tag := range *tags {
		tag := reassignTagCounts(tag, labelCounts)
		if tag != nil {
			*ret = append(*ret, tag)
		}
	}
	return
}

func reassignTagCounts(tag *Tag, counts map[string]int) (ret *Tag) {
	var newChildren Tags
	for _, child := range tag.Children {
		child = reassignTagCounts(child, counts)
		if child != nil {
			newChildren = append(newChildren, child)
		}
	}
	tag.Children = newChildren
	tag.Count = counts[tag.Label]
	if tag.Children == nil && tag.Count == 0 {
		return nil
	}
	return tag
}

func FilterLocalStorageByPublishAccess(publishAccess PublishAccess, localStorage map[string]any) (ret map[string]any) {
	ret = localStorage
	publishIgnore := GetInvisiblePublishAccess(publishAccess)
	// 清空搜索历史记录
	searchKeysItem := ret["local-searchkeys"]
	if searchKeysItem != nil {
		searchKeys := searchKeysItem.(map[string]any)
		if searchKeys != nil {
			searchKeys["keys"] = []string{}
		}
	}
	searchAssetItem := ret["local-searchasset"]
	if searchAssetItem != nil {
		searchAsset := searchAssetItem.(map[string]any)
		if searchAsset != nil {
			searchAsset["k"] = ""
			searchAsset["keys"] = []string{}
		}
	}
	docInfoItem := ret["local-docinfo"]
	if docInfoItem != nil {
		docInfo := docInfoItem.(map[string]any)
		if docInfo != nil {
			idItem := docInfo["id"]
			if idItem != nil {
				id := idItem.(string)
				bt := treenode.GetBlockTree(id)
				if bt != nil {
					if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
						docInfo["id"] = ""
					}
				}
			}
		}
	}
	return
}

func FilterAssetContentByPublishAccess(c *gin.Context, publishAccess PublishAccess, assetContent []*AssetContent) (ret []*AssetContent) {
	publishIgnore := GetInvisiblePublishAccess(publishAccess)
	validAssets := []string{}
	bts := treenode.GetBlockTreesByType("d")
	for _, bt := range bts {
		passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
			assets, err := DocAssets(bt.ID, false)
			if err == nil {
				validAssets = append(validAssets, assets...)
			}
		}
	}

	ret = []*AssetContent{}
	for _, asset := range assetContent {
		if asset == nil {
			continue
		}
		for _, validAsset := range validAssets {
			if validAsset == asset.Path {
				ret = append(ret, asset)
			}
		}
	}
	return
}

func FilterRecentDocsByPublishAccess(c *gin.Context, publishAccess PublishAccess, recentDocs []*RecentDoc) (ret []*RecentDoc) {
	ret = []*RecentDoc{}
	publishIgnore := GetInvisiblePublishAccess(publishAccess)
	for _, recentDoc := range recentDocs {
		bt := treenode.GetBlockTree(recentDoc.RootID)
		if bt != nil {
			passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) && (passwordID == "" || CheckPublishAuthCookie(c, passwordID, password)) {
				ret = append(ret, recentDoc)
			}
		}
	}
	return
}

func FilterCriteriaByPublishAccess(c *gin.Context, publishAccess PublishAccess, criteria []*Criterion) (ret []*Criterion) {
	ret = []*Criterion{}
	publishIgnore := GetInvisiblePublishAccess(publishAccess)
	// IDPath 元素可能是笔记本 ID、文档 ID，或 "笔记本ID/文档ID[.sy]" 路径串，这里统一解析出文档 ID
	blockIDs := map[string]struct{}{}
	for _, criterion := range criteria {
		for _, p := range criterion.IDPath {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			// 路径形式取末段并去掉 .sy 后缀
			id := strings.TrimSuffix(path.Base(p), ".sy")
			if id != "" && id != "." && id != "/" {
				blockIDs[id] = struct{}{}
			}
		}
	}
	blockIDsSlice := make([]string, 0, len(blockIDs))
	for id := range blockIDs {
		blockIDsSlice = append(blockIDsSlice, id)
	}
	blockTrees := treenode.GetBlockTrees(blockIDsSlice)
	for _, criterion := range criteria {
		accessible := false
		for _, p := range criterion.IDPath {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			id := strings.TrimSuffix(path.Base(p), ".sy")
			if id == "" || id == "." || id == "/" {
				continue
			}
			bt := blockTrees[id]
			if bt == nil {
				// 关联的文档不存在，视为不可访问
				accessible = false
				break
			}
			passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) || (passwordID != "" && !CheckPublishAuthCookie(c, passwordID, password)) {
				accessible = false
				break
			}
			accessible = true
		}
		if !accessible {
			// 若 IDPath 全部不可访问（或引用了不可见文档），整条丢弃，避免泄露 HPath
			continue
		}

		// 复制一份后再清空搜索/替换关键字，避免污染缓存
		cloned := *criterion
		cloned.K = ""
		cloned.R = ""
		ret = append(ret, &cloned)
	}
	return
}
