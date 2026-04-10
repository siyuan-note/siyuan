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
	"net/http"
	"os"
	"path"
	"path/filepath"
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
		logging.LogErrorf(msg)
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
		logging.LogErrorf(msg)
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
	publishIgnore := GetDisablePublishAccess(publishAccess)
	bt := treenode.GetBlockTree(blockID)
	if bt == nil {
		return false
	}
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
			blockPath := "/" + strings.Join(pathParts[1:], "/")
			passwordID, password := GetPathPasswordByPublishAccess(box, blockPath, publishAccess)
			publishIgnore := GetDisablePublishAccess(publishAccess)
			return CheckPathAccessableByPublishIgnore(box, blockPath, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password))
		} else if pathParts[0] == "assets" {
			publishIgnore := GetDisablePublishAccess(publishAccess)
			bts := treenode.GetBlockTreesByType("d")
			for _, bt := range bts {
				passwordID, password := GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
				if CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
					assets, _ := DocAssets(bt.ID)
					for _, assetPath := range assets {
						if assetPath == relPath {
							return true
						}
					}
				}
			}
			return false
		}
	}
	return true
}

func FilterViewByPublishAccess(c *gin.Context, publishAccess PublishAccess, viewable av.Viewable) (ret av.Viewable) {
	ret = viewable
	publishIgnore := GetDisablePublishAccess(publishAccess)

	switch ret.GetType() {
	case av.LayoutTypeTable:
		table := ret.(*av.Table)
		filteredRows := []*av.TableRow{}
		for _, row := range table.Rows {
			// 默认第一个属性是文档块
			var bt *treenode.BlockTree
			if len(row.Cells) > 0 {
				if row.Cells[0].Value.Block != nil {
					id := row.Cells[0].Value.Block.ID
					if id != "" {
						bt = treenode.GetBlockTree(id)
					}
				}
			}
			if bt != nil {
				// 不显示禁止文档
				if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
					row = nil
				}
			}
			if row != nil {
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
			// 默认第一个属性是文档块
			var bt *treenode.BlockTree
			if len(card.Values) > 0 {
				if card.Values[0].Value.Block != nil {
					id := card.Values[0].Value.Block.ID
					if id != "" {
						bt = treenode.GetBlockTree(id)
					}
				}
			}
			if bt != nil {
				// 替换封面
				newCoverContent := FilterContentByPublishAccess(c, publishAccess, bt.BoxID, bt.Path, card.CoverContent, true)
				if card.CoverContent != newCoverContent {
					card.CoverContent = newCoverContent
					card.CoverURL = ""
				}

				// 不显示禁止文档
				if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
					card = nil
				}
			}
			if card != nil {
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
			// 默认第一个属性是文档块
			var bt *treenode.BlockTree
			if len(card.Values) > 0 {
				if card.Values[0].Value.Block != nil {
					id := card.Values[0].Value.Block.ID
					if id != "" {
						bt = treenode.GetBlockTree(id)
					}
				}
			}
			if bt != nil {
				// 替换封面
				newCoverContent := FilterContentByPublishAccess(c, publishAccess, bt.BoxID, bt.Path, card.CoverContent, true)
				if card.CoverContent != newCoverContent {
					card.CoverContent = newCoverContent
					card.CoverURL = ""
				}

				// 不显示禁止文档
				if !CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
					card = nil
				}
			}
			if card != nil {
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
			ret = append(ret, blockAttributeViewKey)
		}
	}
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
		embedBlock.Block.Content = FilterContentByPublishAccess(c, publishAccess, embedBlock.Block.Box, embedBlock.Block.Path, embedBlock.Block.Content, false)
		ret = append(ret, embedBlock)
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

func FilterGraphByPublishIgnore(publishIgnore PublishAccess, nodes []*GraphNode, links []*GraphLink) (retNodes []*GraphNode, retLinks []*GraphLink) {
	retNodes = []*GraphNode{}
	retLinks = []*GraphLink{}
	ignoreNodeIDs := []string{}
	for _, node := range nodes {
		if CheckPathAccessableByPublishIgnore(node.Box, node.Path, publishIgnore) {
			retNodes = append(retNodes, node)
		} else {
			ignoreNodeIDs = append(ignoreNodeIDs, node.ID)
		}
	}
	for _, link := range links {
		ignore := false
		for _, ignoreNodeID := range ignoreNodeIDs {
			if ignoreNodeID == link.From || ignoreNodeID == link.To {
				ignore = true
				break
			}
		}
		if !ignore {
			retLinks = append(retLinks, link)
		}
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
			assets, err := DocAssets(bt.ID)
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
