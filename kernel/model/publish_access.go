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
	"io/fs"
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
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

type PublishAccessStatus int

const (
	PublishAccessAllowed PublishAccessStatus = iota
	PublishAccessPasswordRequired
	PublishAccessDenied
)

var (
	publishAccessLastModified int64
	publishAccess             PublishAccess
	publishAccessLock         = sync.Mutex{}
)

const publishAccessDenyAllID = "\x00"
const encryptedPublishAccessCacheTTL = 5 * time.Second

var encryptedPublishAccessCache = struct {
	sync.Mutex
	dataDir   string
	updatedAt time.Time
	boxIDs    map[string]struct{}
	denyAll   bool
}{}

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
	outputPublishAccess = filterInvisiblePublishAccess(inputPublishAccess)
	outputPublishAccess = appendEncryptedBoxesToPublishAccess(outputPublishAccess)
	return
}

func filterInvisiblePublishAccess(inputPublishAccess PublishAccess) (outputPublishAccess PublishAccess) {
	outputPublishAccess = PublishAccess{}
	for _, item := range inputPublishAccess {
		if !item.Visible {
			outputPublishAccess = append(outputPublishAccess, item)
		}
	}
	return
}

func GetDisablePublishAccess(inputPublishAccess PublishAccess) (outputPublishAccess PublishAccess) {
	outputPublishAccess = filterDisablePublishAccess(inputPublishAccess)
	outputPublishAccess = appendEncryptedBoxesToPublishAccess(outputPublishAccess)
	return
}

func filterDisablePublishAccess(inputPublishAccess PublishAccess) (outputPublishAccess PublishAccess) {
	outputPublishAccess = PublishAccess{}
	for _, item := range inputPublishAccess {
		if item.Disable {
			outputPublishAccess = append(outputPublishAccess, item)
		}
	}
	return
}

// appendEncryptedBoxesToPublishAccess 将加密笔记本加入发布拒绝列表，使发布访问规则独立于持久化配置和锁定状态。
func appendEncryptedBoxesToPublishAccess(inputPublishAccess PublishAccess) PublishAccess {
	ret := append(PublishAccess{}, inputPublishAccess...)
	existing := map[string]struct{}{}
	for _, item := range ret {
		existing[item.ID] = struct{}{}
	}

	boxIDs, denyAll := encryptedBoxIDsForPublishAccess()
	if denyAll {
		return append(ret, &PublishAccessItem{ID: publishAccessDenyAllID, Disable: true})
	}
	for boxID := range boxIDs {
		if _, ok := existing[boxID]; ok {
			continue
		}
		ret = append(ret, &PublishAccessItem{ID: boxID, Disable: true})
	}
	return ret
}

// encryptedBoxIDsForPublishAccess 返回发布门禁使用的加密笔记本快照，避免在块和属性视图过滤热路径中重复读取配置。
func encryptedBoxIDsForPublishAccess() (map[string]struct{}, bool) {
	encryptedPublishAccessCache.Lock()
	defer encryptedPublishAccessCache.Unlock()

	now := time.Now()
	if encryptedPublishAccessCache.boxIDs != nil &&
		encryptedPublishAccessCache.dataDir == util.DataDir &&
		now.Sub(encryptedPublishAccessCache.updatedAt) < encryptedPublishAccessCacheTTL {
		return encryptedPublishAccessCache.boxIDs, encryptedPublishAccessCache.denyAll
	}

	boxIDs, err := listEncryptedBoxIDsForPublishAccess()
	snapshot := map[string]struct{}{}
	for _, boxID := range boxIDs {
		snapshot[boxID] = struct{}{}
	}
	encryptedPublishAccessCache.dataDir = util.DataDir
	encryptedPublishAccessCache.updatedAt = now
	encryptedPublishAccessCache.boxIDs = snapshot
	encryptedPublishAccessCache.denyAll = err != nil
	if err != nil {
		logging.LogErrorf("list encrypted notebooks for publish access failed: %s", err)
	}
	return snapshot, err != nil
}

func invalidateEncryptedPublishAccessCache() {
	encryptedPublishAccessCache.Lock()
	encryptedPublishAccessCache.updatedAt = time.Time{}
	encryptedPublishAccessCache.boxIDs = nil
	encryptedPublishAccessCache.Unlock()
}

// IsEncryptedBoxDeniedByPublishAccess 判断笔记本是否应被发布门禁拒绝。
func IsEncryptedBoxDeniedByPublishAccess(boxID string) bool {
	boxIDs, denyAll := encryptedBoxIDsForPublishAccess()
	if denyAll {
		return true
	}
	_, encrypted := boxIDs[boxID]
	return encrypted
}

func listEncryptedBoxIDsForPublishAccess() ([]string, error) {
	if util.DataDir == "" {
		return []string{}, nil
	}
	dirs, err := os.ReadDir(util.DataDir)
	if err != nil {
		return nil, err
	}

	ret := []string{}
	for _, dir := range dirs {
		if dir.IsDir() && ast.IsNodeIDPattern(dir.Name()) && IsEncryptedBox(dir.Name()) {
			ret = append(ret, dir.Name())
		}
	}
	return ret, nil
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
		if item.ID == publishAccessDenyAllID || item.ID == box || strings.Contains(path, item.ID) {
			return false
		}
	}
	return true
}

// IsEncryptedPublishRuntimeTarget 判断发布读取目标是否属于当前可解析的加密笔记本。
func IsEncryptedPublishRuntimeTarget(id string) bool {
	boxIDs, denyAll := encryptedBoxIDsForPublishAccess()
	if denyAll {
		return true
	}
	if _, ok := boxIDs[id]; ok {
		return true
	}
	for boxID := range boxIDs {
		if nil != treenode.GetBlockTreeInBox(id, boxID) {
			return true
		}
	}
	return false
}

// IsEncryptedPublishAccessTarget 判断发布访问配置目标是否属于加密笔记本，包括锁定笔记本中的文档。
func IsEncryptedPublishAccessTarget(id string) bool {
	if IsEncryptedPublishRuntimeTarget(id) {
		return true
	}

	boxIDs, denyAll := encryptedBoxIDsForPublishAccess()
	if denyAll {
		return true
	}
	targetName := id + ".sy"
	for boxID := range boxIDs {
		found := false
		err := filepath.WalkDir(filepath.Join(util.DataDir, boxID), func(_ string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() && (entry.Name() == ".siyuan" || entry.Name() == "assets") {
				return fs.SkipDir
			}
			if !entry.IsDir() && entry.Name() == targetName {
				found = true
				return fs.SkipAll
			}
			return nil
		})
		if err != nil {
			return true
		}
		if found {
			return true
		}
	}
	return false
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
	if bt == nil || IsEncryptedBoxDeniedByPublishAccess(bt.BoxID) {
		return false
	}

	publishDisable := filterDisablePublishAccess(publishAccess)
	if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) {
		return false
	}

	publishInvisible := filterInvisiblePublishAccess(publishAccess)
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
	if bt == nil || IsEncryptedBoxDeniedByPublishAccess(bt.BoxID) {
		return false
	}

	publishInvisible := filterInvisiblePublishAccess(publishAccess)
	publishDisable := filterDisablePublishAccess(publishAccess)
	return CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) &&
		CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable)
}

func GetBlockTreePublishAccessStatus(c *gin.Context, publishAccess PublishAccess, bt *treenode.BlockTree) PublishAccessStatus {
	if bt == nil || IsEncryptedBoxDeniedByPublishAccess(bt.BoxID) {
		return PublishAccessDenied
	}

	publishDisable := filterDisablePublishAccess(publishAccess)
	if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) {
		return PublishAccessDenied
	}

	passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
	if password != "" && !CheckPublishAuthCookie(c, passwordID, password) {
		return PublishAccessPasswordRequired
	}
	return PublishAccessAllowed
}

func checkBlockTreeAccessableByPublishAccess(c *gin.Context, publishAccess PublishAccess, bt *treenode.BlockTree) bool {
	return GetBlockTreePublishAccessStatus(c, publishAccess, bt) == PublishAccessAllowed
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

// AssetPathFromDataRelativePath 从 data 相对路径提取文档中使用的资源路径和笔记本 ID。
func AssetPathFromDataRelativePath(relPath string) (assetPath, boxID string, ok bool) {
	pathParts := strings.Split(relPath, "/")
	if 1 < len(pathParts) && pathParts[0] == "assets" {
		return strings.Join(pathParts, "/"), "", true
	}
	if 2 >= len(pathParts) || !ast.IsNodeIDPattern(pathParts[0]) {
		return
	}
	for i := 1; i < len(pathParts)-1; i++ {
		if pathParts[i] == "assets" {
			return strings.Join(pathParts[i:], "/"), pathParts[0], true
		}
	}
	return
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

		if assetPath, box, ok := AssetPathFromDataRelativePath(relPath); ok {
			return checkAssetPathAccessableByPublishAccess(c, publishAccess, assetPath, box)
		}

		if ast.IsNodeIDPattern(pathParts[0]) {
			box := pathParts[0]
			blockPath := "/" + strings.Join(pathParts[1:], "/")
			passwordID, password := GetPathPasswordByPublishAccess(box, blockPath, publishAccess)
			publishIgnore := GetDisablePublishAccess(publishAccess)
			return CheckPathAccessableByPublishIgnore(box, blockPath, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password))
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
	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
	ret = []*BlockAttributeViewKeys{}
	for _, blockAttributeViewKey := range blockAttributeViewKeys {
		accessable := false
		bts := treenode.GetBlockTrees(blockAttributeViewKey.BlockIDs)
		for _, bt := range bts {
			passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if (password == "" || CheckPublishAuthCookie(c, passwordID, password)) &&
				CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) &&
				CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) {
				accessable = true
				break
			}
		}
		if !accessable {
			continue
		}

		// 仅返回绑定文档可发布访问的行值，避免通过键值接口泄漏绑定在禁止访问文档中的数据库内容
		var attrView *av.AttributeView
		filter := &attributeViewPublishAccessFilter{
			c:               c,
			publishAccess:   publishAccess,
			attributeViews:  map[string]*av.AttributeView{},
			attributeAccess: map[string]bool{},
			itemAccess:      map[string]map[string]bool{},
		}
		blockID := ""
		if 0 < len(blockAttributeViewKey.BlockIDs) {
			blockID = blockAttributeViewKey.BlockIDs[0]
		}
		attrView, filter.boxID = parseAttributeViewForPublishAccess(blockAttributeViewKey.AvID, blockID)
		if nil != attrView {
			filter.attributeViews[attrView.ID] = attrView
		}

		keyValues := []*av.KeyValues{}
		for _, sourceKeyValues := range blockAttributeViewKey.KeyValues {
			itemKeyValues := &av.KeyValues{Key: sourceKeyValues.Key}
			for _, value := range sourceKeyValues.Values {
				if !filter.isItemAccessable(attrView, value.BlockID) {
					// 行绑定的文档对发布读者不可访问，丢弃该行值
					continue
				}
				filteredValue, _ := filter.filterValue(attrView, sourceKeyValues.Key, value, value.BlockID)
				itemKeyValues.Values = append(itemKeyValues.Values, filteredValue)
			}
			if 0 < len(itemKeyValues.Values) {
				keyValues = append(keyValues, itemKeyValues)
			}
		}
		if 1 > len(keyValues) {
			// 所有行均不可访问时不返回该数据库键值，避免暴露行是否存在
			continue
		}

		ret = append(ret, &BlockAttributeViewKeys{
			AvID:      blockAttributeViewKey.AvID,
			AvName:    blockAttributeViewKey.AvName,
			BlockIDs:  blockAttributeViewKey.BlockIDs,
			KeyValues: keyValues,
		})
	}
	return
}

func FilterAttributeViewBacklinksByPublishAccess(c *gin.Context, publishAccess PublishAccess, backlinks *AttributeViewBacklinks) (ret *AttributeViewBacklinks) {
	ret = &AttributeViewBacklinks{Items: []*AttributeViewBacklink{}}
	if nil == backlinks {
		return
	}

	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
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
						CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) &&
						CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) {
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
				CheckBlockTreeDiscoverableByPublishAccess(publishAccess, bt) {
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
				!CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) ||
				!CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) {
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

func FilterContentByPublishAccess(c *gin.Context, publishAccess PublishAccess, box string, docPath string, content string, onlyIcon bool) string {
	ret, _ := FilterContentByPublishAccessWithStatus(c, publishAccess, box, docPath, content, onlyIcon)
	return ret
}

func FilterContentByPublishAccessWithStatus(c *gin.Context, publishAccess PublishAccess, box string, docPath string, content string, onlyIcon bool) (ret string, status PublishAccessStatus) {
	ret = content
	status = PublishAccessAllowed

	// 密码访问
	passwordID, password := GetPathPasswordByPublishAccess(box, docPath, publishAccess)
	if password != "" {
		if !CheckPublishAuthCookie(c, passwordID, password) {
			status = PublishAccessPasswordRequired
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
		status = PublishAccessDenied
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
	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
	for _, embedBlock := range embedBlocks {
		if nil == embedBlock || nil == embedBlock.Block {
			continue
		}

		block := embedBlock.Block
		passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
		accessible := CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishInvisible) &&
			CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishDisable) &&
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

	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)

	for _, path := range paths {
		IDs = append(IDs, path.ID)
	}
	bts := treenode.GetBlockTrees(IDs)
	for _, path := range paths {
		bt := bts[path.ID]
		if bt == nil {
			continue
		}
		passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) &&
			CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) &&
			(password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
			ret = append(ret, path)
		}
	}
	return
}

func FilterBlocksByPublishAccess(c *gin.Context, publishAccess PublishAccess, blocks []*Block) (ret []*Block) {
	ret = []*Block{}

	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)

	for _, block := range blocks {
		passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
		if CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishInvisible) &&
			CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishDisable) &&
			(c == nil || password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
			ret = append(ret, block)
		}
	}
	return
}

func FilterSearchDocsByPublishAccess(c *gin.Context, publishAccess PublishAccess, docs []map[string]string) (ret []map[string]string) {
	ret = []map[string]string{}

	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)

	for _, doc := range docs {
		box, docPath := doc["box"], doc["path"]
		if !ast.IsNodeIDPattern(box) || (docPath != "/" && !strings.HasPrefix(docPath, "/")) {
			continue
		}
		passwordID, password := GetPathPasswordByPublishAccess(box, docPath, publishAccess)
		if CheckPathAccessableByPublishIgnore(box, docPath, publishInvisible) &&
			CheckPathAccessableByPublishIgnore(box, docPath, publishDisable) &&
			(password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
			ret = append(ret, doc)
		}
	}
	return
}

func filterBlockTreesByPublishAccess(c *gin.Context, publishAccess PublishAccess, bts map[string]*treenode.BlockTree) (ret map[string]*treenode.BlockTree) {
	ret = map[string]*treenode.BlockTree{}
	for id, bt := range bts {
		if !CheckBlockTreeDiscoverableByPublishAccess(publishAccess, bt) {
			continue
		}

		passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if password != "" && !CheckPublishAuthCookie(c, passwordID, password) {
			continue
		}

		ret[id] = bt
	}
	return
}

func FilterRefDefsByPublishAccess(c *gin.Context, publishAccess PublishAccess, refDefs []*RefDefs) (retRefDefs []*RefDefs, originalRefBlockIDs map[string]string) {
	retRefDefs = []*RefDefs{}
	IDs := []string{}
	for _, refDef := range refDefs {
		IDs = append(IDs, refDef.RefID)
		IDs = append(IDs, refDef.DefIDs...)
	}
	IDs = gulu.Str.RemoveDuplicatedElem(IDs)
	bts := treenode.GetBlockTrees(IDs)
	bts = filterBlockTreesByPublishAccess(c, publishAccess, bts)
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
	retRefDefs, originalRefBlockIDs = buildBacklinkListItemRefs(retRefDefs)
	return
}

func FilterRefIDsByPublishAccess(c *gin.Context, publishAccess PublishAccess, refIDs []string) (ret []string) {
	ret = []string{}
	bts := treenode.GetBlockTrees(refIDs)
	bts = filterBlockTreesByPublishAccess(c, publishAccess, bts)
	for _, refID := range refIDs {
		if nil != bts[refID] {
			ret = append(ret, refID)
		}
	}
	return
}

func FilterGraphByPublishAccess(c *gin.Context, publishAccess PublishAccess, nodes []*GraphNode, links []*GraphLink) (retNodes []*GraphNode, retLinks []*GraphLink) {
	retNodes = []*GraphNode{}
	retLinks = []*GraphLink{}

	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
	nodeByID := make(map[string]*GraphNode, len(nodes))
	virtualNodeIDs := map[string]bool{}
	nodeBaseSizes := make(map[string]float64, len(nodes))
	for _, node := range nodes {
		if node.Box == "" && node.Path == "" {
			nodeByID[node.ID] = node
			virtualNodeIDs[node.ID] = true
		} else {
			if node.Box == "" || node.Path == "" || !CheckPathAccessableByPublishIgnore(node.Box, node.Path, publishInvisible) ||
				!CheckPathAccessableByPublishIgnore(node.Box, node.Path, publishDisable) {
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

func FilterTagsByPublishAccess(c *gin.Context, publishAccess PublishAccess, tags *Tags) (ret *Tags) {
	return filterTagsByPublishAccess(c, publishAccess, tags, sql.QueryTagSpans(""))
}

func filterTagsByPublishAccess(c *gin.Context, publishAccess PublishAccess, tags *Tags, spans []*sql.Span) (ret *Tags) {
	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
	labelCounts := make(map[string]int)
	for _, span := range spans {
		if !CheckPathAccessableByPublishIgnore(span.Box, span.Path, publishInvisible) ||
			!CheckPathAccessableByPublishIgnore(span.Box, span.Path, publishDisable) {
			continue
		}
		passwordID, password := GetPathPasswordByPublishAccess(span.Box, span.Path, publishAccess)
		if password != "" && !CheckPublishAuthCookie(c, passwordID, password) {
			continue
		}
		label := util.UnescapeHTML(span.Content)
		labelCounts[label] += 1
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

// 发布模式下默认不返回管理员的本地工作状态，新增键只有在确认不含敏感信息后才能加入白名单。
var publishLocalStorageAllowedKeys = []string{}

func FilterLocalStorageByPublishAccess(localStorage map[string]any) (ret map[string]any) {
	ret = map[string]any{}
	for _, key := range publishLocalStorageAllowedKeys {
		if value, ok := localStorage[key]; ok {
			ret[key] = value
		}
	}
	return
}

func FilterAssetContentByPublishAccess(c *gin.Context, publishAccess PublishAccess, assetContent []*AssetContent) (ret []*AssetContent) {
	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
	validAssets := []string{}
	bts := treenode.GetBlockTreesByType("d")
	for _, bt := range bts {
		passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) &&
			CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) &&
			(password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
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
	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
	for _, recentDoc := range recentDocs {
		bt := treenode.GetBlockTree(recentDoc.RootID)
		if bt != nil {
			passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) &&
				CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) &&
				(passwordID == "" || CheckPublishAuthCookie(c, passwordID, password)) {
				ret = append(ret, recentDoc)
			}
		}
	}
	return
}

func FilterCriteriaByPublishAccess(c *gin.Context, publishAccess PublishAccess, criteria []*Criterion) (ret []*Criterion) {
	ret = []*Criterion{}
	publishInvisible := GetInvisiblePublishAccess(publishAccess)
	publishDisable := GetDisablePublishAccess(publishAccess)
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
			if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishInvisible) ||
				!CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishDisable) ||
				(passwordID != "" && !CheckPublishAuthCookie(c, passwordID, password)) {
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
