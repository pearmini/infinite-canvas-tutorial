import * as d3 from 'd3-color';
import {
  type Device,
  type RenderPass,
  Bindings,
  Buffer,
  BufferFrequencyHint,
  BufferUsage,
  BlendMode,
  BlendFactor,
  ChannelWriteMask,
  Format,
  InputLayout,
  Program,
  RenderPipeline,
  VertexStepMode,
} from '@antv/g-device-api';
import { Shape, ShapeAttributes, isFillOrStrokeAffected } from './Shape';
import { vert, frag } from '../shaders/sdf';
import { distanceBetweenPoints, paddingMat3 } from '../utils';

export interface CircleAttributes extends ShapeAttributes {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export class Circle extends Shape {
  #cx: number;
  #cy: number;
  #r: number;
  #fill: string;
  #fillRGB: d3.RGBColor;
  #stroke: string;
  #strokeRGB: d3.RGBColor;
  #strokeWidth: number;

  #program: Program;
  #fragUnitBuffer: Buffer;
  #instancedBuffer: Buffer;
  #indexBuffer: Buffer;
  #uniformBuffer: Buffer;
  #pipeline: RenderPipeline;
  #inputLayout: InputLayout;
  #bindings: Bindings;

  constructor(config: Partial<CircleAttributes> = {}) {
    super(config);

    const { cx, cy, r, fill, stroke, strokeWidth } = config;

    this.cx = cx ?? 0;
    this.cy = cy ?? 0;
    this.r = r ?? 0;
    this.fill = fill ?? 'black';
    this.stroke = stroke ?? 'black';
    this.strokeWidth = strokeWidth ?? 0;
  }

  get cx() {
    return this.#cx;
  }

  set cx(cx: number) {
    if (this.#cx !== cx) {
      this.#cx = cx;
      this.renderDirtyFlag = true;
    }
  }

  get cy() {
    return this.#cy;
  }

  set cy(cy: number) {
    if (this.#cy !== cy) {
      this.#cy = cy;
      this.renderDirtyFlag = true;
    }
  }

  get r() {
    return this.#r;
  }

  set r(r: number) {
    if (this.#r !== r) {
      this.#r = r;
      this.renderDirtyFlag = true;
    }
  }

  get fill() {
    return this.#fill;
  }

  set fill(fill: string) {
    if (this.#fill !== fill) {
      this.#fill = fill;
      this.#fillRGB = d3.rgb(fill);
      this.renderDirtyFlag = true;
    }
  }

  get stroke() {
    return this.#stroke;
  }

  set stroke(stroke: string) {
    if (this.#stroke !== stroke) {
      this.#stroke = stroke;
      this.#strokeRGB = d3.rgb(stroke);
      this.renderDirtyFlag = true;
    }
  }

  get strokeWidth() {
    return this.#strokeWidth;
  }

  set strokeWidth(strokeWidth: number) {
    if (this.#strokeWidth !== strokeWidth) {
      this.#strokeWidth = strokeWidth;
      this.renderDirtyFlag = true;
    }
  }

  render(device: Device, renderPass: RenderPass, uniformBuffer: Buffer) {
    if (!this.#program) {
      this.#program = device.createProgram({
        vertex: {
          glsl: vert,
        },
        fragment: {
          glsl: frag,
        },
      });

      this.#uniformBuffer = device.createBuffer({
        viewOrSize: Float32Array.BYTES_PER_ELEMENT * 16, // mat4
        usage: BufferUsage.UNIFORM,
        hint: BufferFrequencyHint.DYNAMIC,
      });
      this.#instancedBuffer = device.createBuffer({
        viewOrSize: Float32Array.BYTES_PER_ELEMENT * 8,
        usage: BufferUsage.VERTEX,
        hint: BufferFrequencyHint.DYNAMIC,
      });
      this.#fragUnitBuffer = device.createBuffer({
        viewOrSize: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
        usage: BufferUsage.VERTEX,
        hint: BufferFrequencyHint.STATIC,
      });
      this.#indexBuffer = device.createBuffer({
        viewOrSize: new Uint32Array([0, 1, 2, 0, 2, 3]),
        usage: BufferUsage.INDEX,
        hint: BufferFrequencyHint.STATIC,
      });

      this.#inputLayout = device.createInputLayout({
        vertexBufferDescriptors: [
          {
            arrayStride: 4 * 2,
            stepMode: VertexStepMode.VERTEX,
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: Format.F32_RG,
              },
            ],
          },
          {
            arrayStride: 4 * 8,
            stepMode: VertexStepMode.INSTANCE,
            attributes: [
              {
                shaderLocation: 1,
                offset: 0,
                format: Format.F32_RG,
              },
              {
                shaderLocation: 2,
                offset: 4 * 2,
                format: Format.F32_RG,
              },
              {
                shaderLocation: 3,
                offset: 4 * 4,
                format: Format.F32_RGBA,
              },
            ],
          },
        ],
        indexBufferFormat: Format.U32_R,
        program: this.#program,
      });

      this.#pipeline = device.createRenderPipeline({
        inputLayout: this.#inputLayout,
        program: this.#program,
        colorAttachmentFormats: [Format.U8_RGBA_RT],
        megaStateDescriptor: {
          attachmentsState: [
            {
              channelWriteMask: ChannelWriteMask.ALL,
              rgbBlendState: {
                blendMode: BlendMode.ADD,
                blendSrcFactor: BlendFactor.SRC_ALPHA,
                blendDstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA,
              },
              alphaBlendState: {
                blendMode: BlendMode.ADD,
                blendSrcFactor: BlendFactor.ONE,
                blendDstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA,
              },
            },
          ],
        },
      });

      this.#bindings = device.createBindings({
        pipeline: this.#pipeline,
        uniformBufferBindings: [
          {
            buffer: uniformBuffer,
          },
          {
            buffer: this.#uniformBuffer,
          },
        ],
      });
    }

    this.#uniformBuffer.setSubData(
      0,
      new Uint8Array(
        new Float32Array(paddingMat3(this.worldTransform.toArray(true))).buffer,
      ),
    );

    if (this.renderDirtyFlag) {
      this.#instancedBuffer.setSubData(
        0,
        new Uint8Array(
          new Float32Array([
            this.#cx,
            this.#cy,
            this.#r,
            this.#r,
            this.#fillRGB.r,
            this.#fillRGB.g,
            this.#fillRGB.b,
            this.#fillRGB.opacity,
          ]).buffer,
        ),
      );
    }

    renderPass.setPipeline(this.#pipeline);
    renderPass.setVertexInput(
      this.#inputLayout,
      [
        {
          buffer: this.#fragUnitBuffer,
        },
        {
          buffer: this.#instancedBuffer,
        },
      ],
      {
        buffer: this.#indexBuffer,
      },
    );
    renderPass.setBindings(this.#bindings);
    renderPass.drawIndexed(6, 1);

    this.renderDirtyFlag = false;
  }

  destroy(): void {
    this.#program.destroy();
    this.#instancedBuffer.destroy();
    this.#fragUnitBuffer.destroy();
    this.#indexBuffer.destroy();
    this.#pipeline.destroy();
    this.#inputLayout.destroy();
    this.#bindings.destroy();
  }

  containsPoint(x: number, y: number) {
    const halfLineWidth = this.#strokeWidth / 2;
    const absDistance = distanceBetweenPoints(this.#cx, this.#cy, x, y);

    const [hasFill, hasStroke] = isFillOrStrokeAffected(
      this.pointerEvents,
      this.#fill,
      this.#stroke,
    );
    if (hasFill) {
      return absDistance <= this.#r;
    }
    if (hasStroke) {
      return (
        absDistance >= this.#r - halfLineWidth &&
        absDistance <= this.#r + halfLineWidth
      );
    }
    return false;
  }
}
