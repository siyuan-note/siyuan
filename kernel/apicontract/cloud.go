package apicontract

type CloudReminderRequest struct {
	ID      string `json:"id"`
	Timed   string `json:"timed"`
	Content string `json:"content"`
}

type CloudBackup struct {
	Size    int64  `json:"size"`
	HSize   string `json:"hSize"`
	Updated string `json:"updated"`
	SaveDir string `json:"saveDir"`
}

type CloudSync struct {
	Size      int64  `json:"size"`
	HSize     string `json:"hSize"`
	Updated   string `json:"updated"`
	CloudName string `json:"cloudName"`
	SaveDir   string `json:"saveDir"`
}

type CloudSpaceData struct {
	Sync                 *CloudSync   `json:"sync"`
	Backup               *CloudBackup `json:"backup"`
	HAssetSize           string       `json:"hAssetSize"`
	HSize                string       `json:"hSize"`
	HTotalSize           string       `json:"hTotalSize"`
	HExchangeSize        string       `json:"hExchangeSize"`
	HTrafficUploadSize   string       `json:"hTrafficUploadSize"`
	HTrafficDownloadSize string       `json:"hTrafficDownloadSize"`
	HTrafficAPIGet       string       `json:"hTrafficAPIGet"`
	HTrafficAPIPut       string       `json:"hTrafficAPIPut"`
}
