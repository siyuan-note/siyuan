package apicontract

type DynamicIconRequest struct {
	Type        string `json:"type" api:"optional"`
	Color       string `json:"color" api:"optional"`
	Date        string `json:"date" api:"optional"`
	Lang        string `json:"lang" api:"optional"`
	WeekdayType string `json:"weekdayType" api:"optional"`
	Content     string `json:"content" api:"optional"`
	ID          string `json:"id" api:"optional"`
}
