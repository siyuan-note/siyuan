package filesys

import (
	"bytes"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// CheckDocumentAddressing 在读取缓存或修改笔记本源数据之前检查寻址能力。
func CheckDocumentAddressing(boxID string) error {
	return documentaddressing.CheckBox(util.DataDir, util.ConfDir, boxID)
}

func DocumentAddressingMode(boxID string) (int, error) {
	if boxID == "" {
		return documentaddressing.DefaultMode(), nil
	}
	return documentaddressing.BoxMode(util.DataDir, util.ConfDir, boxID)
}

func CheckDocumentSpecJSON(boxID string, data []byte) error {
	_, err := DocumentAddressingMode(boxID)
	if err != nil {
		return err
	}
	return treenode.CheckSpecJSON(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))
}

func checkDocumentTreeSpec(tree *parse.Tree) error {
	_, err := DocumentAddressingMode(tree.Box)
	if err != nil {
		return err
	}
	return treenode.CheckSpec(tree)
}
