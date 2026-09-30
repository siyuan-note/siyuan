package api

import (
	"context"
	"mime/multipart"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getOCRConfig = contractHandler(apicontract.GetOCRConfig, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.OCRConfigData] {
	value := model.Conf.GetOCR()
	models := []apicontract.OCRModel{}
	for _, id := range model.OCRModels() {
		models = append(models, ocrModelPayload(id))
	}
	providers := []apicontract.OCRProviderState{}
	for _, id := range []string{"tesseract", "paddleocr"} {
		providers = append(providers, apicontract.OCRProviderState{ID: id, Available: model.OCRProviderAvailable(id)})
	}
	return apicontract.Success(apicontract.OCRConfigData{Config: apicontract.SettingOCR(value), Providers: providers, Models: models})
})

func ocrModelPayload(id string) apicontract.OCRModel {
	name := id
	if id == "tiny" {
		name = "PP-OCRv6 Tiny"
	} else if id == "small" {
		name = "PP-OCRv6 Small"
	} else {
		name = "PP-OCRv6 " + strings.ToUpper(id[:8])
	}
	return apicontract.OCRModel{ID: id, Name: name, BuiltIn: id == "tiny" || id == "small"}
}

var setOCRConfig = contractHandler(apicontract.SetOCRConfig, func(c *gin.Context, request apicontract.SettingOCR) apicontract.Response[apicontract.SettingOCR] {
	if err := model.Conf.SetOCR(conf.OCR(request)); err != nil {
		return apicontract.Failure[apicontract.SettingOCR](-1, err.Error())
	}
	util.BroadcastByType("main", "setConf", 0, "", model.Conf)
	return apicontract.Success(request)
})

var importOCRModels = contractHandler(apicontract.ImportOCRModels, func(c *gin.Context, request apicontract.ImportOCRModelsRequest) apicontract.Response[apicontract.OCRModel] {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	id, err := model.ImportOCRModels(ctx, []*multipart.FileHeader{request.Detector, request.DetectorConfig, request.Recognizer, request.RecognizerConfig})
	if err != nil {
		return apicontract.Failure[apicontract.OCRModel](-1, err.Error())
	}
	return apicontract.Success(ocrModelPayload(id))
})
