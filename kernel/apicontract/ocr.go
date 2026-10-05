package apicontract

import "mime/multipart"

// SettingOCR 的选择仅保存在当前设备；切换提供商或模型不删除、重跑已有识别结果。
// auto 仅控制内核后台识别，手动识别继续使用 /api/asset/ocr 的既有输入和输出。
// thresholds 省略或为 null 时保留设备已保存的阈值；传入对象时整体替换。
// 修改阈值只影响后续识别，不修改模型文件或已有结果，Tesseract 不使用这些参数。
// 仅内置 tiny；旧内置模型标识 small 会归一化为 tiny，自行导入的模型仍使用内容摘要标识。
// provider 可为 tesseract、paddleocr 或 ai；aiModelId 是已配置 AI 模型的 ID，与本地 model 独立保存。
// aiModelId 省略或为 null 时保留已有选择；失效的已保存 ID 保留并显示不可用，不回退到其他模型。
// 首次切换到 ai 时 auto 强制关闭；之后可显式开启，手动和自动识别均使用所选 AI 模型。
type SettingOCR struct {
	Provider   string         `json:"provider"`
	Model      string         `json:"model"`
	Auto       bool           `json:"auto"`
	AIModelID  *string        `json:"aiModelId,omitempty" api:"optional"`
	Thresholds *OCRThresholds `json:"thresholds,omitempty" api:"optional"`
}

// OCRThresholds 的 detection、box 必须为 (0, 1) 内的有限数，recognition 为 [0, 1] 内的有限数。
// 对象内三个字段均须提供；字段为 null 时恢复默认：检测沿用当前模型 YAML，识别为 0.5。
type OCRThresholds struct {
	Detection   *float64 `json:"detection"`
	Box         *float64 `json:"box"`
	Recognition *float64 `json:"recognition"`
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
	AIModels  []OCRAIModel       `json:"aiModels"`
}

// OCRAIModel 仅列出启用的提供商及模型；不推断模型的图片输入能力，不包含提供商凭据。
type OCRAIModel struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
}

// ImportOCRModelsRequest 导入配套的 PP-OCRv6 ONNX 模型和 YAML 配置。
// 两个模型各不超过 256 MiB，两个配置各不超过 1 MiB；成功后文件存放于 data/ocr/models/<内容摘要>/。
// 导入不自动切换当前模型，失败不覆盖已有模型。内置 Tiny 不写入工作空间。
type ImportOCRModelsRequest struct {
	Detector         *multipart.FileHeader `json:"detector"`
	DetectorConfig   *multipart.FileHeader `json:"detectorConfig"`
	Recognizer       *multipart.FileHeader `json:"recognizer"`
	RecognizerConfig *multipart.FileHeader `json:"recognizerConfig"`
}
