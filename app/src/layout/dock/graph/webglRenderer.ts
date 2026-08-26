import {getGraphNodeColor, IGraphRenderer, IGraphRenderState, parseGraphColor} from "./renderer";
import {getGraphArrowLength, getGraphEdgeOpacity, MIN_GRAPH_EDGE_WIDTH} from "./core";

const NODE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_position;
layout(location = 2) in float a_size;
layout(location = 3) in vec4 a_color;
layout(location = 4) in float a_state;
uniform vec2 u_viewport;
uniform vec3 u_camera;
out vec2 v_corner;
out vec4 v_color;
out float v_state;
void main() {
    vec2 screen = a_position * u_camera.z + u_camera.xy;
    float radius = max(1.0, a_size * u_camera.z);
    vec2 position = screen + a_corner * radius;
    vec2 clip = position / u_viewport * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_corner = a_corner;
    v_color = a_color;
    v_state = a_state;
}`;

const NODE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_corner;
in vec4 v_color;
in float v_state;
uniform vec4 u_highlight;
out vec4 out_color;
void main() {
    float distance = length(v_corner);
    float antialias = max(fwidth(distance), 0.001);
    float coverage = 1.0 - smoothstep(1.0 - antialias, 1.0 + antialias, distance);
    if (coverage <= 0.0) {
        discard;
    }
    vec4 color = v_color;
    if (v_state > 0.0) {
        color = u_highlight;
    }
    out_color = vec4(color.rgb, color.a * coverage);
}`;

const EDGE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_start;
layout(location = 2) in vec2 a_end;
layout(location = 3) in vec4 a_color;
layout(location = 4) in float a_state;
layout(location = 5) in float a_reference;
layout(location = 6) in float a_target_size;
uniform vec2 u_viewport;
uniform vec3 u_camera;
uniform float u_arrow;
uniform float u_arrow_length;
uniform float u_min_width;
uniform float u_width;
out vec4 v_color;
out float v_state;
out float v_distance;
out float v_half_width;
out float v_length;
out float v_position;
void main() {
    vec2 start = a_start * u_camera.z + u_camera.xy;
    vec2 end = a_end * u_camera.z + u_camera.xy;
    vec2 delta = end - start;
    float distance = max(0.001, length(delta));
    vec2 direction = delta / distance;
    vec2 normal = vec2(-direction.y, direction.x);
    float width = max(u_min_width, u_width * u_camera.z);
    float half_width = width * 0.5;
    float outer_half_width = half_width + 1.0;
    float line_length = distance;
    if (u_arrow > 0.5 && a_reference > 0.5 && u_camera.z >= 0.08) {
        line_length = max(0.0,
            distance - max(1.0, a_target_size * u_camera.z) - u_arrow_length - half_width);
    }
    float line_position = mix(-outer_half_width, line_length + outer_half_width, a_corner.x);
    vec2 position = start + direction * line_position + normal * a_corner.y * outer_half_width;
    vec2 clip = position / u_viewport * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_color = a_color;
    v_state = a_state;
    v_distance = a_corner.y * outer_half_width;
    v_half_width = half_width;
    v_length = line_length;
    v_position = line_position;
}`;

const EDGE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
in float v_state;
in float v_distance;
in float v_half_width;
in float v_length;
in float v_position;
uniform vec4 u_highlight;
uniform float u_highlight_opacity;
uniform float u_opacity;
out vec4 out_color;
void main() {
    float distance = abs(v_distance);
    if (v_position < 0.0) {
        distance = length(vec2(v_position, v_distance));
    } else if (v_position > v_length) {
        distance = length(vec2(v_position - v_length, v_distance));
    }
    float antialias = max(fwidth(distance), 0.001);
    float coverage = 1.0 - smoothstep(v_half_width - antialias, v_half_width + antialias, distance);
    if (coverage <= 0.0) {
        discard;
    }
    vec4 color = v_state > 0.0 ? u_highlight : v_color;
    float opacity = v_state > 0.0 ? u_highlight_opacity : u_opacity;
    out_color = vec4(color.rgb, color.a * opacity * coverage);
}`;

const ARROW_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_start;
layout(location = 2) in vec2 a_end;
layout(location = 3) in float a_target_size;
layout(location = 4) in vec4 a_color;
layout(location = 5) in float a_state;
uniform vec2 u_viewport;
uniform vec3 u_camera;
uniform float u_arrow_length;
out vec4 v_color;
out float v_state;
out vec3 v_barycentric;
void main() {
    vec2 start = a_start * u_camera.z + u_camera.xy;
    vec2 end = a_end * u_camera.z + u_camera.xy;
    vec2 delta = end - start;
    float distance = max(0.001, length(delta));
    vec2 direction = delta / distance;
    vec2 normal = vec2(-direction.y, direction.x);
    vec2 tip = end - direction * max(1.0, a_target_size * u_camera.z);
    vec2 position = tip + direction * a_corner.x * u_arrow_length + normal * a_corner.y * u_arrow_length;
    vec2 clip = position / u_viewport * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_color = a_color;
    v_state = a_state;
    v_barycentric = gl_VertexID == 0 ? vec3(1.0, 0.0, 0.0) :
        gl_VertexID == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
}`;

const ARROW_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
in float v_state;
in vec3 v_barycentric;
uniform vec4 u_highlight;
uniform float u_highlight_opacity;
uniform float u_opacity;
out vec4 out_color;
void main() {
    float distance = min(v_barycentric.x, min(v_barycentric.y, v_barycentric.z));
    float antialias = max(fwidth(distance), 0.0001);
    float coverage = smoothstep(0.0, antialias, distance);
    vec4 color = v_state > 0.0 ? u_highlight : v_color;
    float opacity = v_state > 0.0 ? u_highlight_opacity : u_opacity;
    out_color = vec4(color.rgb, color.a * opacity * coverage);
}`;

export class GraphWebGLRenderer implements IGraphRenderer {
    private readonly arrowColorBuffer: WebGLBuffer;
    private readonly arrowEndpointBuffer: WebGLBuffer;
    private readonly arrowProgram: WebGLProgram;
    private readonly arrowSizeBuffer: WebGLBuffer;
    private readonly arrowStateBuffer: WebGLBuffer;
    private readonly arrowVao: WebGLVertexArrayObject;
    private readonly canvas: HTMLCanvasElement;
    private readonly buffers: WebGLBuffer[] = [];
    private readonly edgeColorBuffer: WebGLBuffer;
    private readonly edgeEndpointBuffer: WebGLBuffer;
    private readonly edgeProgram: WebGLProgram;
    private readonly edgeReferenceBuffer: WebGLBuffer;
    private readonly edgeStateBuffer: WebGLBuffer;
    private readonly edgeTargetSizeBuffer: WebGLBuffer;
    private readonly edgeVao: WebGLVertexArrayObject;
    private readonly gl: WebGL2RenderingContext;
    private readonly nodeColorBuffer: WebGLBuffer;
    private readonly nodePositionBuffer: WebGLBuffer;
    private readonly nodeProgram: WebGLProgram;
    private readonly nodeSizeBuffer: WebGLBuffer;
    private readonly nodeStateBuffer: WebGLBuffer;
    private readonly nodeVao: WebGLVertexArrayObject;
    private arrowColors = new Float32Array();
    private arrowEndpoints = new Float32Array();
    private arrowIndices = new Uint32Array();
    private arrowSizes = new Float32Array();
    private arrowStates = new Float32Array();
    private edgeColors = new Float32Array();
    private edgeEndpoints = new Float32Array();
    private edgeReferences = new Float32Array();
    private edgeStates = new Float32Array();
    private edgeTargetSizes = new Float32Array();
    private geometryVersion = -1;
    private highlightLine = new Float32Array([0, 0, 0, 1]);
    private highlightPoint = new Float32Array([0, 0, 0, 1]);
    private nodeColors = new Float32Array();
    private nodeStates = new Float32Array();
    private positionVersion = -1;
    private selectionVersion = -1;
    private styleVersion = -1;

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2", {
            alpha: true,
            antialias: true,
            depth: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            stencil: false,
        });
        if (!gl) {
            throw new Error("WebGL2 is unavailable");
        }
        this.canvas = canvas;
        this.gl = gl;
        this.nodeProgram = this.createProgram(NODE_VERTEX_SHADER, NODE_FRAGMENT_SHADER);
        this.edgeProgram = this.createProgram(EDGE_VERTEX_SHADER, EDGE_FRAGMENT_SHADER);
        this.arrowProgram = this.createProgram(ARROW_VERTEX_SHADER, ARROW_FRAGMENT_SHADER);
        this.nodeVao = this.requireValue(gl.createVertexArray());
        this.edgeVao = this.requireValue(gl.createVertexArray());
        this.arrowVao = this.requireValue(gl.createVertexArray());
        this.nodePositionBuffer = this.createBuffer();
        this.nodeSizeBuffer = this.createBuffer();
        this.nodeColorBuffer = this.createBuffer();
        this.nodeStateBuffer = this.createBuffer();
        this.edgeEndpointBuffer = this.createBuffer();
        this.edgeColorBuffer = this.createBuffer();
        this.edgeStateBuffer = this.createBuffer();
        this.edgeReferenceBuffer = this.createBuffer();
        this.edgeTargetSizeBuffer = this.createBuffer();
        this.arrowEndpointBuffer = this.createBuffer();
        this.arrowSizeBuffer = this.createBuffer();
        this.arrowColorBuffer = this.createBuffer();
        this.arrowStateBuffer = this.createBuffer();
        this.configureVertexArrays();
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    public render(state: IGraphRenderState) {
        const width = Math.max(1, Math.round(state.width * state.devicePixelRatio));
        const height = Math.max(1, Math.round(state.height * state.devicePixelRatio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        if (this.geometryVersion !== state.geometryVersion || this.styleVersion !== state.styleVersion) {
            this.updateGeometry(state);
        }
        if (this.positionVersion !== state.positionVersion) {
            this.updatePositions(state);
        }
        if (this.selectionVersion !== state.selectionVersion) {
            this.updateSelection(state);
        }
        const gl = this.gl;
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.drawEdges(state);
        this.drawArrows(state);
        this.drawNodes(state);
    }

    public destroy() {
        this.buffers.forEach((buffer) => this.gl.deleteBuffer(buffer));
        this.gl.deleteVertexArray(this.nodeVao);
        this.gl.deleteVertexArray(this.edgeVao);
        this.gl.deleteVertexArray(this.arrowVao);
        this.gl.deleteProgram(this.nodeProgram);
        this.gl.deleteProgram(this.edgeProgram);
        this.gl.deleteProgram(this.arrowProgram);
    }

    private updateGeometry(state: IGraphRenderState) {
        const gl = this.gl;
        const colorCache = new Map<string, [number, number, number, number]>();
        const getColor = (color: string) => {
            let value = colorCache.get(color);
            if (!value) {
                value = parseGraphColor(color);
                colorCache.set(color, value);
            }
            return value;
        };
        const nodeCount = state.data.nodes.length;
        this.nodeColors = new Float32Array(nodeCount * 4);
        state.data.nodes.forEach((node, index) => {
            this.nodeColors.set(getColor(getGraphNodeColor(node.type, state.palette)), index * 4);
        });
        this.upload(this.nodeSizeBuffer, state.data.sizes, gl.DYNAMIC_DRAW);
        this.upload(this.nodeColorBuffer, this.nodeColors, gl.STATIC_DRAW);
        const edgeCount = state.data.links.length;
        this.edgeColors = new Float32Array(edgeCount * 4);
        this.edgeReferences = new Float32Array(edgeCount);
        this.edgeTargetSizes = new Float32Array(edgeCount);
        state.data.links.forEach((link, index) => {
            this.edgeColors.set(getColor(link.ref ? state.palette.referenceLine : state.palette.line), index * 4);
            this.edgeReferences[index] = link.ref ? 1 : 0;
            this.edgeTargetSizes[index] = state.data.sizes[link.target];
        });
        this.upload(this.edgeColorBuffer, this.edgeColors, gl.STATIC_DRAW);
        this.upload(this.edgeReferenceBuffer, this.edgeReferences, gl.STATIC_DRAW);
        this.upload(this.edgeTargetSizeBuffer, this.edgeTargetSizes, gl.DYNAMIC_DRAW);
        const arrowIndices: number[] = [];
        if (state.options.arrow) {
            state.data.links.forEach((link, index) => {
                if (link.ref) {
                    arrowIndices.push(index);
                }
            });
        }
        this.arrowIndices = Uint32Array.from(arrowIndices);
        this.arrowColors = new Float32Array(this.arrowIndices.length * 4);
        this.arrowSizes = new Float32Array(this.arrowIndices.length);
        this.arrowIndices.forEach((edgeIndex, index) => {
            const link = state.data.links[edgeIndex];
            this.arrowColors.set(getColor(state.palette.referenceLine), index * 4);
            this.arrowSizes[index] = state.data.sizes[link.target];
        });
        this.upload(this.arrowColorBuffer, this.arrowColors, gl.STATIC_DRAW);
        this.upload(this.arrowSizeBuffer, this.arrowSizes, gl.DYNAMIC_DRAW);
        this.highlightLine = Float32Array.from(getColor(state.palette.highlightLine));
        this.highlightPoint = Float32Array.from(getColor(state.palette.highlightPoint));
        this.geometryVersion = state.geometryVersion;
        this.styleVersion = state.styleVersion;
        this.positionVersion = -1;
        this.selectionVersion = -1;
    }

    private updatePositions(state: IGraphRenderState) {
        const gl = this.gl;
        this.upload(this.nodePositionBuffer, state.positions, gl.DYNAMIC_DRAW);
        this.edgeEndpoints = new Float32Array(state.data.links.length * 4);
        state.data.links.forEach((link, index) => {
            const offset = index * 4;
            this.edgeEndpoints[offset] = state.positions[link.source * 2];
            this.edgeEndpoints[offset + 1] = state.positions[link.source * 2 + 1];
            this.edgeEndpoints[offset + 2] = state.positions[link.target * 2];
            this.edgeEndpoints[offset + 3] = state.positions[link.target * 2 + 1];
        });
        this.upload(this.edgeEndpointBuffer, this.edgeEndpoints, gl.DYNAMIC_DRAW);
        this.arrowEndpoints = new Float32Array(this.arrowIndices.length * 4);
        this.arrowIndices.forEach((edgeIndex, index) => {
            const edgeOffset = edgeIndex * 4;
            const arrowOffset = index * 4;
            this.arrowEndpoints[arrowOffset] = this.edgeEndpoints[edgeOffset];
            this.arrowEndpoints[arrowOffset + 1] = this.edgeEndpoints[edgeOffset + 1];
            this.arrowEndpoints[arrowOffset + 2] = this.edgeEndpoints[edgeOffset + 2];
            this.arrowEndpoints[arrowOffset + 3] = this.edgeEndpoints[edgeOffset + 3];
        });
        this.upload(this.arrowEndpointBuffer, this.arrowEndpoints, gl.DYNAMIC_DRAW);
        this.positionVersion = state.positionVersion;
    }

    private updateSelection(state: IGraphRenderState) {
        const gl = this.gl;
        this.nodeStates = new Float32Array(state.data.nodes.length);
        if (state.hovered >= 0) {
            this.nodeStates[state.hovered] = 1;
        }
        if (state.selected >= 0) {
            this.nodeStates[state.selected] = 2;
        }
        this.upload(this.nodeStateBuffer, this.nodeStates, gl.DYNAMIC_DRAW);
        this.edgeStates = new Float32Array(state.data.links.length);
        state.data.links.forEach((link, index) => {
            if (link.source === state.selected || link.target === state.selected ||
                link.source === state.hovered || link.target === state.hovered) {
                this.edgeStates[index] = 1;
            }
        });
        this.upload(this.edgeStateBuffer, this.edgeStates, gl.DYNAMIC_DRAW);
        this.arrowStates = new Float32Array(this.arrowIndices.length);
        this.arrowIndices.forEach((edgeIndex, index) => {
            this.arrowStates[index] = this.edgeStates[edgeIndex];
        });
        this.upload(this.arrowStateBuffer, this.arrowStates, gl.DYNAMIC_DRAW);
        this.selectionVersion = state.selectionVersion;
    }

    private drawNodes(state: IGraphRenderState) {
        const gl = this.gl;
        gl.useProgram(this.nodeProgram);
        gl.bindVertexArray(this.nodeVao);
        this.setViewUniforms(this.nodeProgram, state);
        gl.uniform4fv(this.getUniform(this.nodeProgram, "u_highlight"), this.highlightPoint);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.data.nodes.length);
    }

    private drawEdges(state: IGraphRenderState) {
        const gl = this.gl;
        gl.useProgram(this.edgeProgram);
        gl.bindVertexArray(this.edgeVao);
        this.setViewUniforms(this.edgeProgram, state);
        gl.uniform1f(this.getUniform(this.edgeProgram, "u_arrow"), state.options.arrow ? 1 : 0);
        gl.uniform1f(this.getUniform(this.edgeProgram, "u_arrow_length"),
            getGraphArrowLength(state.options.linkWidth, state.camera.scale));
        gl.uniform1f(this.getUniform(this.edgeProgram, "u_min_width"), MIN_GRAPH_EDGE_WIDTH);
        gl.uniform1f(this.getUniform(this.edgeProgram, "u_width"), state.options.linkWidth);
        gl.uniform1f(this.getUniform(this.edgeProgram, "u_opacity"),
            getGraphEdgeOpacity(state.options.lineOpacity, false));
        gl.uniform1f(this.getUniform(this.edgeProgram, "u_highlight_opacity"),
            getGraphEdgeOpacity(state.options.lineOpacity, true));
        gl.uniform4fv(this.getUniform(this.edgeProgram, "u_highlight"), this.highlightLine);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.data.links.length);
    }

    private drawArrows(state: IGraphRenderState) {
        if (this.arrowIndices.length === 0 || state.camera.scale < 0.08) {
            return;
        }
        const gl = this.gl;
        gl.useProgram(this.arrowProgram);
        gl.bindVertexArray(this.arrowVao);
        this.setViewUniforms(this.arrowProgram, state);
        gl.uniform1f(this.getUniform(this.arrowProgram, "u_arrow_length"),
            getGraphArrowLength(state.options.linkWidth, state.camera.scale));
        gl.uniform1f(this.getUniform(this.arrowProgram, "u_opacity"),
            getGraphEdgeOpacity(state.options.lineOpacity, false));
        gl.uniform1f(this.getUniform(this.arrowProgram, "u_highlight_opacity"),
            getGraphEdgeOpacity(state.options.lineOpacity, true));
        gl.uniform4fv(this.getUniform(this.arrowProgram, "u_highlight"), this.highlightLine);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, this.arrowIndices.length);
    }

    private configureVertexArrays() {
        const gl = this.gl;
        const nodeCorners = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
        const edgeCorners = new Float32Array([0, -1, 1, -1, 0, 1, 0, 1, 1, -1, 1, 1]);
        const arrowCorners = new Float32Array([0, 0, -1, -0.6, -1, 0.6]);
        gl.bindVertexArray(this.nodeVao);
        this.configureAttribute(0, this.createStaticBuffer(nodeCorners), 2, 0, 0);
        this.configureAttribute(1, this.nodePositionBuffer, 2, 0, 1);
        this.configureAttribute(2, this.nodeSizeBuffer, 1, 0, 1);
        this.configureAttribute(3, this.nodeColorBuffer, 4, 0, 1);
        this.configureAttribute(4, this.nodeStateBuffer, 1, 0, 1);
        gl.bindVertexArray(this.edgeVao);
        this.configureAttribute(0, this.createStaticBuffer(edgeCorners), 2, 0, 0);
        this.configureAttribute(1, this.edgeEndpointBuffer, 2, 16, 1, 0);
        this.configureAttribute(2, this.edgeEndpointBuffer, 2, 16, 1, 8);
        this.configureAttribute(3, this.edgeColorBuffer, 4, 0, 1);
        this.configureAttribute(4, this.edgeStateBuffer, 1, 0, 1);
        this.configureAttribute(5, this.edgeReferenceBuffer, 1, 0, 1);
        this.configureAttribute(6, this.edgeTargetSizeBuffer, 1, 0, 1);
        gl.bindVertexArray(this.arrowVao);
        this.configureAttribute(0, this.createStaticBuffer(arrowCorners), 2, 0, 0);
        this.configureAttribute(1, this.arrowEndpointBuffer, 2, 16, 1, 0);
        this.configureAttribute(2, this.arrowEndpointBuffer, 2, 16, 1, 8);
        this.configureAttribute(3, this.arrowSizeBuffer, 1, 0, 1);
        this.configureAttribute(4, this.arrowColorBuffer, 4, 0, 1);
        this.configureAttribute(5, this.arrowStateBuffer, 1, 0, 1);
        gl.bindVertexArray(null);
    }

    private configureAttribute(location: number, buffer: WebGLBuffer, size: number, stride: number, divisor: number, offset = 0) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
        gl.vertexAttribDivisor(location, divisor);
    }

    private createStaticBuffer(data: Float32Array) {
        const buffer = this.createBuffer();
        this.upload(buffer, data, this.gl.STATIC_DRAW);
        return buffer;
    }

    private createBuffer() {
        const buffer = this.requireValue(this.gl.createBuffer());
        this.buffers.push(buffer);
        return buffer;
    }

    private upload(buffer: WebGLBuffer, data: BufferSource, usage: number) {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, data, usage);
    }

    private setViewUniforms(program: WebGLProgram, state: IGraphRenderState) {
        this.gl.uniform2f(this.getUniform(program, "u_viewport"), state.width, state.height);
        this.gl.uniform3f(this.getUniform(program, "u_camera"), state.camera.x, state.camera.y, state.camera.scale);
    }

    private createProgram(vertexSource: string, fragmentSource: string) {
        const gl = this.gl;
        const program = this.requireValue(gl.createProgram());
        const vertex = this.createShader(gl.VERTEX_SHADER, vertexSource);
        const fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(program) || "Unable to link graph shader";
            gl.deleteProgram(program);
            throw new Error(message);
        }
        return program;
    }

    private createShader(type: number, source: string) {
        const gl = this.gl;
        const shader = this.requireValue(gl.createShader(type));
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader) || "Unable to compile graph shader";
            gl.deleteShader(shader);
            throw new Error(message);
        }
        return shader;
    }

    private getUniform(program: WebGLProgram, name: string) {
        return this.requireValue(this.gl.getUniformLocation(program, name));
    }

    private requireValue<T>(value: T | null): T {
        if (value === null) {
            throw new Error("Unable to allocate graph rendering resource");
        }
        return value;
    }
}
