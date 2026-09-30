package apicontract

import "mime/multipart"

// SettingOCR 的选择仅保存在当前设备；切换提供商或模型不删除、重跑已有识别结果。
// auto 仅控制内核后台识别，手动识别继续使用 /api/asset/ocr 的既有输入和输出。
type SettingOCR struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Auto     bool   `json:"auto"`
}

type OCRProviderState struct {
	ID        string `json:"id"`
	Available bool   `json:"available"`
}

type OCRModel struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	BuiltIn bool   `json:"builtIn"`
}

type OCRConfigData struct {
	Config    SettingOCR         `json:"config"`
	Providers []OCRProviderState `json:"providers"`
	Models    []OCRModel         `json:"models"`
}

// ImportOCRModelsRequest 导入配套的 PP-OCRv6 ONNX 模型和 YAML 配置。
// 两个模型各不超过 256 MiB，两个配置各不超过 1 MiB；成功后文件存放于 data/ocr/models/<内容摘要>/。
// 导入不自动切换当前模型，失败不覆盖已有模型。内置 Tiny、Small 不写入工作空间。
type ImportOCRModelsRequest struct {
	Detector         *multipart.FileHeader `json:"detector"`
	DetectorConfig   *multipart.FileHeader `json:"detectorConfig"`
	Recognizer       *multipart.FileHeader `json:"recognizer"`
	RecognizerConfig *multipart.FileHeader `json:"recognizerConfig"`
}
