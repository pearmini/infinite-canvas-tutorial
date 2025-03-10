import type { IPointData } from '@pixi/math';
import { Camera } from './Camera';
import {
  type InteractivePointerEvent,
  type PluginContext,
  Renderer,
  CameraControl,
  DOMEventListener,
  Event,
  Picker,
  CheckboardStyle,
  Dragndrop,
} from './plugins';
import { Group, type Shape } from './shapes';
import {
  AsyncParallelHook,
  SyncHook,
  SyncWaterfallHook,
  getGlobalThis,
  traverse,
} from './utils';
import { vec2 } from 'gl-matrix';

export interface CanvasConfig {
  canvas: HTMLCanvasElement;
  renderer?: 'webgl' | 'webgpu';
  shaderCompilerPath?: string;
  devicePixelRatio?: number;
}

export enum CanvasMode {
  SELECT,
  HAND,
}

export class Canvas {
  #instancePromise: Promise<this>;

  #pluginContext: PluginContext;

  #rendererPlugin: Renderer;
  #eventPlugin: Event;

  #root = new Group();
  get root() {
    return this.#root;
  }

  #camera: Camera;
  get camera() {
    return this.#camera;
  }

  constructor(config: CanvasConfig) {
    const {
      canvas,
      renderer = 'webgl',
      shaderCompilerPath = '',
      devicePixelRatio,
    } = config;
    const globalThis = getGlobalThis();
    const dpr = devicePixelRatio ?? globalThis.devicePixelRatio;
    const supportsPointerEvents = !!globalThis.PointerEvent;
    const supportsTouchEvents = 'ontouchstart' in globalThis;

    const { width, height } = canvas;
    const camera = new Camera(width / dpr, height / dpr);
    this.#camera = camera;

    this.#pluginContext = {
      globalThis,
      canvas,
      renderer,
      shaderCompilerPath,
      devicePixelRatio: dpr,
      supportsPointerEvents,
      supportsTouchEvents,
      hooks: {
        init: new SyncHook<[]>(),
        initAsync: new AsyncParallelHook<[]>(),
        beginFrame: new SyncHook<[]>(),
        render: new SyncHook<[Shape]>(),
        endFrame: new SyncHook<[]>(),
        destroy: new SyncHook<[]>(),
        resize: new SyncHook<[number, number]>(),
        pointerDown: new SyncHook<[InteractivePointerEvent]>(),
        pointerUp: new SyncHook<[InteractivePointerEvent]>(),
        pointerMove: new SyncHook<[InteractivePointerEvent]>(),
        pointerOut: new SyncHook<[InteractivePointerEvent]>(),
        pointerOver: new SyncHook<[InteractivePointerEvent]>(),
        pointerWheel: new SyncHook<[InteractivePointerEvent]>(),
        pointerCancel: new SyncHook<[InteractivePointerEvent]>(),
        pickSync: new SyncWaterfallHook(),
      },
      camera,
      root: this.#root,
      api: {
        elementsFromPoint: this.elementsFromPoint.bind(this),
        elementFromPoint: this.elementFromPoint.bind(this),
        client2Viewport: this.client2Viewport.bind(this),
        viewport2Canvas: this.viewport2Canvas.bind(this),
        viewport2Client: this.viewport2Client.bind(this),
        canvas2Viewport: this.canvas2Viewport.bind(this),
      },
    };

    this.#rendererPlugin = new Renderer();
    this.#eventPlugin = new Event();
    const plugins = [
      new DOMEventListener(),
      this.#eventPlugin,
      new Picker(),
      new CameraControl(),
      this.#rendererPlugin,
      new Dragndrop({
        dragstartTimeThreshold: 100,
        dragstartDistanceThreshold: 10,
      }),
    ];

    this.#instancePromise = (async () => {
      const { hooks } = this.#pluginContext;
      plugins.forEach((plugin) => {
        plugin.apply(this.#pluginContext);
      });
      hooks.init.call();
      await hooks.initAsync.promise();
      return this;
    })();
  }

  get initialized() {
    return this.#instancePromise.then(() => this);
  }

  /**
   * Render to the canvas, usually called in a render/animate loop.
   * @example
   * const animate = () => {
      canvas.render();
      requestAnimationFrame(animate);
    };
    animate();
   */
  render() {
    const { hooks } = this.#pluginContext;
    hooks.beginFrame.call();
    traverse(this.#root, (child) => {
      hooks.render.call(child);
    });
    hooks.endFrame.call();
  }

  resize(width: number, height: number) {
    const { hooks } = this.#pluginContext;
    this.#camera.projection(width, height);
    hooks.resize.call(width, height);
  }

  /**
   * Destroy the canvas.
   */
  destroy() {
    const { hooks } = this.#pluginContext;
    traverse(this.#root, (child) => {
      child.destroy();
    });
    hooks.destroy.call();
  }

  appendChild(shape: Shape) {
    this.#root.appendChild(shape);
  }

  removeChild(shape: Shape) {
    this.#root.removeChild(shape);
  }

  setCheckboardStyle(style: CheckboardStyle) {
    this.#rendererPlugin.setCheckboardStyle(style);
  }

  /**
   * Do picking with API instead of triggering interactive events.
   *
   * @see https://developer.mozilla.org/zh-CN/docs/Web/API/Document/elementsFromPoint
   */
  elementsFromPoint(x: number, y: number): Shape[] {
    const { picked } = this.#pluginContext.hooks.pickSync.call({
      topmost: false,
      position: {
        x,
        y,
      },
      picked: [],
    });
    return picked;
  }

  /**
   * Do picking with API instead of triggering interactive events.
   *
   * @see https://developer.mozilla.org/zh-CN/docs/Web/API/Document/elementFromPoint
   */
  elementFromPoint(x: number, y: number): Shape {
    const { picked } = this.#pluginContext.hooks.pickSync.call({
      topmost: true,
      position: {
        x,
        y,
      },
      picked: [],
    });
    return picked[0];
  }

  client2Viewport({ x, y }: IPointData): IPointData {
    const { left, top } = this.#pluginContext.canvas.getBoundingClientRect();
    return { x: x - left, y: y - top };
  }

  viewport2Client({ x, y }: IPointData): IPointData {
    const { left, top } = this.#pluginContext.canvas.getBoundingClientRect();
    return { x: x + left, y: y + top };
  }

  canvas2Viewport({ x, y }: IPointData): IPointData {
    const { width, height, viewProjectionMatrix } = this.#camera;
    const clip = vec2.transformMat3(
      vec2.create(),
      [x, y],
      viewProjectionMatrix,
    );
    return {
      x: ((clip[0] + 1) / 2) * width,
      y: (1 - (clip[1] + 1) / 2) * height,
    };
  }

  viewport2Canvas({ x, y }: IPointData): IPointData {
    const { width, height, viewProjectionMatrixInv } = this.#camera;
    const canvas = vec2.transformMat3(
      vec2.create(),
      [(x / width) * 2 - 1, (1 - y / height) * 2 - 1],
      viewProjectionMatrixInv,
    );
    return { x: canvas[0], y: canvas[1] };
  }
}
