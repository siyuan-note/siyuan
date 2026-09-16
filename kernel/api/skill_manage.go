package api

import (
	"errors"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var manageSkills = contractHandler(apicontract.AIManageSkills, manageSkillsContract)

func manageSkillsContract(c *gin.Context, request apicontract.AISkillFileRequest) apicontract.Response[apicontract.AISkillFileData] {
	data, err := util.ManageSkillFiles(util.SkillFileRequest{
		Action: request.Action, Path: request.Path, Target: request.Target, Content: request.Content, Revision: request.Revision,
	})
	if err != nil {
		message := err.Error()
		key := ""
		switch {
		case errors.Is(err, util.ErrSkillBinary):
			key = "agentSkillBinaryTip"
		case errors.Is(err, util.ErrSkillEncoding):
			key = "agentSkillEncodingTip"
		case errors.Is(err, util.ErrSkillTooLarge):
			key = "agentSkillTooLargeTip"
		}
		if key != "" {
			if translated := util.I18nTerm(model.Conf.Lang, key); translated != "" {
				message = translated
			}
		}
		return apicontract.Failure[apicontract.AISkillFileData](-1, util.EscapeHTML(message))
	}
	ret := apicontract.AISkillFileData{Content: data.Content, Revision: data.Revision, ReadOnlyReason: data.ReadOnlyReason}
	if data.Entries != nil {
		entries := make([]apicontract.AISkillFileEntry, 0, len(data.Entries))
		for _, entry := range data.Entries {
			entries = append(entries, apicontract.AISkillFileEntry{Path: entry.Path, IsDir: entry.IsDir, Editable: entry.Editable})
		}
		ret.Entries = &entries
	}
	if request.Action != "list" && request.Action != "read" {
		changed := []string{filepath.Join(util.SkillsDir(), filepath.FromSlash(request.Path))}
		if request.Action == "move" {
			changed = append(changed, filepath.Join(util.SkillsDir(), filepath.FromSlash(request.Target)))
		}
		model.IncSyncIfNeeded(changed...)
	}
	return apicontract.Success(ret)
}
