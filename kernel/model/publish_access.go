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
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"net/http"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PublishAccessItem struct {
	ID          string     `json:"id"`
	Visible     bool       `json:"visible"`   // 是否发布可见
	Password    string     `json:"password"`  // 密码，为空字符串时表示无密码
	Disable     bool       `json:"disable"`   // 是否禁止发布
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
	if now - publishAccessLastModified < 30*1000 {
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
	if !gulu.File.IsExist(publishAccessPath) {
		if err = gulu.File.WriteFileSafer(publishAccessPath, []byte("[]"), 0644); err != nil {
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

	err = gulu.File.WriteFileSafer(publishAccessPath, data, 0644)
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
		if !item.Visible  {
			outputPublishAccess = append(outputPublishAccess, item)
		}
	}
	return
}

func GetDisablePublishAccess(inputPublishAccess PublishAccess) (outputPublishAccess PublishAccess) { 
	outputPublishAccess = PublishAccess{}
	for _, item := range inputPublishAccess {
		if item.Disable  {
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

	blocks := sql.GetBlocks(IDs)
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

	tempPublishAccess := PublishAccess{}
	for i, block := range blocks {
		if block != nil {
			tempPublishAccess = append(tempPublishAccess, publishAccess[i])
		} else {
			for _, box := range boxes {
				if box.ID == publishAccess[i].ID {
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
	block := sql.GetBlock(blockID)
	if block != nil {
		return false
	}
	passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
	return CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password))
}

func SetPublishAuthCookie(c *gin.Context, ID string, password string) {
	authCookie := util.SHA256Hash([]byte(ID + password))
	http.SetCookie(c.Writer, &http.Cookie{
		Name: "publish-auth-" + ID,
		Value: authCookie,
		MaxAge: 24 * 60 * 60,
		Path: "/",
	})
}

func CheckPublishAuthCookie(c *gin.Context, ID string, password string) bool {
	authCookie, err := c.Request.Cookie("publish-auth-" + ID)
	return err == nil && authCookie.Value == util.SHA256Hash([]byte(ID + password))
}

func CheckAbsPathAccessableByPublishAccess(c *gin.Context, absPath string, publishAccess PublishAccess) bool {
	absPath = filepath.Clean(absPath)

	if util.IsSubPath(util.HistoryDir, absPath) {
		return false
	}

	if util.IsSubPath(util.DataDir, absPath) {
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
			return CheckPathAccessableByPublishIgnore(box, blockPath, publishIgnore) && (password == "" ||CheckPublishAuthCookie(c, passwordID, password))
		} else if pathParts[0] == "assets" {
			publishIgnore := GetDisablePublishAccess(publishAccess)
			blocks := sql.GetAllRootBlocks()
			for _, block := range blocks {
				passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
				if CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
					assets, _ := DocAssets(block.ID)
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
			var block *sql.Block
			if len(row.Cells) > 0 {
				if row.Cells[0].Value.Block != nil {
					id := row.Cells[0].Value.Block.ID
					if id != "" {
						block = sql.GetBlock(id)
					}
				}
			}
			if block != nil {
				// 不显示禁止文档
				if !CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) {
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
			var block *sql.Block
			if len(card.Values) > 0 {
				if card.Values[0].Value.Block != nil {
					id := card.Values[0].Value.Block.ID
					if id != "" {
						block = sql.GetBlock(id)
					}
				}
			}
			if block != nil {
				// 替换封面
				newCoverContent := FilterContentByPublishAccess(c, publishAccess, block.Box, block.Path, card.CoverContent, true)
				if card.CoverContent != newCoverContent {
					card.CoverContent = newCoverContent
					card.CoverURL = ""
				}

				// 不显示禁止文档
				if !CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) {
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
	// TODO: 适配看板视图
	}
	return
}

func FilterBlockAttributeViewKeysByPublishAccess(c *gin.Context, publishAccess PublishAccess, blockAttributeViewKeys []*BlockAttributeViewKeys) (ret []*BlockAttributeViewKeys) {
	publishIgnore := GetDisablePublishAccess(publishAccess)
	ret = []*BlockAttributeViewKeys{}
	for _, blockAttributeViewKey := range blockAttributeViewKeys {
		accessable := false
		blocks := sql.GetBlocks(blockAttributeViewKey.BlockIDs)
		for _, block := range blocks {
			if block == nil {
				continue
			}
			passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
			if (password == "" || CheckPublishAuthCookie(c, passwordID, password)) && CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) {
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
			avBlocks := sql.GetBlocks(avBlockIDs)
			for _, avBlock := range avBlocks {
				if avBlock == nil {
					continue
				}
				passwordID, password := GetPathPasswordByPublishAccess(avBlock.Box, avBlock.Path, publishAccess);
				if (password == "" || CheckPublishAuthCookie(c, passwordID, password)) && CheckPathAccessableByPublishIgnore(avBlock.Box, avBlock.Path, publishIgnore) {
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

	block := sql.GetBlock(info.RootID)
	if block != nil {
		passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess);
		if (password != "" && !CheckPublishAuthCookie(c, passwordID, password)) || !CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) {
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
				passwordHTML := `<div class="publish-access-block--alert fn__flex-column fn__flex-center" data-node-id="%s" style="text-align:center;">
	<span style="font-size:100px;">🔒</span>
</div>`
				ret = fmt.Sprintf(passwordHTML, passwordID)
			} else {
				passwordHTML := `<div class="publish-access-block--password fn__flex-column fn__flex-center" data-node-id="%s" style="text-align:center;">
	<span style="font-size:100px;">🔒</span>
	<label class="b3-form__icon fn__flex-1" style="overflow:initial; display:block; justify-content:center; margin: 0 auto 0 auto; max-width:230px;">
		<svg class="b3-form__icon-icon" style="align-self:center"><use xlink:href="#iconKey"></use></svg>
		<input class="b3-form__icon-input b3-text-field fn__block" placeholder="%s" style="padding-right:25px !important;">
		<svg class="publish-access-block--password-button b3-form__icon-icon" style="align-self:center; left:unset; right:5px;"><use xlink:href="#iconForward"></use></svg>
	</label>
</div>`
				ret = fmt.Sprintf(passwordHTML, passwordID, Conf.Language(275))
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
			forbiddenHTML := `<div class="publish-access-block--alert fn__flex-column fn__flex-center" data-node-id="%s" style="text-align:center;">
	<span style="font-size:100px;">🚫</span>
</div>`
			ret = fmt.Sprintf(forbiddenHTML, ID)
		} else {
			forbiddenHTML := `<div class="publish-access-block--forbidden fn__flex-column fn__flex-center" data-node-id="%s" style="text-align:center;">
	<span style="font-size:100px; line-height:1.2;">🚫</span>
	<span style="font-size:2em;">%s</span>
</div>`
			ret = fmt.Sprintf(forbiddenHTML, ID, Conf.Language(276))
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
	blocks := sql.GetBlocks(IDs)
	for _, block := range blocks {
		pathIndex := IDtoPathIndexMap[block.ID]
		path := paths[pathIndex]
		passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
		if CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
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

func FilterSQLBlocksByPublishIgnore(publishIgnore PublishAccess, blocks []*sql.Block) (ret []*sql.Block) {
	ret = []*sql.Block{}
	for _, block := range blocks {
		if CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) {
			ret = append(ret, block)
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
	blocks := sql.GetBlocks(IDs)
	blocks = FilterSQLBlocksByPublishIgnore(publishIgnore, blocks)
	visibles := make(map[string]bool)
	for _, ID := range IDs {
		visibles[ID] = false
	}
	for _, block := range blocks {
		visibles[block.ID] = true
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

	layout, ok := (*uiLayout)["layout"].(map[string]interface{})
	if !ok {
		return
	}
	layout = filterLayoutItemByPublishIgnore(publishIgnore, layout)
	(*ret)["layout"] = layout
	return
}

func filterLayoutItemByPublishIgnore(publishIgnore PublishAccess, item map[string]interface{}) (ret map[string]interface{}) {
	ret = item
	if (item == nil) {
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
		children := childrenItem.(map[string]interface{})
		if children == nil {
			return
		}
		rootIdItem, exists := children["rootId"]
		if rootIdItem == nil {
			return
		}
		rootId := children["rootId"].(string)
		block := sql.GetBlock(rootId)
		if block == nil {
			return
		}
		if !CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) {
			ret = nil
		}
	} else {
		childrenItem, exists := item["children"]
		if !exists {
			return
		}
		children := childrenItem.([]interface{})
		if children == nil {
			return
		}
		newChildren := []interface{}{}
		updateTabs := false
		for _, childItem := range children {
			child := childItem.(map[string]interface{})
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
				child := childItem.(map[string]interface{})
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
				newChildren[maxIndex].(map[string]interface{})["active"] = true
			}
			if len(newChildren) == 0 {
				child := make(map[string]interface{})
				child["instance"] = "Tab"
				child["children"] = make(map[string]interface{})
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

func FilterLocalStorageByPublishAccess(publishAccess PublishAccess, localStorage map[string]interface{}) (ret map[string]interface{}) {
	ret = localStorage
	publishIgnore := GetInvisiblePublishAccess(publishAccess)
	// 清空搜索历史记录
	searchKeysItem := ret["local-searchkeys"]
	if searchKeysItem != nil {
		searchKeys := searchKeysItem.(map[string]interface{})
		if searchKeys != nil {
			searchKeys["keys"] = []string{}
		}
	}
	searchAssetItem := ret["local-searchasset"]
	if searchAssetItem != nil {
		searchAsset := searchAssetItem.(map[string]interface{})
		if searchAsset != nil {
			searchAsset["k"] = ""
			searchAsset["keys"] = []string{}
		}
	}
	docInfoItem := ret["local-docinfo"]
	if docInfoItem != nil {
		docInfo := docInfoItem.(map[string]interface{})
		if docInfo != nil {
			idItem := docInfo["id"]
			if idItem != nil {
				id := idItem.(string)
				block := sql.GetBlock(id)
				if block != nil {
					if !CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) {
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
	blocks := sql.GetAllRootBlocks()
	for _, block := range blocks {
		passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
		if CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) && (password == "" || CheckPublishAuthCookie(c, passwordID, password)) {
			assets, err := DocAssets(block.ID)
			if err == nil {
				validAssets = append(validAssets, assets...)
			}
		}
	}

	ret = []*AssetContent{}
	for _, asset := range assetContent {
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
		block := sql.GetBlock(recentDoc.RootID)
		if block != nil {
			passwordID, password := GetPathPasswordByPublishAccess(block.Box, block.Path, publishAccess)
			if CheckPathAccessableByPublishIgnore(block.Box, block.Path, publishIgnore) && (passwordID == "" || CheckPublishAuthCookie(c, passwordID, password)) {
				ret = append(ret, recentDoc)
			}
		}
	}
	return
}
