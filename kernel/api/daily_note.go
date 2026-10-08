package api

import (
	"errors"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func parseDailyNoteDate(value string) (time.Time, error) {
	if value == "" {
		return time.Now(), nil
	}
	date, err := time.ParseInLocation("2006-01-02", value, time.Local)
	if err == nil && (date.Year() < 1 || date.Format("2006-01-02") != value) {
		err = fmt.Errorf("invalid daily note date [%s]", value)
	}
	return date, err
}

var getDailyNoteInfo = contractHandler(apicontract.GetDailyNoteInfo, func(c *gin.Context, request apicontract.DailyNoteInfoRequest) apicontract.Response[*apicontract.DailyNoteInfo] {
	if err := holdEncryptedBoxRequest(c, request.Notebook); err != nil {
		return apicontract.Failure[*apicontract.DailyNoteInfo](-1, model.Conf.Language(314))
	}
	date, err := parseDailyNoteDate(request.Date)
	if err != nil {
		return apicontract.Failure[*apicontract.DailyNoteInfo](-1, err.Error())
	}
	info, err := model.GetDailyNoteInfo(request.Notebook, date)
	if err != nil {
		code := -1
		if errors.Is(err, model.ErrBoxNotFound) {
			code = 1
		}
		return apicontract.Failure[*apicontract.DailyNoteInfo](code, err.Error())
	}
	return apicontract.Success(&apicontract.DailyNoteInfo{ID: info.ID, HPath: info.HPath, Title: info.Title, Existed: info.Existed})
})
