# Three.js 镜头 —— 第 3 种 3D：真网格

> 面向**写场景的人**。规格与实现见 `docs/ENGINE.md` §3.8；这里讲怎么用、什么时候用、哪里会静默出错。
> 标定夹具 `tasks/_three-calib`、沙盒 `tasks/_three-lab`、量具 `node tools/probe-three.mjs`。

---

## 1. 判据：到底要不要 Three.js

引擎现在有**三种** 3D（`docs/ENGINE.md` §3.7 / §3.8）。它们的边界很清楚：

| | 用什么 | 有什么 | 没有什么 | 什么时候用 |
|---|---|---|---|---|
| ① 解析投影 + 线段批 | `src/core/cam.js` + `ctx.lines` | 极低开销、与引擎线条语言完全一致 | 没有深度缓冲、没有遮挡、没有面 | 线框建筑、柱林、塔、示意图的立体感 |
| ② raymarch | `src/core/glsl3d.js` | 真深度/遮挡/软阴影/AO/雾，零依赖零素材 | 几何只能是数学式子 | 无限晶格、空腔、浮雕、地形 |
| ③ **真网格（Three.js）** | `src/core/three-bridge.js` + `src/kit/three.js` | 真深度缓冲、真遮挡、实例化、材质与光照、现成的 3D 生态 | **多一个依赖**（`three`） | 需要"很多个同样的东西"、需要材质/光照/阴影、或以后要导入 `.glb` |

**判据只有一条**：**你要的画面能不能用数学式子/线段写出来？**
能 → 用 ① 或 ②，别加依赖。不能（要实例化成百上千个单元、要 PBR 材质与光照、要导入模型）→ 才用 ③。

> 现在**还没有**模型导入（`.glb`/`.gltf`）：这一轮的几何全部是**程序化**的（`BoxGeometry` / `InstancedMesh` / …）。
> 要导入模型是下一步的事，`setup(ctx)` 本来就是异步的，到时候不用返工。

---

## 2. 最小例子

```js
// tasks/<任务>/scenes/cube.js
import { makeThreeShot } from '../../../src/kit/index.js';

export default makeThreeShot('cube', {
  camera: { fov: 34, pos: [4.4, 3.2, 5.6], target: [0, 0.8, 0] },   // 世界坐标 +y 向上、-z 朝屏幕里
  async setup(ctx, api) {
    const { THREE, scene, palette } = api;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial({ color: palette('graphite'), roughness: 0.6 }),
    );
    box.add(new THREE.LineSegments(               // 描边：制图感就靠它
      new THREE.EdgesGeometry(box.geometry),
      new THREE.LineBasicMaterial({ color: palette('bone', 0.8) }),
    ));
    box.position.y = 1;
    scene.add(box);
    scene.add(new THREE.HemisphereLight(palette('bone', 0.42), palette('ink'), 1.5));
    const key = new THREE.DirectionalLight(palette('bone', 2.2), 2.8);
    key.position.set(5.5, 9, 6);
    scene.add(key);
  },
  update(ctx, api) {
    // ⚠ 只许写 t 的纯函数（见 §6）。自转 = f.t 的函数，**不是** rotation.y += 0.01
    api.scene.children[0].rotation.y = ctx.f.t * 0.5;
  },
  overlay(ctx, api) {
    // 3D 之上叠引擎的矢量与文字（可选）
    ctx.text.clear();
    ctx.type.writeLine('写代码，就是做动画', 96, 118, { size: 52, weight: 800, color: ctx.P.css('bone') });
    ctx.text.upload();
    ctx.comp.draw(ctx.gl, ctx.text, ctx.out, { premult: false });
  },
  post: { bloom: 0.3, grain: 0.02 },
});
```

```sh
node scripts/anim.mjs check <任务>
node scripts/anim.mjs still <任务> -t 2
node scripts/anim.mjs video <任务>
```

`makeThreeShot` 与 `src/kit/shot.js` 的 `makeShot()` **同一个形状**，只是中间多了一层 3D。
它替你做掉九件事：建渲染器、每个子帧重渲、上传成引擎纹理、合成进 `ctx.out`、
声明 `handlesTransition`、交叠期把上一帧甩走、一台走完全片的摄影机、投影回屏幕坐标、释放资源。

**`bridge` 的三个开关**（`bridge: { … }`，同一套配置全片共享一个桥）：

| 开关 | 默认 | 作用 |
|---|---|---|
| `antialias` | **`true`** | 3D 画布开 MSAA。**别关** —— 关了之后实体边缘的锯齿只能靠后处理的多子帧掩盖，不划算（`tasks/_three-calib` 关它是为了标定测量） |
| `shadows` | `false` | 打开 `renderer.shadowMap`。开了之后还要照常给 `light.castShadow = true`、`mesh.castShadow = true` / `receiveShadow = true` —— **`AGENTS.md` 把"材质光照阴影"列为选 ③ 的理由，但不开这个开关就永远没有阴影** |
| `alpha` | `false` | `'over'` / `'add'` 合成模式**必须**开（见 §4） |

```js
export default makeThreeShot('room', {
  background: 'over',
  bridge: { alpha: true, shadows: true },     // ← 要真阴影就靠这一行
  camera: { fov: 34, pos: [5, 4, 6], target: [0, 1, 0] },
  // setup 里：light.castShadow = true；mesh.castShadow = mesh.receiveShadow = true
});
```

> 阴影很贵：**每个子帧都要渲一遍阴影图**，而成片是 8–216 个子帧。先用 `--samples 8` 量一段再全片开。

`overlay()` 除了画前景，**还可以 `return` 一个对象** —— 它会被并进这一帧的 post
（`makeShot` 是同一个约定）：`overlay(ctx, api) { …; return { bloom: 0.6, grain: 0 }; }`。
静态观感仍写在 `post:` 里，两者按帧合并。

---

## 3. 两个入口

| 想要 | 用什么 |
|---|---|
| 一个完整的 3D 镜头 | `makeThreeShot(id, { camera, setup, update, overlay, post })` |
| 只要那条链路（自己控制合成顺序、把 3D 当背景再手画前景、或做标定） | `loadThree()` + `getThreeBridge(ctx, THREE)`，然后 `bridge.render(scene, camera)` → `bridge.composite(ctx.gl, ctx.out, {...})` |

```js
import { loadThree, getThreeBridge } from '../../../src/core/three-bridge.js';

export default {
  id: 'raw',
  async setup(ctx) {
    const THREE = await loadThree();                 // 动态 import：不用它的任务不会被拖下水
    this.bridge = getThreeBridge(ctx, THREE, { alpha: true });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  },
  render(ctx) {
    this.bridge.render(this.scene, this.camera);
    this.bridge.composite(ctx.gl, ctx.out, { mode: 'over', t: ctx.f.t });
  },
};
```

---

## 4. 背景：`'cover'` / `'over'` / `'add'` —— 接缝的关键

这是**最重要**的一个选择（`makeThreeShot` 的 `background` 选项，或 `composite()` 的 `mode`）：

| mode | 做什么 | 背景连续性 | 记账 |
|---|---|---|---|
| `'cover'`（默认） | 3D **不透明铺满整帧** | 3D 自带背景；**要照着共享背景抄**（同 ink、同网格间距、同 accent） | `blend:false` ⇒ 记进 `paint.full`（背景守门天然通过） |
| `'over'` | 3D 用**透明画布浮在引擎画的背景上** | **背景是同一批像素**，切点两侧逐像素一致（推荐做"一镜到底"） | 不算整帧覆盖 ⇒ 见下面的要求 |
| `'add'` | 加法叠加（发光体、全息感） | 同上 | 同上 |

`'over'` 的两个硬要求：

1. 时间线上那一段要写 **`world: 'auto'`**（引擎先铺共享背景；`makeThreeShot` 也会在本段 render 里
   再铺一次 —— 因为引擎那一笔发生在**记账重置之前**，守门看不到它）。
2. `bridge` 要开 **`{ alpha: true }`**（画布才有透明通道）。

```js
export default makeThreeShot('stack', {
  background: 'over',
  bridge: { alpha: true },
  // …setup / update / overlay
});
```
```js
export const world = (ctx) => worldPass(ctx, { grid: 60, accent: ctx.P.signal });
// timeline: cut(stack, { dur: 6, world: 'auto' })
```

> **为什么推荐 `'over'`**：`src/core/trans.js` 的四条配方里第 ① 条是"全片只有一层背景"。
> 用 `'cover'` 时背景是"两个渲染器各画一遍长得差不多的网格"，切点两侧**不可能逐像素相同**；
> 用 `'over'` 时背景**就是同一批像素**，眼睛能抓住的只有前景在变。

**要更自由地合成**（自定义转场、给 3D 加减曝光）时不必被 `makeThreeShot` 限制：

```js
// ① 让 3D 吃到一点 HDR 余量 / 做淡入淡出：composite 支持 gain（线性增益）与 opacity
bridge.composite(ctx.gl, ctx.out, { mode: 'over', gain: 1.2, opacity: 1 - k });
// ② 或者直接拿裸纹理当图层叠（朝向与 Layer2D 一致，**不用翻**）
ctx.comp.draw(ctx.gl, bridge.tex, ctx.out, { mode: 'screen', opacity: 0.6 });
```

---

## 5. 颜色：两边是同一套线性光

引擎整条链都在**线性光**里跑（最后一步才编码 sRGB）。所以：

* **取色一律走 `api.palette('signal', 0.6)` / `api.color([r,g,b], mul)`** —— 给的是**线性**值；
* **不要**写 `new THREE.Color('#ff4d12')` —— 那是按 sRGB 解释的，画出来会偏亮一档；
* `renderer.outputColorSpace` 保持默认的 `SRGBColorSpace`、`toneMapping` 保持 `NoToneMapping`
  （曝光与调色由引擎的后处理链统一做，别调两次）。

已经量过：Three.js 画的线性 `(1,0,0)` / `(0,1,0)` / `(0,0,1)` / `0.5` 与引擎 `lines` 画的同一批值
**逐字节相同**（`node tools/probe-three.mjs`，Δ0–1）。

---

## 6. 铁律：确定性（`AGENTS.md` §4 一条都不能破）

Three.js **本身不是不确定的** —— 只要你也这么写。把"用了 Three.js"当成破例的理由是最贵的错误。

| 禁止 | 为什么 | 怎么写 |
|---|---|---|
| `Math.random()` | 一帧会被拆成 8–216 个子帧乱序渲染 | `ctx.rng(seed)` 在 `setup` 里预计算（`tasks/_three-lab/scenes/lattice.js` 就是样本） |
| **`rotation.y += 0.01`** 之类的累积 | 子帧乱序、可任意 seek，累积值没有意义 | 写成 `t` 的函数：`rotation.y = f.t * 0.4` |
| `Date.now()` / `performance.now()` / `THREE.Clock` | 时间只能来自 `f.t` | 用 `ctx.f.t` / `ctx.f.lt` |
| 按帧抖动用 `Math.floor(t*60)` | 一帧内所有子帧会取到不同值（双重曝光） | 用 `f.idx` |

`update(ctx, api)` 的第二个参数就是"摆位"的地方：相机用 `api.setCamera({ pos, target, fov, roll })`
（`roll` = **荷兰角**，弧度，内部用 `camera.up` 实现 —— 不要去转整个场景，那会破坏世界坐标约定与别的段的对齐），
物体直接改 `mesh.position/rotation/scale`。**每次调用都当它是第一次**。

---

## 7. 投影：把标签贴在 3D 物体上

`api.project(x, y, z)` 把世界点换成**引擎的逻辑像素**（原点左上、y 向下），
返回 `{ x, y, z, visible }`。于是引擎画的引线/标签/准星能跟着 3D 物体走：

```js
overlay(ctx, api) {
  const { lines, text, type, comp, P } = ctx;
  const p = api.project(1.2, 0.6, 0.8);
  if (!p.visible) return;                    // ⚠ 相机身后/出画的点投影出来是"鬼影"，必须判掉
  lines.begin();
  lines.circle(p.x, p.y, 5, 2.5, P.signal);
  lines.seg(p.x, p.y, 1480, 260, 1.8, P.signal);
  lines.flush(ctx.out);
  text.clear();
  type.writeLine('贴在 3D 上的标签', 1500, 254, { size: 34, weight: 700, color: ctx.P.css('bone') });
  text.upload();
  comp.draw(ctx.gl, text, ctx.out, { premult: false });
}
```

**投影公式与 `src/core/cam.js` 完全一致**（都是 `x_px = (x_view / -z_view)·focal + W/2`，
`focal = (H/2)/tan(fov/2)`）。这件事的用处不只是贴标签：**过渡镜头可以完全用引擎画，
却落在 Three.js 实体的同一个像素位置上** —— `tasks/_three-lab` 的 B 段就是这么做的
（同一个世界原点、同一台 `camAt(t)`、同一个 fov ⇒ 线框盒子与前后两段的实体逐像素对齐）。

---

## 8. 记账与验收

* **背景守门**：`check` 会问"这一段铺了整帧背景没有"。`'cover'` 天然通过；
  `'over'`/`'add'` 必须靠 `world: 'auto'`（见 §4），否则会点名。
* **运动模糊**：一帧被拆成 8/24/72/216 个子帧 ⇒ Three.js **每个子帧都重渲一遍**。
  离线渲染下这是真运动模糊，不是浪费；嫌慢用 `--samples 1`（出图）或 `--samples 8`（把自适应**固定**成 8）。
  ⚠ 成片的默认是 `--samples auto`（静止 8 → 甩镜/砸字自己加到 72 或 216），不是 8。
* 出片前：

```sh
node scripts/anim.mjs check <任务>
node scripts/anim.mjs still <任务> -t 1,4,7        # 出图，**必须用 Read 看图**
node scripts/anim.mjs still <任务> -t 2 --only cube # ⚠ 带 --only 时 -t / --from 是**段内**秒数，不是整片秒数
node scripts/anim.mjs determinism <任务> --from 0 --frames 40
node scripts/anim.mjs video <任务>
node scripts/anim.mjs verify <任务>
node tools/probe-three.mjs                          # 桥本身的量具（颜色/朝向/线性 alpha）
```

---

## 9. 坑清单（全都不报错，只能靠量具或看图）

| 症状 | 真正的原因 |
|---|---|
| 半透明的 3D 比预期暗一档 | 画布给的是**在 sRGB 编码空间里预乘过 alpha** 的 RGB。桥已经处理（先反预乘、再解码），但你若自己 `texImage2D` 上传，会踩到 |
| 3D 上下颠倒 | 画布第 0 行是画面顶部、引擎全屏 Pass 的 `vUv.y=1` 才是顶部 —— 桥的 `flipY` 就是干这个的。自己写合成 Pass 时要翻 |
| 半透明明暗不对 | 预乘/直通弄反了（`{ alpha: true }` 必须配 `premultipliedAlpha: false`） |
| 标签跑到"相机身后"去了 | `api.project()` 的 `visible` 没判 |
| `check` 点名"这一段没铺整帧背景" | 用了 `'over'` 但时间线上没写 `world: 'auto'` |
| 整批实例化网格凭空消失 | `InstancedMesh` 的包围球没跟上 ⇒ `mesh.frustumCulled = false` |
| 预览里很流畅、出片很慢 | 正常：成片每个子帧都重渲一次 3D。用 `--samples 8` 控制 |
| 页面刷新/推流断掉 | 渲染期间**一个文件都别写**（`AGENTS.md` §7）；改完 `vite.config.mjs` 的 `optimizeDeps` 之后尤其要重启私有服务 |

---

## 10. 现成的样本

| 看什么 | 在哪 |
|---|---|
| 颜色/朝向/线性 alpha 的标定夹具（四个象限 + 半透明叠加） | `tasks/_three-calib`（判据：`node tools/probe-three.mjs`） |
| 一个完整沙盒：Three.js 分层实体 → **引擎自绘的过渡镜头** → 实例化晶格 | `tasks/_three-lab`（`scenes/_stage.js` 是"三段共用一个舞台"的写法） |
| 桥的实现与每一处注释 | `src/core/three-bridge.js` |
| 镜头骨架 `makeThreeShot` | `src/kit/three.js` |
