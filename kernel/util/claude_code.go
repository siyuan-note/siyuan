// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/logging"
)

// ClaudeCodeProtocol 是本机 Claude Code 命令行提供方使用的生成协议。
const ClaudeCodeProtocol = "claude-code"

// ClaudeCodeMCPServerName 是本机命令行连接当前工作空间 MCP 服务时使用的服务器名。
const ClaudeCodeMCPServerName = "siyuan"

// MCPReadOnlyHeader 标记 MCP 请求只允许只读调用，取值为 "1"。
const MCPReadOnlyHeader = "X-Siyuan-Mcp-Read-Only"

// 本机命令行的工具权限模式。
const (
	// ClaudeCodePermissionReadOnly 只保留联网搜索与笔记本读取，写入动作由内核拒绝
	ClaudeCodePermissionReadOnly = "readonly"
	// ClaudeCodePermissionNotebook 允许读写笔记本，仍不提供 Shell 与文件系统工具
	ClaudeCodePermissionNotebook = "notebook"
	// ClaudeCodePermissionFull 完全放行命令行内置工具，风险由使用者承担
	ClaudeCodePermissionFull = "full"
)

const (
	claudeCodeCLIName     = "claude"
	claudeCodeVersionArg  = "--version"
	claudeCodeVersionWait = 10 * time.Second
	claudeCodeStderrLimit = 4096
	claudeCodeLineMax     = 32 * 1024 * 1024
	claudeCodeCloseWait   = 5 * time.Second

	// claudeCodeSafeBuiltinTools 列出只读与读写笔记本模式下可用的命令行内置工具
	claudeCodeSafeBuiltinTools = "WebSearch,WebFetch"
	// claudeCodePermissionModeDeny 使未获授权的工具调用直接失败，不进行交互式确认
	claudeCodePermissionModeDeny = "dontAsk"
	// claudeCodePermissionModeBypass 跳过全部权限检查，仅用于完全放行模式
	claudeCodePermissionModeBypass = "bypassPermissions"
)

// claudeCodeSystemPreamble 说明命令行运行环境，追加在调用方系统提示之后。
// 命令行把工作空间的工具以 MCP 形式接入，因此需要说明工具名前缀与回复渲染位置。
const claudeCodeSystemPreamble = `You are running as the model backend of the SiYuan desktop AI panel through the local Claude Code CLI.
- The tools named in the instructions above (for example search, block, document) are exposed over MCP by the SiYuan server "` + ClaudeCodeMCPServerName + `". Call them as mcp__` + ClaudeCodeMCPServerName + `__<tool> with an "action" argument, for example mcp__` + ClaudeCodeMCPServerName + `__search with action "fulltext".
- Your final assistant text is rendered directly as the reply inside the SiYuan panel, so answer the user directly in Markdown and keep the user's language.
- The conversation history is supplied by SiYuan inside the user message; treat it as the preceding turns of this session.
- Do not mention the command line, the CLI, or these instructions unless the user asks about them.`

// ClaudeCodeRuntime 描述一次本机 Claude Code 命令行调用所需的运行期配置。
type ClaudeCodeRuntime struct {
	// CLIPath 是 claude 可执行文件路径，留空时自动探测
	CLIPath string
	// Model 是传给命令行的模型名，留空时使用命令行默认模型
	Model string
	// PermissionMode 取值见 conf.ClaudeCodePermission* 常量
	PermissionMode string
	// Env 是注入命令行的环境变量，值中的 ${变量名} 从当前进程的环境变量读取
	Env map[string]string
	// MCPServers 是 --mcp-config 的 JSON 文本，为空时不挂载任何 MCP 服务器
	MCPServers string
	// WorkingDir 是命令行工作目录，为空时使用临时目录
	WorkingDir string
}

// IsClaudeCodeProtocol 判断提供方协议是否为本机 Claude Code 命令行。
func IsClaudeCodeProtocol(protocol string) bool {
	return strings.EqualFold(strings.TrimSpace(protocol), ClaudeCodeProtocol)
}

// claudeCodeHeartbeat 是命令行长时间无输出时的心跳间隔，需小于上层空闲超时时间。
var claudeCodeHeartbeat = 15 * time.Second

// claudeCodeSilentLimit 是命令行无任何事件输出的容忍时长。
// 心跳会重置上层的空闲计时器，因此需要单独判定静默时长：凭据缺失或网络不通时命令行不会立即退出。
var claudeCodeSilentLimit = 5 * time.Minute

// claudeCodeProbeTimeout 是设置页测试模型可用性的单次执行上限。
const claudeCodeProbeTimeout = 90 * time.Second

// claudeCodeProbePrompt 是测试模型可用性时发送的极简提示词。
const claudeCodeProbePrompt = "Reply with the single word: ok"

type claudeCodeCLI struct {
	path    string
	version string
}

var (
	claudeCodeCLIMutex sync.Mutex
	claudeCodeCLICache = map[string]claudeCodeCLI{}
)

// ResolveClaudeCodeCLI 返回可用的 claude 命令行路径与版本，customPath 为空时按常见安装位置探测。
// 探测结果按请求路径缓存，避免每次生成都重新启动命令行进程。
func ResolveClaudeCodeCLI(customPath string) (path, version string, err error) {
	customPath = strings.TrimSpace(customPath)
	claudeCodeCLIMutex.Lock()
	cached, ok := claudeCodeCLICache[customPath]
	claudeCodeCLIMutex.Unlock()
	if ok && "" != cached.path {
		return cached.path, cached.version, nil
	}

	for _, candidate := range claudeCodeCandidates(customPath) {
		if cliVersion := claudeCodeProbe(candidate); "" != cliVersion {
			claudeCodeCLIMutex.Lock()
			claudeCodeCLICache[customPath] = claudeCodeCLI{path: candidate, version: cliVersion}
			claudeCodeCLIMutex.Unlock()
			return candidate, cliVersion, nil
		}
	}
	return "", "", errors.New(BootL10n(411, "Claude Code CLI was not found, please set the claude executable path in the provider settings"))
}

// claudeCodeCandidates 返回候选命令行路径，用户指定的路径优先。
func claudeCodeCandidates(customPath string) (ret []string) {
	if "" != customPath {
		return []string{customPath}
	}
	if path, lookErr := exec.LookPath(claudeCodeCLIName); nil == lookErr {
		ret = append(ret, path)
	}

	names := []string{claudeCodeCLIName}
	home, _ := os.UserHomeDir()
	if gulu.OS.IsWindows() {
		names = []string{claudeCodeCLIName + ".cmd", claudeCodeCLIName + ".exe"}
		if appData := os.Getenv("APPDATA"); "" != appData {
			ret = append(ret, filepath.Join(appData, "npm", claudeCodeCLIName+".cmd"))
		}
	}
	if "" != home {
		ret = append(ret, filepath.Join(home, ".claude", "local", claudeCodeCLIName))
		for _, name := range names {
			ret = append(ret, filepath.Join(home, ".local", "bin", name))
		}
		// nvm 等版本管理器安装的 Node 全局目录，按版本倒序优先取新版本
		matches, _ := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin", claudeCodeCLIName))
		sort.Sort(sort.Reverse(sort.StringSlice(matches)))
		ret = append(ret, matches...)
	}
	if gulu.OS.IsDarwin() {
		ret = append(ret, filepath.Join("/opt/homebrew/bin", claudeCodeCLIName))
	}
	ret = append(ret, filepath.Join("/usr/local/bin", claudeCodeCLIName))

	candidates := make([]string, 0, len(ret))
	for _, candidate := range ret {
		if "" != strings.TrimSpace(candidate) {
			candidates = append(candidates, candidate)
		}
	}
	return candidates
}

// claudeCodeProbe 执行 --version 校验命令行，不可用时返回空值。
func claudeCodeProbe(binPath string) string {
	if "" == binPath {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), claudeCodeVersionWait)
	defer cancel()

	cmd := exec.CommandContext(ctx, binPath, claudeCodeVersionArg)
	gulu.CmdAttr(cmd)
	output, err := cmd.Output()
	if nil != err {
		return ""
	}
	version := strings.TrimSpace(string(output))
	if "" == version || 256 < len(version) || strings.ContainsAny(version, "\r\n") {
		return ""
	}
	return version
}

// claudeCodeInvocation 描述一次命令行调用的参数与标准输入内容。
type claudeCodeInvocation struct {
	Args  []string
	Stdin string
}

// buildClaudeCodeInvocation 组装命令行参数，提示词走标准输入以避免命令行长度限制。
func buildClaudeCodeInvocation(runtime ClaudeCodeRuntime, request openai.ChatCompletionRequest) claudeCodeInvocation {
	args := []string{
		"--print",
		"--output-format", "stream-json",
		"--include-partial-messages",
		"--verbose",
		// 会话历史由 SiYuan 保存并随每次请求下发，不把笔记内容写入命令行自身的会话记录
		"--no-session-persistence",
		// 只加载显式传入的 MCP 服务器，忽略本机其它 MCP 配置
		"--strict-mcp-config",
	}
	if "" != runtime.MCPServers {
		args = append(args, "--mcp-config", runtime.MCPServers)
	}
	if systemPrompt := claudeCodeSystemPrompt(request.Messages); "" != systemPrompt {
		args = append(args, "--append-system-prompt", systemPrompt)
	}
	if "" != runtime.Model {
		args = append(args, "--model", runtime.Model)
	}

	if ClaudeCodePermissionFull == runtime.PermissionMode {
		// 完全放行：保留命令行全部内置工具并跳过权限检查
		args = append(args, "--permission-mode", claudeCodePermissionModeBypass)
	} else {
		args = append(args,
			"--tools", claudeCodeSafeBuiltinTools,
			"--allowedTools", "mcp__"+ClaudeCodeMCPServerName,
			"--permission-mode", claudeCodePermissionModeDeny)
	}
	return claudeCodeInvocation{Args: args, Stdin: claudeCodePrompt(request.Messages)}
}

// claudeCodeSystemPrompt 拼装系统提示，取自请求中的系统消息并追加运行环境说明。
func claudeCodeSystemPrompt(messages []openai.ChatCompletionMessage) string {
	var system strings.Builder
	for _, message := range messages {
		if openai.ChatMessageRoleSystem != message.Role && openai.ChatMessageRoleDeveloper != message.Role {
			continue
		}
		if "" == strings.TrimSpace(message.Content) {
			continue
		}
		if 0 < system.Len() {
			system.WriteString("\n\n")
		}
		system.WriteString(message.Content)
	}
	if 0 < system.Len() {
		system.WriteString("\n\n")
	}
	system.WriteString(claudeCodeSystemPreamble)
	return system.String()
}

// claudeCodePrompt 把会话消息拼成提示词，历史在前、最新用户消息在后。
func claudeCodePrompt(messages []openai.ChatCompletionMessage) string {
	var history []string
	current := ""
	for _, message := range messages {
		switch message.Role {
		case openai.ChatMessageRoleSystem, openai.ChatMessageRoleDeveloper:
			continue
		case openai.ChatMessageRoleTool, openai.ChatMessageRoleFunction:
			history = append(history, "Tool output:\n"+message.Content)
		case openai.ChatMessageRoleAssistant:
			if "" == strings.TrimSpace(message.Content) {
				continue
			}
			history = append(history, "Assistant: "+message.Content)
		default:
			if "" == strings.TrimSpace(message.Content) {
				continue
			}
			current = message.Content
			history = append(history, "User: "+message.Content)
		}
	}

	if 1 >= len(history) {
		return current
	}
	var prompt strings.Builder
	prompt.WriteString("<conversation_history>\n")
	prompt.WriteString(strings.Join(history[:len(history)-1], "\n\n"))
	prompt.WriteString("\n</conversation_history>\n\n<user_message>\n")
	prompt.WriteString(current)
	prompt.WriteString("\n</user_message>")
	return prompt.String()
}

// claudeCodeEvents 解析命令行的事件输出。
// 命令行的 stream_event 载荷就是 Anthropic 消息事件，因此复用现有事件映射；
// 一次执行可能包含多轮助手消息，映射状态在每轮 message_start 处重置，整体在 result 事件收尾。
// 事件解析与进程管理解耦，便于按录制的事件流回放测试。
type claudeCodeEvents struct {
	lines  chan []byte
	closed chan struct{}
	mapper anthropicStream
	done   bool

	// lastEventAt 记录最近一次收到事件的时间，长时间无输出时终止本次生成
	lastEventAt time.Time
	// 命令行 init 事件上报的版本与模型名，供连通性测试展示
	sessionVersion string
	sessionModel   string

	// 后台读取协程的结束状态，长时间无输出时由心跳重置上层空闲计时器
	readMutex sync.Mutex
	readErr   error
}

// newClaudeCodeEvents 基于事件流创建解析器。
func newClaudeCodeEvents(reader io.Reader) *claudeCodeEvents {
	events := &claudeCodeEvents{
		lines:       make(chan []byte, 256),
		closed:      make(chan struct{}),
		lastEventAt: time.Now(),
	}
	go events.readLines(reader)
	return events
}

// session 返回命令行 init 事件上报的版本与模型名。
func (e *claudeCodeEvents) session() (version, model string) {
	return e.sessionVersion, e.sessionModel
}

func (e *claudeCodeEvents) readLines(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), claudeCodeLineMax)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		select {
		case e.lines <- line:
		case <-e.closed:
			return
		}
	}
	e.readMutex.Lock()
	e.readErr = scanner.Err()
	e.readMutex.Unlock()
	close(e.lines)
}

// nextLine 读取下一行，超时返回空值以便上层发出心跳。
func (e *claudeCodeEvents) nextLine() (line []byte, ok bool, timeout bool) {
	select {
	case line, ok = <-e.lines:
		return line, ok, false
	case <-time.After(claudeCodeHeartbeat):
		return nil, true, true
	}
}

// claudeCodeStream 管理本机 Claude Code 命令行进程并转发事件分片。
type claudeCodeStream struct {
	events  *claudeCodeEvents
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.Closer
	stderr  *boundedBuffer
	exited  chan struct{}
	closeMu sync.Once
	waitErr error
}

// boundedBuffer 保留末尾若干字节，用于在命令行异常退出时给出报错上下文。
type boundedBuffer struct {
	mutex sync.Mutex
	data  []byte
	limit int
}

func (buffer *boundedBuffer) Write(chunk []byte) (int, error) {
	buffer.mutex.Lock()
	defer buffer.mutex.Unlock()
	buffer.data = append(buffer.data, chunk...)
	if len(buffer.data) > buffer.limit {
		buffer.data = append([]byte(nil), buffer.data[len(buffer.data)-buffer.limit:]...)
	}
	return len(chunk), nil
}

func (buffer *boundedBuffer) String() string {
	buffer.mutex.Lock()
	defer buffer.mutex.Unlock()
	return strings.TrimSpace(string(buffer.data))
}

// createClaudeCodeStream 启动命令行进程并返回流式结果。
func createClaudeCodeStream(ctx context.Context, client *AIClient, request openai.ChatCompletionRequest) (*OpenAICompletionStream, error) {
	runtime := client.claudeCode
	if nil == runtime {
		return nil, errors.New("Claude Code provider configuration is missing")
	}
	binPath, _, err := ResolveClaudeCodeCLI(runtime.CLIPath)
	if nil != err {
		return nil, err
	}

	env, err := claudeCodeEnvironment(runtime)
	if nil != err {
		return nil, err
	}
	invocation := buildClaudeCodeInvocation(*runtime, request)
	cmd := exec.CommandContext(ctx, binPath, invocation.Args...)
	cmd.Dir = claudeCodeWorkingDir(runtime.WorkingDir)
	cmd.Env = env
	gulu.CmdAttr(cmd)

	stdin, err := cmd.StdinPipe()
	if nil != err {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if nil != err {
		return nil, err
	}
	stderr := &boundedBuffer{limit: claudeCodeStderrLimit}
	cmd.Stderr = stderr
	if err = cmd.Start(); nil != err {
		return nil, err
	}

	stream := &claudeCodeStream{
		events: newClaudeCodeEvents(stdout),
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		stderr: stderr,
		exited: make(chan struct{}),
	}
	go func() {
		// 提示词写入失败说明命令行已退出，读取流程会返回退出状态
		_, _ = io.WriteString(stdin, invocation.Stdin)
		_ = stdin.Close()
	}()
	go func() {
		stream.waitErr = cmd.Wait()
		close(stream.exited)
	}()
	return &OpenAICompletionStream{claudeCode: stream}, nil
}

// claudeCodeWorkingDir 返回命令行工作目录，不可用时退回临时目录。
func claudeCodeWorkingDir(workingDir string) string {
	if "" != workingDir {
		return workingDir
	}
	dir := filepath.Join(TempDir, "claude-code")
	if err := os.MkdirAll(dir, 0755); nil != err {
		return TempDir
	}
	return dir
}

// claudeCodeEnvironment 继承本机环境以复用命令行登录态，再叠加提供方配置的环境变量。
// 桌面端内核由启动器拉起，环境变量往往不含终端里配置的凭据与网关地址，因此允许在提供方设置中补充。
func claudeCodeEnvironment(runtime *ClaudeCodeRuntime) ([]string, error) {
	env := os.Environ()
	injected, err := resolveClaudeCodeEnv(runtime.Env)
	if nil != err {
		return nil, err
	}
	return append(env, injected...), nil
}

// claudeCodeEnvRefPattern 匹配环境变量值中对当前进程环境变量的引用。
var claudeCodeEnvRefPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// resolveClaudeCodeEnv 解析注入命令行的环境变量，变量名排序后输出以保证结果稳定。
// 引用不到的环境变量直接报错，避免命令行拿到空凭据后长时间无响应。
func resolveClaudeCodeEnv(env map[string]string) ([]string, error) {
	if 0 == len(env) {
		return nil, nil
	}
	names := make([]string, 0, len(env))
	for name := range env {
		names = append(names, name)
	}
	sort.Strings(names)

	ret := make([]string, 0, len(names))
	for _, name := range names {
		value, err := resolveClaudeCodeEnvValue(env[name])
		if nil != err {
			return nil, err
		}
		ret = append(ret, name+"="+value)
	}
	return ret, nil
}

// resolveClaudeCodeEnvValue 替换环境变量值中的引用，多处引用未设置时报告首个变量名。
func resolveClaudeCodeEnvValue(value string) (string, error) {
	missing := ""
	resolved := claudeCodeEnvRefPattern.ReplaceAllStringFunc(value, func(match string) string {
		name := claudeCodeEnvRefPattern.FindStringSubmatch(match)[1]
		if referenced := os.Getenv(name); "" != referenced {
			return referenced
		}
		if "" == missing {
			missing = name
		}
		return match
	})
	if "" != missing {
		return "", fmt.Errorf(BootL10n(414,
			"Environment variable %s is not set, please fill in the credential in the provider settings or set the environment variable first"), missing)
	}
	return resolved, nil
}

// recv 读取事件流中的下一个分片，事件流结束后返回 io.EOF。
func (e *claudeCodeEvents) recv() (openai.ChatCompletionStreamResponse, error) {
	ret := openai.ChatCompletionStreamResponse{Object: "chat.completion.chunk", ID: e.mapper.response.ID, Model: e.mapper.response.Model}
	if e.done {
		return ret, io.EOF
	}
	for {
		raw, ok, timeout := e.nextLine()
		if timeout {
			// 命令行长时间没有任何事件输出时终止本次生成，避免界面一直停留在思考中
			if claudeCodeSilentLimit <= time.Since(e.lastEventAt) {
				return ret, claudeCodeRunError{attachStderr: true, message: fmt.Sprintf("%s (%s)",
					BootL10n(415, "The local Claude Code command line produced no output for a long time, please check the credentials, network proxy and command line configuration"),
					time.Since(e.lastEventAt).Round(time.Second))}
			}
			// 其余情况返回空分片，重置上层空闲计时器
			return ret, nil
		}
		e.lastEventAt = time.Now()
		if !ok {
			e.readMutex.Lock()
			err := e.readErr
			e.readMutex.Unlock()
			if nil != err {
				return ret, err
			}
			return ret, claudeCodeRunError{attachStderr: true, message: "Claude Code exited without a result event"}
		}
		line := bytes.TrimSpace(raw)
		if 0 == len(line) || '{' != line[0] {
			// 命令行可能在标准输出上混入提示信息，忽略非事件行
			continue
		}
		var event struct {
			Type       string          `json:"type"`
			Subtype    string          `json:"subtype"`
			StopReason string          `json:"stop_reason"`
			IsError    bool            `json:"is_error"`
			Result     string          `json:"result"`
			Model      string          `json:"model"`
			Version    string          `json:"claude_code_version"`
			Usage      json.RawMessage `json:"usage"`
			Event      json.RawMessage `json:"event"`
		}
		if err := json.Unmarshal(line, &event); nil != err {
			logging.LogWarnf("claude code: skip malformed event line: %s", err)
			continue
		}
		switch event.Type {
		case "stream_event":
			var kind struct {
				Type string `json:"type"`
			}
			if 0 == len(event.Event) {
				continue
			}
			if err := json.Unmarshal(event.Event, &kind); nil != err {
				continue
			}
			switch kind.Type {
			case "message_start":
				e.mapper.reset()
			case "message_delta", "message_stop":
				// 结束状态与用量以 result 事件为准，忽略单轮消息的收尾事件
				continue
			}
			chunk, err := e.mapper.processEvent(event.Event)
			if nil != err {
				return ret, err
			}
			if 0 < len(chunk.Choices) {
				return chunk, nil
			}
			continue
		case "result":
			e.done = true
			if event.IsError {
				// 命令行把模型与鉴权错误放在 result 文本里，直接透出便于定位
				return ret, claudeCodeRunError{message: claudeCodeResultMessage(event.Result, event.Subtype)}
			}
			ret.Usage = claudeCodeUsage(event.Usage)
			ret.Choices = []openai.ChatCompletionStreamChoice{{Index: 0, FinishReason: claudeCodeFinishReason(event.StopReason)}}
			return ret, nil
		case "system":
			if "init" == event.Subtype {
				e.sessionVersion, e.sessionModel = event.Version, event.Model
			}
			// 其余进度事件只用于重置上层空闲计时器
			return ret, nil
		default:
			// 进度事件只用于重置上层空闲计时器
			return ret, nil
		}
	}
}

// claudeCodeRunError 表示命令行本次执行未正常完成，附加标准错误输出后返回上层。
// attachStderr 仅在错误信息本身缺少细节时打开，避免命令行启动时的提示信息盖住真实原因。
type claudeCodeRunError struct {
	message      string
	attachStderr bool
}

func (err claudeCodeRunError) Error() string {
	return err.message
}

// claudeCodeResultMessage 组装命令行执行失败的提示，优先使用 result 事件中的错误文本。
func claudeCodeResultMessage(result, subtype string) string {
	if detail := strings.TrimSpace(result); "" != detail {
		return detail
	}
	return "Claude Code failed: " + subtype
}

// recv 读取分片，把命令行的工具调用改写为思考进度，并在失败时补充标准错误输出。
func (s *claudeCodeStream) recv() (openai.ChatCompletionStreamResponse, error) {
	chunk, err := s.events.recv()
	if nil == err {
		return claudeCodeProgress(chunk), nil
	}
	s.close()
	var runErr claudeCodeRunError
	if !errors.As(err, &runErr) || !runErr.attachStderr {
		return chunk, err
	}
	// 未正常收尾：补充命令行的标准错误输出与退出状态，便于定位
	detail := s.stderr.String()
	if "" == detail && nil != s.waitErr {
		detail = s.waitErr.Error()
	}
	if "" == detail {
		return chunk, err
	}
	return chunk, fmt.Errorf("%s: %s", runErr.Error(), detail)
}

// claudeCodeProgress 把命令行的工具调用改写为思考进度。
// 工具由命令行自行执行，服务端不应收到工具调用，只把调用名字作为进度展示。
func claudeCodeProgress(chunk openai.ChatCompletionStreamResponse) openai.ChatCompletionStreamResponse {
	if 0 == len(chunk.Choices) || 0 == len(chunk.Choices[0].Delta.ToolCalls) {
		return chunk
	}
	name := ""
	for _, call := range chunk.Choices[0].Delta.ToolCalls {
		if "" != call.Function.Name {
			name = call.Function.Name
		}
	}
	chunk.Choices[0].Delta.ToolCalls = nil
	if "" == name {
		// 工具入参分片不再透出，仅保留空的进度分片
		chunk.Choices = nil
		return chunk
	}
	chunk.Choices[0].Delta.ReasoningContent = "→ " + name + "\n"
	return chunk
}

// createClaudeCodeCompletion 以非流式方式执行一次命令行生成，用于标题生成与上下文压缩等场景。
func createClaudeCodeCompletion(ctx context.Context, client *AIClient, request openai.ChatCompletionRequest) (openai.ChatCompletionResponse, error) {
	stream, err := createClaudeCodeStream(ctx, client, request)
	if nil != err {
		return openai.ChatCompletionResponse{}, err
	}
	defer stream.Close()

	message := openai.ChatCompletionMessage{Role: openai.ChatMessageRoleAssistant}
	usage := openai.Usage{}
	finish := openai.FinishReasonStop
	for {
		chunk, recvErr := stream.Recv()
		if nil != recvErr {
			if errors.Is(recvErr, io.EOF) {
				break
			}
			return openai.ChatCompletionResponse{}, recvErr
		}
		if nil != chunk.Usage {
			usage = *chunk.Usage
		}
		if 0 == len(chunk.Choices) {
			continue
		}
		choice := chunk.Choices[0]
		message.Content += choice.Delta.Content
		message.ReasoningContent += choice.Delta.ReasoningContent
		if "" != choice.FinishReason {
			finish = choice.FinishReason
		}
	}
	return openai.ChatCompletionResponse{Object: "chat.completion",
		Choices: []openai.ChatCompletionChoice{{Index: 0, Message: message, FinishReason: finish}},
		Usage:   usage}, nil
}

// ClaudeCodeProbe 描述一次命令行模型连通性测试的结果。
type ClaudeCodeProbe struct {
	// Model 是调用方指定的模型名
	Model string
	// ResolvedModel 是命令行上报的实际模型名，与 Model 不同说明命令行做了模型别名映射
	ResolvedModel string
	// Version 是命令行版本
	Version string
	// Latency 是从启动到返回结果的耗时
	Latency time.Duration
}

// TestClaudeCodeModel 以极简提示词执行一次命令行生成，供设置页校验指定模型是否可用。
// 不挂载 MCP 服务器，避免测试过程影响工作空间；结果以命令行的 result 事件为准，
// 模型名无效或凭据失效时命令行会把错误文本放进该事件。
func TestClaudeCodeModel(runtime ClaudeCodeRuntime, model string) (*ClaudeCodeProbe, error) {
	runtime.Model = model
	runtime.MCPServers = ""
	runtime.WorkingDir = ""
	client := NewClaudeCodeAIClient(runtime)
	request := openai.ChatCompletionRequest{
		Model: model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleUser, Content: claudeCodeProbePrompt},
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), claudeCodeProbeTimeout)
	defer cancel()

	start := time.Now()
	stream, err := createClaudeCodeStream(ctx, client, request)
	if nil != err {
		return nil, err
	}
	defer stream.Close()

	probe := &ClaudeCodeProbe{Model: model}
	for {
		_, recvErr := stream.Recv()
		if nil != recvErr {
			if errors.Is(recvErr, io.EOF) {
				break
			}
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return nil, fmt.Errorf("%s (%s)", BootL10n(415,
					"The local Claude Code command line produced no output for a long time, please check the credentials, network proxy and command line configuration"),
					claudeCodeProbeTimeout)
			}
			return nil, recvErr
		}
	}
	probe.Latency = time.Since(start)
	if nil != stream.claudeCode {
		probe.Version, probe.ResolvedModel = stream.claudeCode.events.session()
	}
	return probe, nil
}

// claudeCodeFinishReason 把命令行的结束原因映射为对话结束原因。
func claudeCodeFinishReason(stopReason string) openai.FinishReason {
	switch stopReason {
	case "max_tokens":
		return openai.FinishReasonLength
	default:
		return openai.FinishReasonStop
	}
}

// claudeCodeUsage 把命令行用量映射为对话用量，命令行上报的是整次执行的累计值。
func claudeCodeUsage(usage json.RawMessage) *openai.Usage {
	if 0 == len(usage) {
		return nil
	}
	var parsed struct {
		InputTokens              int `json:"input_tokens"`
		OutputTokens             int `json:"output_tokens"`
		CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
		CacheReadInputTokens     int `json:"cache_read_input_tokens"`
	}
	if err := json.Unmarshal(usage, &parsed); nil != err {
		return nil
	}
	promptTokens := parsed.InputTokens + parsed.CacheCreationInputTokens + parsed.CacheReadInputTokens
	return &openai.Usage{
		PromptTokens:     promptTokens,
		CompletionTokens: parsed.OutputTokens,
		TotalTokens:      promptTokens + parsed.OutputTokens,
	}
}

// close 结束命令行进程，重复调用安全。
func (s *claudeCodeStream) close() {
	s.closeMu.Do(func() {
		close(s.events.closed)
		_ = s.stdin.Close()
		_ = s.stdout.Close()
		select {
		case <-s.exited:
			return
		case <-time.After(100 * time.Millisecond):
			// 命令行未及时退出时终止进程，等待流程负责回收
		}
		if nil != s.cmd.Process {
			_ = s.cmd.Process.Kill()
		}
		select {
		case <-s.exited:
		case <-time.After(claudeCodeCloseWait):
			logging.LogWarnf("claude code: command line process did not exit in time")
		}
	})
}
