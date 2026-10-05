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
)

var aiOCR = contractHandler(apicontract.AIOCR, func(c *gin.Context, request apicontract.AssetPathRequest) apicontract.Response[apicontract.AssetTextData] {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	text, err := model.AIOCRAsset(ctx, request.Path)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.AssetTextData](-1, err.Error(), 7000)
	}
	return apicontract.Success(apicontract.AssetTextData{Text: text})
})

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
	aiModels := []apicontract.OCRAIModel{}
	for _, model := range model.OCRAIModels() {
		aiModels = append(aiModels, apicontract.OCRAIModel{ID: model.ID, Name: model.Name, Provider: model.Provider})
	}
	if len(aiModels) > 0 || value.Provider == "ai" {
		providers = append(providers, apicontract.OCRProviderState{ID: "ai", Available: model.OCRProviderAvailable("ai")})
	}
	return apicontract.Success(apicontract.OCRConfigData{Config: ocrConfigPayload(value), Providers: providers, Models: models, AIModels: aiModels})
})

func ocrConfigPayload(value conf.OCR) apicontract.SettingOCR {
	thresholds := apicontract.OCRThresholds(value.Thresholds)
	return apicontract.SettingOCR{Provider: value.Provider, Model: value.Model, Auto: value.Auto, Thresholds: &thresholds, AIModelID: &value.AIModelID}
}

func ocrModelPayload(id string) apicontract.OCRModel {
	name := id
	if id == "tiny" {
		name = "PP-OCRv6 Tiny"
	} else {
		name = "PP-OCRv6 " + strings.ToUpper(id[:8])
	}
	return apicontract.OCRModel{ID: id, Name: name, BuiltIn: id == "tiny"}
}

var setOCRConfig = contractHandler(apicontract.SetOCRConfig, serializeSetting("ocr", func(c *gin.Context, request apicontract.SettingOCR) apicontract.Response[apicontract.SettingOCR] {
	value := model.Conf.GetOCR()
	value.Provider, value.Model, value.Auto = request.Provider, request.Model, request.Auto
	if request.AIModelID != nil {
		value.AIModelID = *request.AIModelID
	}
	if request.Thresholds != nil {
		value.Thresholds = conf.OCRThresholds(*request.Thresholds)
	}
	if err := model.Conf.SetOCR(value); err != nil {
		return apicontract.Failure[apicontract.SettingOCR](-1, err.Error())
	}
	return apicontract.Success(ocrConfigPayload(model.Conf.GetOCR()))
}))

var importOCRModels = contractHandler(apicontract.ImportOCRModels, func(c *gin.Context, request apicontract.ImportOCRModelsRequest) apicontract.Response[apicontract.OCRModel] {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	id, err := model.ImportOCRModels(ctx, []*multipart.FileHeader{request.Detector, request.DetectorConfig, request.Recognizer, request.RecognizerConfig})
	if err != nil {
		return apicontract.Failure[apicontract.OCRModel](-1, err.Error())
	}
	return apicontract.Success(ocrModelPayload(id))
})
