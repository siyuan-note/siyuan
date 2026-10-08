package model

import (
	"errors"
	"path"
	"strings"
	"time"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type DailyNoteInfo struct {
	ID      string
	HPath   string
	Title   string
	Existed bool
}

// resolveDailyNote 定位日期对应的文档；已有日记以认证后的源文档为准。
func resolveDailyNote(box *Box, now time.Time, findByDate bool) (hPath string, tree *parse.Tree, err error) {
	boxConf := box.GetConf()
	if boxConf.DailyNoteSavePath == "" || boxConf.DailyNoteSavePath == "/" {
		return "", nil, errors.New(Conf.Language(49))
	}
	hPath, err = RenderGoTemplateAtInBox(boxConf.DailyNoteSavePath, now, box.ID)
	if err != nil {
		return
	}
	hPath = util.TrimSpaceInPath(strings.TrimSuffix(hPath, ".sy"))
	FlushTxQueue()
	root := treenode.GetBlockTreeRootByHPath(box.ID, hPath)
	rootID := ""
	if root != nil {
		rootID = root.RootID
	}
	fromDate := false
	date := now.Format("20060102")
	if findByDate {
		sql.FlushQueue()
		var ids []string
		ids, err = sql.QueryDailyNoteRootIDsInBox(box.ID, DailyNoteAttrPrefix+date, date)
		if err != nil {
			return
		}
		if len(ids) > 0 {
			matched := false
			for _, id := range ids {
				if rootID == id {
					matched = true
					break
				}
			}
			if !matched {
				rootID = ids[0]
			}
			fromDate = true
		}
	}
	if rootID == "" {
		return
	}
	tree, err = LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}
	if tree.Box != box.ID || (fromDate && tree.Root.IALAttr(DailyNoteAttrPrefix+date) != date) {
		return "", nil, ErrBlockNotFound
	}
	return
}

// GetDailyNoteInfo 仅解析命名模板并读取已有文档，不创建文档或添加日记属性。
func GetDailyNoteInfo(boxID string, date time.Time) (info *DailyNoteInfo, err error) {
	box := Conf.Box(boxID)
	if box == nil {
		return nil, ErrBoxNotFound
	}
	hPath, tree, err := resolveDailyNote(box, date, true)
	if err != nil {
		return nil, err
	}
	info = &DailyNoteInfo{HPath: hPath, Title: path.Base(hPath)}
	if tree != nil {
		info.ID, info.HPath, info.Title, info.Existed = tree.Root.ID, tree.HPath, tree.Root.IALAttr("title"), true
	}
	return
}
