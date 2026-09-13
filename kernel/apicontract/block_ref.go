package apicontract

type RefDefs struct {
	RefID  string   `json:"refID"`
	DefIDs []string `json:"defIDs"`
}

type RefIDsData struct {
	RefDefs             []*RefDefs        `json:"refDefs"`
	OriginalRefBlockIDs map[string]string `json:"originalRefBlockIDs"`
}

type RefDefsData struct {
	RefDefs []RefDefs `json:"refDefs" api:"nonnullable"`
}

type RefIDsRequest struct {
	ID       string   `json:"id" api:"optional,nullable"`
	Notebook string   `json:"notebook" api:"optional,nullable,ignoretype"`
	IDs      []string `json:"ids" api:"optional,filterstrings"`
}

type FileAnnotationRefRequest struct {
	ID       string `json:"id"`
	Notebook string `json:"notebook" api:"optional,nullable,ignoretype"`
}

type RefTextQueryRequest struct {
	Anchor   string `json:"anchor"`
	Notebook string `json:"notebook" api:"optional,nullable,ignoretype"`
}
