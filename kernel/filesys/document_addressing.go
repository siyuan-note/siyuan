package filesys

import (
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// CheckDocumentAddressing 在读取缓存或修改笔记本源数据之前检查寻址能力。
func CheckDocumentAddressing(boxID string) error {
	return documentaddressing.CheckBox(util.DataDir, util.ConfDir, boxID)
}
