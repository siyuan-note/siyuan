package apicontract

type GraphTypeFilter struct {
	Tag        bool `json:"tag" api:"optional,nullable"`
	Paragraph  bool `json:"paragraph" api:"optional,nullable"`
	Heading    bool `json:"heading" api:"optional,nullable"`
	Math       bool `json:"math" api:"optional,nullable"`
	Code       bool `json:"code" api:"optional,nullable"`
	Table      bool `json:"table" api:"optional,nullable"`
	List       bool `json:"list" api:"optional,nullable"`
	ListItem   bool `json:"listItem" api:"optional,nullable"`
	Blockquote bool `json:"blockquote" api:"optional,nullable"`
	Super      bool `json:"super" api:"optional,nullable"`
	Callout    bool `json:"callout" api:"optional,nullable"`
}

type GraphD3 struct {
	NodeSize        float64 `json:"nodeSize" api:"optional,nullable"`
	LineWidth       float64 `json:"linkWidth" api:"optional,nullable"`
	LineOpacity     float64 `json:"lineOpacity" api:"optional,nullable"`
	CenterStrength  float64 `json:"centerStrength" api:"optional,nullable"`
	CollideRadius   float64 `json:"collideRadius" api:"optional,nullable"`
	CollideStrength float64 `json:"collideStrength" api:"optional,nullable"`
	LinkDistance    int     `json:"linkDistance" api:"optional,nullable"`
	Arrow           bool    `json:"arrow" api:"optional,nullable"`
}

type GlobalGraphConf struct {
	MinRefs   int              `json:"minRefs"`
	DailyNote bool             `json:"dailyNote"`
	Type      *GraphTypeFilter `json:"type"`
	D3        *GraphD3         `json:"d3"`
}

type LocalGraphConf struct {
	DailyNote bool             `json:"dailyNote"`
	Type      *GraphTypeFilter `json:"type"`
	D3        *GraphD3         `json:"d3"`
}

type ResetGraphData struct {
	Conf GlobalGraphConf `json:"conf"`
}
type ResetLocalGraphData struct {
	Conf LocalGraphConf `json:"conf"`
}
