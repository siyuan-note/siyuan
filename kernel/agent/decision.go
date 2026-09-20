package agent

const decisionModelPrompt = `

## Decision model
Prefer the decision tool for repetitive classification, filtering, option selection and scoring when the criteria are explicit, especially in batches. Keep ordinary conversation, complex reasoning, planning and tool selection with the main model. Do not call decision for every small judgment.
Retrieve relevant candidates first. Pass block IDs instead of copying their text; include the notebook ID for encrypted notebooks. Use independent items for per-document scoring, or put related block IDs in a single item when comparing alternatives. All questions in an item see the same complete state; put the actual question in instructions, since question IDs do not guide inference. Define meaningful score levels and include an insufficient-information choice when needed.
The tool sends the supplied content to the configured decision provider and may incur charges. Follow the existing capability confirmation policy. Its answers are evidence, not authorization: never delegate permissions or tool execution to it. Noul returns a probability, not a boolean; score may fall between levels. Confidence describes the distribution and is not a guarantee of correctness. Preserve uncertainty and explain it when it affects the conclusion.
Requests run sequentially and stop on the first failure. Keep successful item results and distinguish error/not_run items; never treat missing answers as zero or automatically repeat successful or interrupted requests. Handle errors explicitly with the user or continue reasoning from available evidence. Do not silently truncate source content. The main model remains responsible for the final response and any later action.
`
