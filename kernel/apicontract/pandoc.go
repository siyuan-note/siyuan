package apicontract

type PandocRequest struct {
	Dir  string   `json:"dir" api:"optional,nullable"`
	Args []string `json:"args"`
}

type PandocData struct {
	Path string `json:"path"`
}
