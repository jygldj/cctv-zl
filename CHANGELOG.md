# 更新日志

## v4.5.43 (2026-09-17) - 取消 WebView 自带的视频默认海报（片库/栏目起播前那个播放按钮）

### 一、现象

央视片库 / 央视栏目是 m3u8 直连、纯本地页，起播前画面中央会先出现
**一个灰底大播放图标，约 1~2 秒后消失**。截图（1280×720）：

- 左右两侧是页面底色 `#0a1f3a`；
- 中间一块**正方形**灰块 `#888888`，宽 720 = 屏幕高 720，水平居中；
- 灰块正中一个黑色圆环 + 实心三角的播放图标，直径约 573px。

### 二、排查：先把「不是谁」排除掉

| 假设 | 验证方式 | 结论 |
|---|---|---|
| xgplayer 的 `xgplayer-start` 起播按钮 | 读 `js/xg/index.min.css` + `2.31.2/index.min.js` | ✘ 该图标是 70px 纯三角（SVG path 无圆环），且被 `.xgplayer-playing` 隐藏 |
| xgplayer 的 `xgplayer-poster` | 同上 | ✘ 2.31.2 只在 `config.poster` 有值时才创建该节点；live.js 未配置 |
| 某个我方 CSS 画的灰块 | 全量检索 `#888 / 888888 / rgb(136,136,136) / 53%` | ✘ 项目自身样式里**一条都没有** |
| 原生 `loadingOverlay` | 读 `activity_main.xml` | ✘ 那是黑底全屏，不是灰块 |
| Chromium 原生媒体控件 | **对照实验**（Chromium 121 内核，1280×720 截图 + 逐像素比对） | ✔ 命中 |

对照实验（三份最小页面，同一个假 m3u8）：

| 页面 | 结果 |
|---|---|
| `<video autoplay playsinline>`（无 `controls`） | 纯底色，**什么都没有** |
| 同上 + `controls` | 出现灰色方块 + 大播放图标（仅色值随主题不同） |
| 同上 + `controls` + 1×1 透明 `poster` | 灰底消失，**图标仍在** |

再用 `--dump-dom` 抓真实 `live.html` 的 DOM，`<video>` 标签实际是：

```html
<video class="" autoplay="" tabindex="2" mediatype="video" src="blob:...">
```

**没有 `controls` 属性**——所以桌面 Chromium 复现不出灰块，而 Android WebView 能。

### 三、根因：Android WebView 的「默认视频海报」

Android WebView 在 `<video>` **没有 `poster` 属性**时，会向宿主索取一张默认海报：

```java
WebChromeClient.getDefaultVideoPoster()   // 系统默认返回「灰底 + 大播放图标」
```

WebView 把这张图当海报画在视频区域上，起播出画后自然被视频盖掉——就是那 1~2 秒。

两个细节正好对上截图：

1. 系统默认海报是**方图**，按 contain 缩放后宽=屏幕高 → 呈现为**居中正方形灰块**；
2. 它是浏览器层画的，**不在页面 DOM/CSS 里**，所以 xgplayer 侧怎么调都没用。

### 四、改法：把默认海报换成 1×1 透明位图

只改 `BaseWebViewActivity.java` 一个文件：

```java
/* 本地页视频的「默认海报」替换值。 */
private static final Bitmap TRANSPARENT_VIDEO_POSTER =
        Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);

@Override
public Bitmap getDefaultVideoPoster() {
    return TRANSPARENT_VIDEO_POSTER;
}
```

取消海报后，起播前露出的就是页面自身底色 `#0a1f3a`（和 5 个入口的深蓝一致，
不再有方块闪烁）。

### 五、影响面与安全边界

| 范围 | 是否受影响 |
|---|---|
| 首页 / 央视片库 / 央视栏目 / 支持我 / `live.html` | ✔ 由 `BaseWebViewActivity` 承载，默认海报取消 |
| 地方台站点页（`WebViewClientImpl type=0`） | ✔ 附带受益，同一 WebView，无功能损失（默认海报本就不可点） |
| **央视网（tv.cctv.com）、CCTV 直播（yangshipin.cn）** | ✘ **原样不动**：`LiveActivity extends BaseActivity`，自带一套 `WebChromeClient`，不继承本类 |

未动任何 JS / CSS / 取流逻辑：`live.js`、`xgplayer`、三文件（`LiveActivity.java`
`load_detail_tv.js` `load_detail_video.js`）指纹不变。

### 六、校验

`getDefaultVideoPoster` 覆写点 1 处、透明位图字段 1 处；
`BaseWebViewActivity.java` 圆括号 625/625 配平（花括号差额与 HEAD 一致，为字符串内 JS 花括号所致）。

> 备注：`impl/WebChromeClientImpl.java` 当前无任何引用（历史遗留），未在本版清理。

## v4.5.42 (2026-09-17) - 根因修复：计时器改为白名单式，只为「网页脱壳」存在

### 一、根因不是「漏了哪些页面」，而是逻辑写反了

v4.5.40 / v4.5.41 都是在 **`onPageLoadStarted` 外面加一层拦截**（识别本地页 → 取消延时显示），
属于「先装了再拦下来」的补丁，机制本身还在。

真正的病根写在方法注释的原话里：

> 任何一次页面跳转都先安排遮罩。

**这句话就是错的。** 计时器存在的唯一理由是「网页脱壳等待期别让裸骨架露出来」，
那么它只该服务于 `isVideoPage(url)`（tv.cctv.com / yangshipin.cn）。
其余页面——首页、央视片库、央视栏目、支持我、本地播放页 live.html——
既不经站点渲染，自身又是深蓝底，**压根不该进入这套逻辑**。

### 二、改法：由「全部敷设 + 例外拦截」改回「白名单」

```java
protected void onPageLoadStarted(String url) {
    if (isVideoPage(url)) {          // ← 只有这里才安排遮罩
        ...会话起算 + 立刻盖...
        showLoadingOverlay();
        return;
    }
    /* 非脱壳页：不安排任何遮罩，会话状态复位。 */
    sessionActive = false;
    sessionStartAt = 0L;
    cctvStageCount = 0;
    loadingPrefix = "正在加载…";
    stopFsPoll();
}
```

随之把整套「延时显示」机制连根拔掉，不留死代码：

| 删除项 | 原作用 |
|---|---|
| `scheduleLoadingOverlay()` | 延后 260ms 才弹罩（根因所在的调度器） |
| `cancelPendingShow()` | 取消那个待弹的任务（含 4 处调用点） |
| `pendingShowRunnable` 字段 | 上面的 Runnable 本体 |
| `OVERLAY_SHOW_DELAY_MS = 260L` | 延时常量 |

保留 `OVERLAY_MIN_SHOW_MS`（420ms）——那是「显示后别一闪而过」的**收起**防抖，
与「要不要显示」无关，仍服务于脱壳场景。

另：`isLocalAssetPage()` 不再参与遮罩判定（默认就不安排了），保留作页面归属的自说明。

### 三、为什么不会出现「遮罩没人收」

- `onPageLoadFinished` 仍会走 `hideLoadingOverlay()` 正常收罩；
- `onProgressChanged(100)` 支路：`!sessionActive` 时才收，本地页会话已复位，
  且 `overlayShownAt <= 0` 时会安全返回，不会有多余动作；
- JS 桥接 `showLoading` 扫描后**已无任何 JS 调用方**（仅 `load_detail_tv.js` 用
  `hideLoading` 通知脱壳完成），保留作显式通道，不会产生自发弹罩。

### 四、影响面

- 只改 `BaseWebViewActivity.java` 一个文件，净减约 30 行；
- **LiveActivity 完全不动**：它自己覆写 `onPageLoadStarted`，内部也没有
  `pendingShowRunnable / scheduleLoadingOverlay`（引用数 0），央视网链路不受影响；
- CCTV 直播（yangshipin.cn）在 MainActivity 内，走 `isVideoPage` 命中，**计时器照常**。

### 五、校验

全量 61 个 Java 文件剥离注释与字符串后精确配平：**全部 ✔**；
`cancelPendingShow / scheduleLoadingOverlay / pendingShowRunnable / OVERLAY_SHOW_DELAY_MS`
代码引用数 **0**（仅剩一条注释提及）。

> ⚠️ 后续若再做「整树对齐 gao」，务必保住本版：`assets` 侧的 BuildConfig.DEBUG、
> WebView 性能设置可以对齐，但 `onPageLoadStarted` 的白名单结构属于本项目自有修正，
> 别被 gao 的旧逻辑冲掉。

## v4.5.41 (2026-09-17) - 取消遮罩范围补全：从「播放页」扩到「所有本地资产页」

### 一、v4.5.40 实测反馈：只做了一半

老王装包后反馈：

> 首页点击「央视片库」——计时器 **0.4-0.6 秒**进入电视剧列表。
> 桌面启动「道玄电视」**随机**出现计时器（进入首页前），但不是每次都出现。

两条都仍命中原生遮罩。

### 二、时长对上了：就是那个 260ms + 420ms

```
OVERLAY_SHOW_DELAY_MS = 260L   // 延迟多久才弹
OVERLAY_MIN_SHOW_MS   = 420L   // 一旦弹出至少停留多久
```

260 + 420 = **680ms**，与实测的 0.4~0.6 秒吻合。

「随机出现」也解释得通：首页 `index.html` 的加载耗时在 260ms 这条线上下浮动，
有时没到 260ms 就加载完了（`onPageLoadFinished` 抢先 `cancelPendingShow`），
有时超了就被 260ms 后的定时器弹出来。

### 三、漏在哪：v4.5.40 只拦了 live.html

上一版判据是 `tv-web && live.html`，只覆盖**播放页**。而 `cctv.html`（片库列表）、
`column.html`（栏目列表）、`index.html`（首页）都是本地页，一样走
「本地页」分支 → `scheduleLoadingOverlay()` → 260ms 后弹罩，全部漏掉。

### 四、改法：判据放宽到本地资产页

```java
private static boolean isLocalAssetPage(String url) {
    if (url == null) { return false; }
    return url.contains("tv-web") || url.contains("live.html");
}
```

（`||` 而非 `&&`：`shouldInterceptRequest` 会把 `live.html` 的 URL 前缀规格化，
单看 `tv-web` 未必总在，留一条双保险。）

分支里的**会话复位必须一并前移**——这是本版最关键的一处：

```java
if (isLocalAssetPage(url)) {
    sessionActive = false;      // ← 原本写在 else 分支里
    sessionStartAt = 0L;
    cctvStageCount = 0;
    loadingPrefix = "正在加载…";
    cancelPendingShow();        // 只掐「尚未弹出」的
    stopFsPoll();
    return;
}
```

若不复位移到此处，`sessionActive` 会残留 `true`，下一次访问本地页时被误判成
「仍在脱壳会话中」，遮罩又会弹回来——改了等于没改。

仍保留 v4.5.40 的取舍：**只取消尚未弹出的罩**。地方台脱壳链跳 `live.html?url=` 时，
那层罩是从站点页带过来的、本就在显示，保持不动，由 `onPageLoadFinished` 正常收。

### 五、为什么不会白闪（取消遮罩的前提）

先确认过底色才敢取消：

| 页面 | 深色底来源 |
|---|---|
| `cctv.html` / `column.html` / `tv.html` | `css/rset.css` → `html,body{background:#0a1f3a}` |
| `index.html`（只引 my.css） | `css/my.css` 第 1 行 → `html,body{background:#0a1f3a}` |
| `dsm.html` | 内联 `background-color:#0a1f3a` |
| `live.html` | 内联 `#0a1f3a` |

四个栏目自身就是深蓝底，不存在「骨架裸露」。

### 六、影响面

- 仍只改 `BaseWebViewActivity.java` 一个文件；
- 央视网 / CCTV 直播走 `LiveActivity`，它**自己覆写了 `onPageLoadStarted`**（893 行），
  完全不受本次改动影响，那里该弹的罩照弹。

### 七、校验

剥离注释与字符串后精确配平：**净括号 0、最小深度 0 ✔**；旧方法名 `isLocalPlayerPage`
引用数 0，无残留。

## v4.5.40 (2026-09-17) - 央视片库 / 央视栏目：取消本地播放页的脱壳遮罩

### 一、诉求

片库、栏目都是「取到 m3u8 直接交给本地播放器」，全程不经过站点页面，没有骨架可遮，
起播前那层遮罩纯属多余，要求取消。

### 二、定位：遮罩不是页面造的，是原生弹的

先排除页面侧：`js/xg/live.js`（本地播放器，234 行）全文检索 `mask / loading / overlay / wait`
**零命中**，`live.html` 自身也没任何浮层元素。所以这层罩只可能来自原生。

原生侧 `BaseWebViewActivity` 的判定：

```java
private static boolean isVideoPage(String url) {
    return url.contains("tv.cctv.com") || url.contains("yangshipin.cn");
}
```

`live.html` **不是** video page，于是走「本地页」分支 → `scheduleLoadingOverlay()`
→ 260ms 后弹罩（带「正在加载…」计时文字）→ 直到 `onPageLoadFinished` 才收。
而 `live.html` 要先加载 xgplayer + hls.js（约 508KB），**遮罩得等播放器加载完才退**——
这就是那多出来的一段黑幕。

### 三、改法：只取消「尚未弹出」的罩（关键取舍）

新增判定方法：

```java
private static boolean isLocalPlayerPage(String url) {
    if (url == null) { return false; }
    return url.contains("tv-web") && url.contains("live.html");
}
```

在 `onPageLoadStarted` 开头拦截：

```java
if (isLocalPlayerPage(url)) {
    cancelPendingShow();   // 只掐掉「待弹出」的那个
    stopFsPoll();
    return;
}
```

**为什么不顺手把已显示的罩也 hide 掉**：`js/tv/common/detail.js:68` 表明地方台脱壳链
也会跳 `live.html?url=`。那条链的遮罩是**从站点页带过来、本就显示中**的，一刀切 hide
会让地方台在播放器就位前露出底色空档。用「只取消尚未弹出的」来区分：

| 场景 | 跳转前遮罩状态 | 结果 |
|---|---|---|
| 片库 / 栏目 → live.html | 未显示（本地页几十毫秒加载完） | **不再弹** ✓ |
| 地方台脱壳 → live.html | 显示中 | 保持，由 `onPageLoadFinished` 正常收 ✓ |

收罩路径未动：live.html 不是 video page，`onPageLoadFinished` 仍走 else → `hideLoadingOverlay()`，
已显示的罩照常收起，不存在「没人收」的风险。

### 四、影响面

- 只改 `app/src/main/java/com/daoxuan/cctv/BaseWebViewActivity.java` 一个文件（增 31 行）；
- `LiveActivity` 独立一套遮罩且未覆写 `onPageLoadStarted`，**央视网 / CCTV 直播零影响**
  （md5 对账：`LiveActivity.java`、`load_detail_tv.js`、`load_detail_video.js` 全部未变）；
- `live.html` 的 `html/body` 底色本就是 `#0a1f3a`，取消遮罩后不会白闪。

### 五、校验

剥离注释与字符串后精确配平：**净括号 0、最小深度 0 ✔**。

## v4.5.39 (2026-09-17) - 央视片库与央视网彻底分家：专属页面脚本 + 焦点悬空救援

### 一、背景：片库被央视网的共用文件拖累

整树对齐 gao（v4.5.38）后，`js/home.js` 同时被央视网 `tv.html` 与片库 `cctv.html` 加载，
其中片库专属的 `yearRange()` 在 gao 版中不存在，导致 `_data.initData()` 抛异常中断，
表现为「顶部导航栏在、节目列表空白」。根因是**两个业务共用一份页面脚本**。

### 二、画质结论修正（本版不动画质）

实测 `getHttpVideoInfo.do`（《父母爱情》第1集真实 guid）：
- 只有 `hls_url` 一个播放地址，**不存在** `hls_url_hd` / `_4k` 字段；
- `manifest` 内 4 个 URL 是同一清晰度的不同 CDN/加密通道，均带 `maxbr=2048`，不是多档；
- `video.chapters / chapters2 / 3 / 4` 是时长 300/180/120 秒的**分段标记**，其 `url` 全空，不是码率档。
- 故「取更高清晰度」在接口层面无字段可用；又因目标机顶盒可流畅播放 4K，
  **本版保持最高画质不动**：`maxbr=2048`、`_lockTopQuality()`、`capLevelToPlayerSize:false` 均未修改。

### 三、改动 1：片库独立页面脚本 `js/cctvideo/app.js`（新增）

由旧版 `js/home.js` 复制改造而来，`cctv.html` 改引它，**不再加载 `js/home.js`**。
央视网的 `js/home.js` / `js/cctv/home.js` / `tv.html` 三个文件 md5 与改动前逐字节一致，零影响。

遥控器行序按需求定为 **频道行 → 年代行 → 节目网格**，绑定关系：

| 元素 | 上键 | 下键 |
|---|---|---|
| 频道按钮 | —（顶行） | `tvId(currentYear,'#yr-')` 当前选中年代 |
| 年代按钮 | `tvId(currentChannel.tag,'#tv-')` 当前频道 | `moveDown(currentChannel.tag)` 即 `#tvd-{tag}:.tv-item` |
| 节目格子 / 上（下）一页 | `tvId(currentYear,'#yr-')` 落到年代行（方案 A） | 网格内 ±5，越界由 `next()` 沿 DOM 兜底到翻页按钮 |

- 删除空的 `filters` 行（该数组两版恒为空，从未渲染任何元素），
  并移除旧版 `:move-up="'#fi-0'"` 这个指向不存在元素的硬编码 —— 它正是遥控器按上键失效的隐患。
- 默认年代 `2025`，年代区间与分页逻辑沿用旧版 `cctvideo/home.js`（未改动）。

### 四、改动 2：`js/myfocus.js` 补回 `rescueFocus()`（悬空救援）

整树对齐后 `myfocus.js` 换成 gao 版，旧版专治「遥控器踩坑」的 `rescueFocus()` 丢失。
（`applyFocus` 与 MutationObserver 兜底两版都有，差异仅此一处。）

- 旧版：`getFocus()` 取不到时 → `rescueFocus()` 转移到当前可见频道的 上一页/下一页/首个节目；
- gao 版：`getFocus()` 取不到时 → 返回 `null`，焦点丢失，遥控器失灵。

**为什么正好卡住分页**：翻页时 `_assignPage` 重切片 → Vue 重渲染 → 旧「下一页」按钮被销毁重建，
`curFocusId` 指向的元素消失 → 旧版救援接管、焦点续接；当前版返回 null 落到 `down()` 默认逻辑、焦点乱跳。

修复方式保守：仅在**原有取焦点失败时**才介入，取到则完全不改变既有行为；
救援失败再回落原 `found(this.focusId)`。三方共用（央视网/片库/栏目）均受益。

### 五、校验

- `node --check`：`cctvideo/app.js`、`myfocus.js`、`cctvideo/home.js` 全部通过；
- 央视网基线 md5：`js/home.js`、`js/cctv/home.js`、`tv.html` 与改动前**完全一致**；
- `tv.html` 仍指向 `js/home.js`，未被波及；
- `_tvHtmlInit` 全局符号：由 `app.js` 定义、`cctvideo/home.js` 调用，一一对应无冲突。

### 六、待实测

1. 片库首屏是否出列表（重点：默认年代 2025-2026 数据量，若偏少需另议默认值）；
2. 翻页 / 切年代 / 切频道时遥控器焦点是否连续不丢失；
3. 回归央视网、CCTV 直播、央视栏目三个入口未被影响。

回滚：`F:\github-dx\_backup_cctv-zl_20260917_1630\`（含 myfocus.js、cctv.html、home.js）。

## v4.5.38 (2026-09-17) - 整树对齐 cctv-gao：Java 61 文件 + JS 注入链 15 脚本全量替换

> 背景：连日来在本地链路上叠加了 13 个版本的修补（v4.5.25~v4.5.37），问题越修越多，
> 而同源工程 **cctv-gao**（封版 v4.5.24，含 v4.5.25 流畅度优化）实测表现明显更好 ——
> 同一批地方台 gao 脱壳成功率高、出画面快 3~5 秒。故决定不再逐点修补，
> 改为**以 gao 为基线整树重建 zl 的播放链路**，只回补 zl 真正有价值的改动。
>
> 完整差异盘点见 `MIGRATION_TO_GAO.md`。

### 一、可行性依据（先证明能换，再动手）

| 检查项 | 结果 |
|---|---|
| X5/TBS 依赖 | 两工程**都无**，同为系统 WebView，内核基础一致 |
| Java 文件 | 61 个**路径完全一致**，其中 32 个内容本就相同 |
| `js/tv/` 站点目录 | 21 vs 21，**零差异**（推翻"站点脚本差异"的旧假设） |
| 资源引用 | gao Java 引用的 `R.xxx` 在 zl res 中**全部存在** |
| 按键桥接 | gao 也定义了 `keyCodeAllByCode` / `keyEventAll`，替换后不会编译失败 |

### 二、已替换

- **Java 层 61 个文件**整树替换为 gao 版
- **JS 注入链 15 个脚本**：`load_detail_tv.js`、`load_detail_video.js`、`end.js`、`common.js`、
  `home.js`、`myfocus.js`、`index.js`、`detailBase.js`、`cctvFullscreen.js`、`pageFsBtn.js`、
  `pageToastKill.js`、`cctv/detail.js`、`cctv/home.js`、`tv/common/detail.js`、`tv/ysptv/detail.js`

### 三、替换后自动获得的收益（这是本次的主要目的）

1. **release 包不再常开调试** —— zl 原为 `setWebContentsDebuggingEnabled(true)` 硬编码，
   gao 为 `BuildConfig.DEBUG`。**这是出画面慢 3~5 秒的实锤之一**
2. **WebView 性能设置补齐** —— gao 有 `setSupportMultipleWindows(false)` /
   `setOverScrollMode(OVER_SCROLL_NEVER)` / `setDefaultTextEncodingName("UTF-8")`，
   zl **一处都没有**
3. **模拟按键不再用 `Instrumentation`** —— gao 注释明确：原实现 `sendKeySync`
   因普通应用无 `INJECT_EVENTS` 权限会直接抛异常，已改掉；zl 仍在用旧实现
4. **地方台脱壳**：差异锁定在 `load_detail_tv.js` + `tv/common/detail.js`，一并解决

### 四、有意回补的 zl 改动（唯一一项）

`LiveActivity` 浮层 4 秒自清（`STALE_NAME_CLEAR_MS = 4000L`）：
进度停滞超过 4 秒未到 100 就收起频道名，防「频道名 X%」永久压在画面上。
gao 有 `setText("")` 但无定时自清，故保留 zl 这处兜底。

清单里原本还有 2 项待定，复查后**查明是误判，无需回补**：
- JS 弹窗：gao 同样有 `onJsAlert/onJsConfirm/onJsPrompt`，且 zl 那处 AlertDialog 是注释掉的死代码
- 权限回调：gao 也有，用的是 `PermissionUtil.REQUEST_EXTERNAL_STORAGE`

### 五、保持 zl 原版未动（已逐一验证）

`cctv.html`（片库，zl 版多一行深蓝背景）/ `column.html`（栏目）/ `dsm.html`（支持我，**gao 无此文件**）/
`js/cctv/tv.json`（频道更全）/ `js/xg/`（地方台 live.html 依赖）/ `js/cctvideo/`（片库栏目业务逻辑）
`AndroidManifest.xml` / `res/` / `applicationId`（仍为 `com.daoxuan.cctv`）

入口修正：`index.js` 第 5 入口由 gao 的 `kuxuan.html` 改回 `dsm.html`。

### 六、有意保留的"未挂载"

`js/pageTidy.js`（v4.5.37 顶部遮罩清理器）**文件保留，但不挂到加载链上** ——
先得到一份纯净的 gao 行为作为对比基准；且该脚本实测"效果不明显"。
需要时只需在两处链尾补挂载点即可恢复。

### 七、校验与回滚

- 物理备份：`F:\github-dx\_backup_cctv-zl_20260917_1438\`（171 文件 / 3.9M，含未提交改动）
- Java 61 文件括号配平 ✅ / JS 15 脚本 `node --check` ✅
- 片库兼容：gao 版提供的全局符号完整覆盖 zl 原版，**零丢失**

### 八、实测重点

1. 各省地方台脱壳率是否达到 gao 水平
2. 出画面速度（预期明显变快，因 release 关调试 + WebView 设置补齐）
3. **央视片库 / 央视栏目 / 支持我三个栏目的回归**（本次未动其业务逻辑，但共用库已换）
4. CCTV直播入口的顶部遮罩 —— 注意 gao 该入口**同样有此问题**，预计会原样带过来，需单独治

---

## v4.5.37 (2026-09-17) - 起播瞬间「顶部一条半透明遮罩」1~2 秒后整体退去（站点播放器控件条残留）

> **修订说明**：上一版 v4.5.36（未打包）在用户补充「似乎是整体退去，而非自下而上」后，
> 自查发现三处实质漏洞，已整体重写，v4.5.36 作废：
> 1. **只看 fixed/sticky** → 播放器控件几乎全是 `absolute`，几乎必漏；
> 2. **只扫 body 两层** → 而央视17 之所以干净，靠的是 `cleanPage()` 的**全树扫描**；
> 3. **用 display:none** → 触发重排、可能打断站点 JS，改为 `visibility/opacity/pointer-events` + `transition:none`。
>
> 另新排除一项：原生 ActionBar 一度重新回到嫌疑名单（顶部一条、整体消失），
> 已确认 `BaseActivity` 里 `FEATURE_NO_TITLE` + `FLAG_FULLSCREEN` + `getActionBar().hide()`，
> 所有 Activity 均继承它 —— **排除**。

### 一、现象（道玄实测）

除**央视网入口 → 央视17（走 tv.cctv.com）**外，其余全部命中：
央视网入口的央视源2 / 卫视 / 各省地方台、CCTV直播入口（央视频）。
表现为「计数器走完 → 视频起播 → 屏幕**顶部一条**（约 15vh，正压在台标那一行）被**半透明**遮罩 →
约 1~2 秒后遮罩**整体退去**」——**只盖顶部一条**（不是整屏压暗）、**每次都有**。
（初判「自下而上收缩」，经复核修正为「整体退去」；这一条直接决定了它是 opacity 淡出而非高度动画。）

### 二、排除法：先证明不是「我们的页面脚本」干的

| 嫌疑 | 结论 | 依据 |
|---|---|---|
| 原生 `loadingOverlay` | ❌ 排除 | 全屏 `#000`，且只有 `animate().alpha(0).setDuration(300)` 一次淡出，**没有位移/高度动画**，做不出「自下而上退」 |
| 原生 `onShowCustomView` 容器 `binding.fullscreen` | ❌ 排除 | `match_parent` 全屏，且是 `#0A1F3A` 实色，不是「顶部一条」 |
| `.tv-notify`（`_layer.notify`） | ❌ 排除 | 不透明绿 / `#1a56db` + **6vh 白色大字**，且 `close()` 是秒删无退场动画；截图里那条是**纯净压暗、无任何文字** |
| `.tv-wait`（`_layer.wait`） | ❌ 排除 | `rgba(0,0,0,.5)` 但是 **100vw × 100vh 全屏**，不是一条 |
| `end.js` | ❌ 排除 | 只有 CSS 与加载器，`createDiv` 是注释掉的，不造任何浮层 |

**关键推论**：两条链（type=1 的 `load_detail_tv.js`、type=0 的 `load_detail_video.js`）
的公共交集只有 `end.js + my.css + zepto + common.js` —— 而这四者里**根本不存在**
「纯半透明、无文字、贴顶一条」的元素。所以这层东西**不是本工程造的**。

### 三、定性：是站点播放器自己的顶部工具栏

起播时浮现、两三秒后自动上滑隐藏 —— 这正是各视频站播放器顶部标题/工具栏的行为，
也同时解释了「每次都出现」「1~2 秒后**从下往上**退去」「只盖顶部一条」。

**为什么偏偏央视17 干净**：它走 `js/cctvFullscreen.js`，那里有一步 `cleanPage()`
把页面残留元素整片清掉（只留 video 与它的容器链），站点工具栏根本没机会显示。
另外那条链的 video z-index 是 `2147483647`，而其余链路的 `_tvFunc.fullscreen()`
只给到 `99990` —— 站点条完全可能压在视频之上。

### 四、修法：把 `cleanPage` 的思路通用化（新增 `js/pageTidy.js`）

新增一个独立小脚本，**只做一件事**：起播后把「站点残留的顶部横条」摘掉。
安全边界（宁可不生效，也不误伤）：

1. **全树扫描**（与 `cleanPage()` 一致），并用 `MutationObserver(childList, subtree)`
   收集后续新增节点 —— 播放器控件条常埋在 `body>div#app>div.player>div.bar` 这种深度；
2. 跳过 `script/style/iframe` 等非可视标签，以及 `html/body` 自身；
3. **绝不动** video 本身、含 video 的容器、以及 video 的整条祖先链（脱壳容器）；
4. 只摘同时满足：`position` 非 static（含 **absolute**）+ 上沿贴顶（≤6px）+
   高度 ≤35vh + 宽度 ≥半屏 —— 播放器本体、中央浮层、左侧菜单一律碰不到；
5. 白名单放行画质菜单 **和本工程自己的浮层**：`.bei-list-inner` / `*quality*` / `*rates*` /
   `*bitrate*` / `.tv-notify` / `.tv-text` / `.tv-wait` / `.notify-less` / `[id^="dxtv"]`。
   其中 `.tv-notify` 是 `absolute; top:0; width:100%; height:10vh+2vh≈14vh`，
   与实测遮罩高度几乎相同 —— **最容易被自己人误伤**，必须放行；
6. 隐藏方式用 `visibility:hidden + opacity:0 + pointer-events:none + transition:none`，
   元素留在文档流、站点 JS 照常跑，但视觉与交互同时失效；`transition:none` 掐掉淡出动画，
   不留渐隐尾巴。已摘元素若被站点 JS 改回可见，会**立刻再压回去**（仅盯这少数几个）；
7. 启动条件放宽到 `video.readyState>=2`（去掉 `currentTime>0.1`），起播瞬间即可命中；
   前 2 秒 **80ms 密扫**、之后 300ms 疏扫，每 6 轮做一次全树复扫，合计约 6.2 秒窗口后自动停，
   **不做常驻**（吸取 v4.5.30 的 `yspFullscreen` 90 秒常驻操作 DOM 被否的教训）；
8. 顺带把 video 的 z-index 顶到 `2147483647`（与央视17 那条已验证链一致），
   作为「站点条 z-index 更高」的第二道保险；
9. 命中时 `console.warn` 打印元素的 tag/class/id/尺寸/position ——
   万一实测仍有残留，抓 logcat 就能看到凶手真容，不用再猜。

挂载点（三条，全部放在链尾，不参与也不阻塞原有顺序加载）：

- `js/load_detail_tv.js` → `loadFromLocal()` 的 detail.js 回调内：`loadLocalJs("js/pageTidy.js")`
- `js/load_detail_tv.js` → `loadFromRemote()`：`_tvLoadRes.js(.../js/pageTidy.js?v=x)`
- `js/load_detail_video.js`：`_tvLoadRes.js(_browser.getURL("js/pageTidy.js?v=x"))`

> 已核对 `shouldInterceptRequest`：任意 `*/tv-web/*.js` 都会走 `FileUtil.readExtIn` 打到本地 assets；
> 本地链的 `_api.getJson` 对非 http 路径同样读 assets（`readExt("tv-web/"+url)`），新文件可取到。
> 三个脚本 `node --check` 全部通过。

### 五、约束复核

- 央视17（`tv.cctv.com`）链路**一字未动** —— 它本来就是干净的，也是本次的对照样本；
- 央视片库 `cctv.html` / 央视栏目 `column.html` **未动**；
- 单一变量、可整文件回滚：出问题只需删掉上面三个挂载点（或把 `js/pageTidy.js` 改名）即恢复原状。

### 六、待实测

重点看：央视网入口的央视源2 / 卫视 / 各省地方台，以及 CCTV直播入口，
起播后顶部那 1~2 秒的遮罩是否消失；同时回归确认脱壳率与切台未受影响。

---

## v4.5.35 (2026-09-17) - 战场清点：v4.5.34「早注入」已实测证伪，并定位到 3 处真实差异（待明日验证）

> 状态说明：**本节不含代码改动**。今晚 00:22 打的包用户实测「地方台依旧 90%+ 不脱壳」，
> 本轮改为**只做校验与清点**，把结论和明日第一步固定下来，避免再走盲改路线。

### 一、先决校验：用户实测的那个包，确实含 v4.5.34 的改动

不能拿"改了但没进包"当 excuse，所以先验包：

```
app/release/dxds.apk (2026-09-17 00:22) 校验结果
  assets/tv-web/js/tv/common/detail.js   md5 与源码一致（含 v4.5.33 标记、含 __DXTV_PAGE_FS__ 护栏）
  assets/tv-web/js/load_detail_tv.js     md5 与源码一致
  assets/tv-web/js/pageFsBtn.js / end.js / cctv/detail.js / myfocus.js   均一致
  classes.dex 命中 RESET_STALE_TVLOAD_JS   ← v4.5.34 的早注入自愈常量确实编译进去了
  classes.dex 命中 yangshipin.cn / onPageStarted
```

**结论：v4.5.34（恢复早注入 + RESET_STALE_TVLOAD_JS 自愈）已经真的进了用户手上的包，但仍然无效。**
→ **「早注入缺失」这一假设正式证伪**，v4.5.26 当初删掉它很可能是正确的，不是病根。
（校验脚本留存：`F:\WorkBuddy\2026-09-15-22-22-49\_handoff_20260917\verify_apk.py`）

### 二、清点结果：x5 与 gao 在「地方台链路」上的实质差异（已逐文件比对）

同一批站点 gao 成功、x5 失败，排除站点侧后，剩下的差异只有这几处：

**差异 A（最可疑）— `js/load_detail_tv.js` 的资源加载方式不同**

| | gao（90%+ 成功） | x5（90%+ 失败） |
|---|---|---|
| App 内加载 | **优先** `_tvLoadRes.js(domain + "/tv-web/js/xxx.js?v=r1")`，走**外链 `<script src>`**（经 `shouldInterceptRequest` 打到本地 assets，由浏览器保证**顺序执行**） | **只有** `_api.getJson` 读文本 → `script.textContent` **内联注入**，靠 onload 回调串顺序 |
| 兜底 | `_tvLoadRes` 不可用时才降级到 `_api.getJson` 内联 | 无外链路径，内联是唯一路径 |
| 版本号 | `?v=r1` | `?v=x` |

**差异 B（次可疑）— x5 缺 gao 的 `hideLoading` 收罩判定器**
gao 的 `load_detail_tv.js` 顶部有一段 28 行轮询：逐个遍历 `video`，要求
`readyState>=2` **且**占视口 35%+ **且** `!paused && currentTime>0.1`，才 `_apiX.msg('hideLoading','1')`。
注释写明这是为绕开推荐位/广告位的小 video 误判。**x5 完全没有这一段**，
原生遮罩拿不到"主视频真的在播"的信号。

**差异 C — `js/end.js` x5 比 gao 多约 1KB**（`loadCssCode` try-catch、`body||documentElement`、
host 判空三处 DOM 兜底，v4.5.26 加的）。这是纯加固，未见副作用，暂列观察项。

**差异 D（方向相反，注意）— Java 注入门禁**
`WebViewClientImpl.onPageFinished`：
- gao：**所有 type** 都要求 `mWebView.getProgress() == 100` 才注入；
- x5：自 v4.5.31 起 **type==1 主动解除门禁**（理由是进度常驻 60~90%）。

**差异 E — Java 早注入作用域**
gao：`type==1 && !url.contains("tv.cctv.com")`（**含 yangshipin**）；
x5 v4.5.34：`type==1 && !tv.cctv.com && !yangshipin.cn`（排除了 yangshipin）。

### 三、明日第一步（单一变量、可回滚）

1. **把 `assets/tv-web/js/load_detail_tv.js` 逐字节换成 gao 版本**
   （已留存：`F:\WorkBuddy\2026-09-15-22-22-49\_handoff_20260917\gao_baseline\load_detail_tv.js`，6717B）
   一次同时验证差异 A + B，**且该文件无任何 x5 独有功能**，可整文件替换、可整文件回滚。
2. 其余文件一律不动。Clean → Build → 装包实测地方台（浙江/广东/河南/山西）。
3. 若仍失败，第二步按差异 D 把 x5 的 type==1 免门禁改回 gao 的 `progress==100` 门禁单独再测。

### 四、若需抓证（logcat 过滤）

```
道玄电视    →  "[道玄电视] app env, load detail resources from local assets"
markFile    →  "detailPath:: tv/common"（应看到，说明走到了脱壳链）
道玄电视    →  "[道玄电视] detail.js injected: true path=tv/common"
道玄电视    →  "[道玄电视] waitForVideoElement 未取到 video"（出现则说明 video 没到位）
```

### 五、约束复核（本轮未破坏）

- 央视片库 `cctv.html` / 央视栏目 `column.html` **零改动**（APK 内 md5 与源码一致，已校验）。
- 工程内无残留临时文件；用户自行创建的 `_backup_android-x5_*` 三个备份目录**未动**。

---

## v4.5.34 (2026-09-17) - android-x5：各省地方台 90%+ 不脱壳——恢复被 v4.5.26 删掉的「早注入」

### 一、决定性实测事实（本轮方向的分水岭）

> **道玄实测：cctv-gao 各省地方台 90%+ 成功脱壳；android-x5 各省地方台 90%+ 不脱壳。**

同一批站点（浙江 cztv / 广东 gdtv / 河南 hntv / 山西 / 内蒙古 …）在 gao 上成功、在 x5 上失败 ——
这一条**直接否定了"站点侧问题"的全部假设**（SPA 无 video、播放器在 iframe、站点要登录、站点已改版）。
既然站点相同，差异**只能在本工程的代码里**。于是本轮不再猜站点结构，改为
**以 gao 为黄金基线，把 x5 地方台链路上的结构性差异全部找出来对齐**。

### 二、定位过程：先排除，再定位

| 排查项 | 结论 |
|---|---|
| `WebChromeClientImpl.java`（gao 2064B vs x5 3755B，差异比例最大） | ❌ 逐行 diff 后确认**全是注释展开**，`onShowCustomView` 两边都只有日志，**排除** |
| `window._api.getJson` 是否返回纯文本 | ✅ 走 `FileUtil.readExt(ctx,"tv-web/"+url)`，返回文件文本，**排除**（链路可达） |
| 站点 CSP 是否拦内联脚本 | 上一轮已验：仅 `frame-ancestors 'self'`，**排除** |
| 各 Activity 的 `WebSettings` 是否不同 | 上一轮已验：全在 `BaseActivity`，两者共用，**排除** |

**最后在 Java 层 gao↔x5 全量 diff 中找到唯一结构性差异**：

```java
// gao  onPageStarted（第 128-141 行）—— 早注入
if (type == 1 && !url.contains("tv.cctv.com")) {
    String earlyJs = getFileContent(url);
    view.evaluateJavascript(earlyJs, ...);
}
// x5：这段在 v4.5.26 被整段删除，只剩注释（本轮已恢复）
```

`type == 1` 即 LiveActivity（央视网入口），**各省地方台全部在此入口下**，
且条件 `!tv.cctv.com` 恰好把地方台**全部圈进早注入范围**。gao 地方台 90% 成功、x5 90% 失败，
与此强相关。

### 三、为什么 v4.5.26 会删它，以及为什么现在可以恢复

**删除时的理由（成立过）**：当时 x5 的 `js/end.js` 没有 DOM 兜底，
`onPageStarted` 时 `<head>` 刚解析、`<body>` 通常还不存在，`appendChild` 抛异常中断整段脚本，
而 `load_detail_tv.js` 的 `_tvload=true` 已落地（**假置位**）→
`onPageFinished` 的正常注入被闸门挡成空转 → yangshipin 整条链失效。

**现在前提已消失**：diff `js/end.js`（gao 2738B vs x5 3763B）确认
**x5 在 v4.5.26 当次已补齐 DOM 兜底**：

| 位置 | gao | x5（v4.5.26 后） |
|---|---|---|
| `loadCssCode()` | 直接 `head.appendChild` | try-catch + `head` 判空 |
| `createDiv()` | `document.body.appendChild` | `document.body \|\| document.documentElement` 判空 |
| `_tvLoadRes.js()` | 直接 appendChild | `host` 判空 |
| `_tvLoadRes.css()` | `document.head.appendChild` | `head` 判空 |

**即：x5 的 end.js 比 gao 更健壮，"早注入必抛异常"已不成立。**

**附带发现**：`RESET_STALE_TVLOAD_JS`（假置位自愈常量，**第 104 行定义**）
在此前版本中**定义了却从未被调用** —— 自愈环节一直是断的。本轮将其接入。

### 四、改动（2 处，均在 `WebViewClientImpl.java`）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `onPageStarted` | **恢复早注入**（对齐 gao）：`type==1 && !tv.cctv.com && !yangshipin.cn` → 先跑自愈，再注入 `getFileContent(url)`，整段包 try-catch |
| 2 | `onPageFinished` | `type==1` 分支注入前**先执行 `RESET_STALE_TVLOAD_JS`**，清掉早注入可能留下的假置位 |

**三重保险**（任一环失败都不影响最终脱壳）：
1. 早注入前跑自愈常量；
2. 早注入整体 try-catch，异常不影响 `onPageFinished`；
3. `onPageFinished` 注入前同样跑自愈 —— 早注入半途失败仍可补救。

自愈逻辑闭合（判断依据为 `end.js` 是否跑完）：
- `_tvload==true && _tvLoadRes` 未定义 → **重置 `_tvload=false`**，放行重来；
- `_tvload==true && _tvLoadRes` 已定义 → 早注入已成功，`onPageFinished` 被闸门挡住（正确，避免重复施力）。

### 五、作用域隔离（不牵连已验收链路）

| 目标 | 处理 |
|---|---|
| **各省地方台**（type==1 非 tv.cctv.com 非 yangshipin） | ✅ 恢复早注入 —— 本轮修复对象 |
| **yangshipin.cn**（央视源2 / 卫视 / 教育） | ⛔ **显式排除**：v4.5.31 已改走 CCTV直播入口那条已验证的链并实测正常，不纳入早注入 |
| **tv.cctv.com**（央视 17） | ⛔ 与 gao 一致，始终排除在早注入外（走 `injectCctvFullscreenPipeline`） |
| **type==0**（CCTV直播入口） | ⛔ 完整保留 v4.5.27 的 `progress==100` 门禁，一行未动 |

**未动**：`getFileContent`、`shouldInterceptRequest`、`js/end.js`、`js/load_detail_tv.js`、
`js/tv/common/detail.js`（均为 v4.5.33 及之前的状态）；**央视片库 / 央视栏目零改动**。

### 六、校验

- 严格扫描（排除字符串与注释后统计括号）：x5 **大括号 119/119、圆括号 308/308，差 0**；
  与已知可编译的 gao 基线（109/109、290/290，差 0）同为零差。
- `RESET_STALE_TVLOAD_JS` 去注释后出现 **3 次 = 1 定义 + 2 处调用**（此前仅 1 次定义、0 调用）。
- 本机无 Android SDK，未做真编译。

### 七、请实测（Clean → Build → 装包）

重点：**各省地方台是否脱壳**（建议浙江、广东、河南、山西各挑 1 个）。
同时回归确认：**CCTV直播入口 / 央视网入口的央视与卫视**仍正常（应不受影响）。

若仍不脱壳，请抓 logcat 三条：
- `detailPath::` —— 应为 `tv/common`
- `[道玄电视] detail.js injected:` —— 应为 `true`
- `[道玄电视] waitForVideoElement 未取到 video` —— 若大量出现，说明站点侧真的不给 video

---

## v4.5.33 (2026-09-16) - android-x5：各省地方台 90%+ 不脱壳——补回缺失的 `pageFsBtn` 整环

### 一、实测反馈

| 入口 | 结果 |
|---|---|
| CCTV直播入口 · 央视 / 卫视 | ✅ 全部正常 |
| 央视网入口 · 央视 / 卫视 | ✅ 全部正常（v4.5.32 生效） |
| **各省地方台** | ❌ **90%+ 不脱壳** |

### 二、先摸清盘子：806 个频道其实是四类

| 形态 | 数量 | 占比 | 说明 |
|---|---|---|---|
| `/tv-web/live.html?url=<m3u8>` | 266 | 33% | 走**我们自己的**播放器页，本就无需脱壳 |
| `yangshipin.cn` | 58 | 7% | v4.5.31 已修好 |
| `tv.cctv.com` | 18 | 2% | 原生侧已注入，已正常 |
| **第三方站点** | **464** | **58%** | **需要脱壳，正是本轮对象** |

第三方站点域名 TOP：`static.hntv.tv`30、`web.guangdianyun.tv`21、`www.nmtv.cn`20、
`www.gdtv.cn`17、`apphhplushttps.sxrtv.com`17、`www.fjtv.net`17、`www.mgtv.com`14 …

### 三、决定性取证：多数地方台静态页面里根本没有 `<video>`

实抓 8 个地方台样本：

| 站点 | 静态 `<video>` | `<iframe>` | 形态 |
|---|---|---|---|
| 浙江 cztv / 广东 gdtv / 江苏 jstv | 0 | 0 | SPA |
| 福建 fjtv / 湖南 mgtv / 河北 hebtv | 0 | 0 | SPA |
| 山东 iqilu / 安徽 ahtv | 1 | 0 | 静态含 video |

**8 个里 6 个静态 HTML 无 `<video>`、且无一使用 iframe** —— 播放器是 SPA 运行时才创建的。

这条取证推翻了「改改选择器就能解决」的思路：**任何依赖"页面里先得有 `<video>`"的方案，
对这些站点天然无效。**

### 四、根因：x5 的地方台链路少了 `pageFsBtn` 整环

`js/pageFsBtn.js`（通用全屏点击器）**不依赖 `<video>`** —— 它按 16 个选择器
（`.videoFull`/`.vjs-fullscreen-control`/`.dplayer-full`/`.xgplayer-fullscreen`/
`[title*="全屏"]` …）加 `[class*="fullscreen"]` 松匹配，去找**站点自己的全屏按钮**并点击，
让站点自己进入全屏，成功时置 `window.__DXTV_PAGE_FS__ = true`。

而它的加载链在 x5 里是断的：

```
gao（已验证稳定的模板工程）： zepto → common → pageFsBtn → detail ✅
x5（迁移后）              ： zepto → common →            detail ❌  ← 整环缺失
```

于是地方台只剩 `tv/common/detail.js` 的 `setupVideo()` 一条路，而它**完全依赖**
`waitForVideoElement()` 拿到 `<video>`。叠加两个缺陷后必然裸奔：

1. **无护栏**：gao 的两处调用都裹着 `if(!window.__DXTV_PAGE_FS__)`，
   x5 迁移时被删掉，变成无条件 `setupVideo()`；
2. **静默断链**：`waitForVideoElement()` 超时应 resolve(null)，原实现立刻拿 null 访问
   `video.style` / `video.muted` → 抛 TypeError → 整条 Promise 链当场断掉、
   无任何兜底执行、控制台不留痕 → 页面就停在未脱壳的原样。

### 五、修复（3 处，全部对齐 gao 基线）

| 文件 | 改动 |
|---|---|
| `js/load_detail_tv.js` | `loadFromLocal()` 补回 `pageFsBtn`：`zepto → common → pageFsBtn → detail` |
| `js/load_detail_tv.js` | `loadFromRemote()` 同步补上 `pageFsBtn.js` |
| `js/tv/common/detail.js` | 补回两道 `if(!window.__DXTV_PAGE_FS__)` 护栏；加 null 保护 + `.catch()` 兜底 |

**为什么安全**：`pageFsBtn.js` 自带 `__DXTV_PAGEFS_INJECTED__` 幂等保护 ——
`tv.cctv.com` 那条链已被原生侧 `injectCctvFullscreenPipeline` 注入过，
这里重复加载会直接 `return`，不会重复施力。

**未动**：yangshipin/cctv 链（v4.5.31 成果）、`cctv/detail.js`（v4.5.32 成果）、
注入门禁、`shouldInterceptRequest`；**央视片库（cctv.html）/ 央视栏目（column.html）零改动**。

3 个 JS `node --check` 全 OK，五 + 四项内容断言全绿。

### 六、预期与待确认

`pageFsBtn` 会先盖一层黑幕（最长 9 秒，60 拍 × 150ms），盖到"视频真的撑满"才撤 ——
这是 gao 的原设计，目的是**别露骨架**。所以地方台首次进入可能会有数秒黑幕，属正常。

若仍不脱壳，请抓 logcat 的 `detailPath::`（应为 `tv/common`）与
`[道玄电视] waitForVideoElement 未取到 video`（若大量出现，说明站点侧真的不给 video，
那就只能靠 `pageFsBtn` 点全屏按钮这一条路）。

---

## v4.5.32 (2026-09-16) - android-x5：切台「要点两次才对」——`checkHistory()` 记忆回流把新频道拉回旧频道

### 一、实测反馈

v4.5.31 装包后：

| 入口 | 结果 |
|---|---|
| CCTV直播入口 | ✅ 正常 |
| 央视网入口 · 央视（17） | ✅ 正常 |
| 央视网入口 · 央视源2（25） | ✅ 正常 |
| 央视网入口 · **卫视（32）** | ❌ **频道列表与实际节目不符** |

卫视的具象症状：**换频道要点两次**。
> 当前在重庆卫视 → 点云南卫视 → 播出来的还是重庆卫视 → 再点一次云南卫视 → 才是云南卫视。
> 即：**第一次永远显示「上一个」频道，第二次才正确。**

### 二、根因：`js/cctv/detail.js` 的 `checkHistory()` 在 App 里成了「切台拉回器」

这个函数原本是给浏览器做的「回到上次看的频道」。它落在 App 里，与
`LiveActivity` 的切台方式（`channelList.setOnItemClickListener` → `loadLiveUrl()` → **`mWebView.loadUrl(B)`，整页重载**）
撞在一起，就精确复现了用户描述的每一步：

| 步 | 发生什么 | 用户看到 |
|---|---|---|
| 1 | 在 A 台：`nowValue===value` → 写 `localStorage=A` | 正常播 A |
| 2 | 点 B 台：整页重载，`nowValue=B` / `value=A` → **不等** → `window.location.href = A` | — |
| 3 | 页面重载 A：`nowValue=A` / `value=A` → 相等 → 写 A | ★ **点了 B，出来 A** |
| 4 | 再点 B：v4.5.30 那道「同一目标每会话一次」的闸门此刻命中，不再跳 → 写 `B` | ★ **第二次才正确** |
| 5 | 之后换到 C：`guardKey = "_tv_hist_back_" + B` 是新的 key → **重演一次「第一次被拉回」** | 每个新频道都要点两次 |

**关键**：v4.5.30 我加的闸门是**按旧 URL 记的**（`"_tv_hist_back_" + value`），
所以它不是治好回流，而是把「无条件死循环」变成了「**每个频道第一次被切走时拉回一次**」——
恰好就是「点两次才对」。闸门没救场，反而让症状变得稳定可复现。

### 三、修复：App 内只记录、不回流（1 个文件）

`js/cctv/detail.js` 的 `checkHistory()` 开头加一段：

```js
try{
    if(typeof _tvFunc!=="undefined" && _tvFunc && _tvFunc.isApp && _tvFunc.isApp()){
        try{ localStorage.setItem(key, nowValue); }catch(e){}
        return;                 // ← App 内到此为止，绝不执行 window.location.href = value
    }
}catch(e){}
```

**理由**：App 里频道由**原生列表**给出，用户点哪个就看哪个——「记忆回流」在这里毫无价值，
只有害处。浏览器（无壳）环境保留原回流与 v4.5.30 闸门，行为不变。

### 四、改动清单与影响面

| 文件 | 改动 |
|---|---|
| `js/cctv/detail.js` | `checkHistory()` 增加 App 内「只记录不回流」短路 |

- 只动 1 个文件、1 个函数，**不碰**：注入链、`load_detail_tv.js`、`load_detail_video.js`、
  `tv/ysptv/detail.js`、`shouldInterceptRequest`、脱壳入口 `.videoFull`。
- **央视片库（cctv.html）/ 央视栏目（column.html）零改动**，遵守约束。
- `node --check` 通过；六项内容断言全绿（App 分支、浏览器逻辑保留、
  `_tv_channel_url` 键不变、脱壳入口未动）。

### 五、范围提醒

这个问题**不是卫视独有**，而是所有走 `cctv` 链的 yangshipin 频道共有
（央视源2 25 + 卫视 32 + 教育 1 = 58 条）。
央视源2 之所以没暴露，多半是因为**首次进入时 `localStorage` 为空 → 不触发回流**，
只有连续切台才会撞上。请两组都按「连续切 3 个台」复测。

---

## v4.5.31 (2026-09-16) - android-x5：做减法 + 整链复用（央视频在央视网入口改走已验证的 CCTV直播入口链路）

> 背景：v4.5.28 / v4.5.29 / v4.5.30 连续三轮都是「先猜后改」，结果**越改越乱**
> （CCTV直播入口由「正常」变成「抽风」）。本轮**停止猜测**，改为
> **① 撤掉未被证实的改动、② 复用一条已经被实测证明可用的完整链路**。

### 一、本轮的排他性排查（四项假设全部推翻，未据此改任何代码）

| 假设 | 验证方式 | 结论 |
|---|---|---|
| 央视频有 CSP 拦住内联脚本，导致 `load_detail_tv.js` 注入的脚本不执行 | 实抓 `yangshipin.cn/tv/home` 响应头 | ❌ 推翻：CSP 只有 `frame-ancestors 'self'`，不限制 script |
| 两个 Activity 的 WebView 设置不同（UA / 媒体自动播放 / DOM 存储） | 扫描全部 `WebSettings` 调用 | ❌ 推翻：设置全在 `BaseActivity`，`LiveActivity` 与 `MainActivity` **共用** |
| `LiveActivity` 的 JS 桥没有 `getJson`，导致本地资源读不到 | 对比两处 `JsInterface` 的 `@JavascriptInterface` 方法 | ❌ 推翻：两边都有 `getJson`（Live 5 个 / BaseWebView 6 个方法） |
| `waitForVideoElement()` 超时返回 null 使后续抛异常 | 精读 `common.js:375-425` | ❌ 推翻：`querySelector('video')` + MutationObserver + 200ms 轮询，逻辑正常 |

**排查后剩下的唯一硬事实**：同一个央视频站点，`cctv` 链（CCTV直播入口）**能播**，
`tv/ysptv` 链（央视网入口）**不能播**。

### 二、核心改动：整链复用，而不是换脚本（这是与 v4.5.28 的本质区别）

`WebViewClientImpl.getFileContent()`：央视频在 `type==1`（央视网入口）时改返回
`js/load_detail_video.js`，即**与 CCTV直播入口完全同一条链**。

```java
if(type==1 && url.startsWith("https://www.yangshipin.cn")){
    detail = sLoadDetailVideoJs;   // 复用已验证链路
} else if(type==1){
    detail = sLoadDetailTvJs;      // 其余站点不变
} else {
    detail = sLoadDetailVideoJs;   // type==0 不变
}
```

**为什么 v4.5.28 失败了，这次不一样**：v4.5.28 只把目标文件换成 `js/cctv/detail.js`，
却**仍保留 `load_detail_tv.js` 那套「原生桥 getJson + 内联 script」的加载机制**——
机制没变，所以实测仍失败。本次是**加载器 + 资源加载方式（外链 script src）+ 脚本**整条一起换：
`load_detail_video.js` 使用 `_tvLoadRes.js(_browser.getURL(...))` 插外链 `<script src>`，
由 `shouldInterceptRequest` 拦 `*/tv-web/*` 回本地 assets——这正是 CCTV直播入口正在用的、已验证的方式。

**作用域**：仅限 `yangshipin.cn`（央视源2 25 + 卫视 32 + 教育 1，共 58 条）。
`tv.cctv.com` 仍在 `onPageFinished` 开头早返回，走 `injectCctvFullscreenPipeline`，**不受影响**。

### 三、注入门禁按 type 分域（关键：把已验收的链路隔离出来）

```java
if (type == 1) {                       // 央视网入口：解除进度门禁
    view.evaluateJavascript(fileContent, ...);
    if (mWebView.getProgress() != 100) { view.postDelayed(..., 500); }  // 补一次
    return;
}
if (mWebView.getProgress() == 100) {    // type==0：完整保留 v4.5.27 原始门禁
    view.evaluateJavascript(fileContent, ...);
}
```

* **type==1** 必须解除门禁：央视频等直播页常驻 HLS 分片与心跳长连接，进度长期停在
  60~90%（实测三张截图 70 / 70 / 10），若等 100 则脚本永不注入 —— 这是「未脱壳」的机制性原因。
* **type==0** 完整保留 v4.5.27 的 `progress==100` 门禁：该入口在 v4.5.27 **实测正常**，
  本轮不做任何行为改变，避免把已验收链路拖下水（v4.5.29 曾对两个 type 一起解除门禁，
  随后 CCTV直播入口开始「抽风」）。

### 四、做减法：撤掉 v4.5.30 未被证实的兜底器

`js/yspFullscreen.js`（主视频满屏兜底器）**已删除**，Java 侧三处一并移除：
`sYspFullscreenJs` 字段、`injectYspFullscreen()` 方法、`yspFullscreenJs()` 方法，
以及 `onPageFinished` 中对它的注入与 350ms 补注。

撤销理由：它属于**未被证实的猜测性改动**，且会以 800ms 间隔持续 90 秒操作 DOM，
与站点自身渲染互相拉锯。央视频的问题改由「整链复用」解决，不需要它。

**保留**：v4.5.30 给 `js/cctv/detail.js` 的 `checkHistory()` 加的「每会话一次」闸门 ——
本轮央视频改走 cctv 链后，防重载死循环这道保护**更重要**了。

### 五、改动清单

| 文件 | 改动 |
|---|---|
| `java/.../impl/WebViewClientImpl.java` | `getFileContent()` 央视频整链复用；`onPageFinished` 注入门禁按 type 分域；移除 yspFullscreen 三处 |
| `js/yspFullscreen.js` | **删除** |

**未动**：`tv.cctv.com` 的 4 个已验收入口、`shouldInterceptRequest`、
`js/load_detail_tv.js`（v4.5.29 已回退到原始 160 行）、`js/load_detail_video.js`、
`js/cctv/detail.js`（仅保留 v4.5.30 的防死循环闸门）。
**央视片库（cctv.html）/ 央视栏目（column.html）零改动。**

### 六、静态校验

严格扫描（排除字符串与注释后统计括号）：

```
x5  WebViewClientImpl   大括号 113/113 差 0    圆括号 294/294 差 0
gao WebViewClientImpl   大括号 109/109 差 0    圆括号 290/290 差 0   ← 已知可编译基线
x5  LiveActivity        大括号 291/291 差 0    圆括号 763/763 差 0
gao LiveActivity        大括号 290/290 差 0    圆括号 758/758 差 0
```

本机无 Android SDK，无法真编译；以上为结构配平校验（差值 0 且与基线一致）。

### 七、请实测（Clean → Build → 装包）

1. **CCTV直播入口**：行为与 v4.5.27 完全一致，应恢复稳定（不再抽风）。
2. **央视网入口 → 央视源2**：是否能正常满屏播放。
3. 顺带看 **卫视 / 教育→中国教育1**（同一改动的受益分组）。

若央视源2 仍不满屏，请在 logcat 过滤 `detailPath::` —— 应打印 `cctv`；
若打印 `tv/ysptv` 则说明整链复用没生效，`getFileContent` 的 URL 前缀判断需复核。

---

## v4.5.30 (2026-09-16) - android-x5：央视频主视频「满屏兜底器」（视频留在骨架小窗 / CCTV直播时好时坏）

> 实测反馈：**央视源2 计数器走完、不脱壳、视频在骨架窗口**；
> **CCTV直播入口「抽风」——时而正常、时而不正常、无规律**，
> 不正常时的症状与央视源2 完全一致：**视频在骨架窗口播放**。

**一、这条反馈推翻了之前的假设**

CCTV直播入口走 `load_detail_video.js → cctv` 链，央视源2 走 `load_detail_tv.js → tv/ysptv` 链，
两者是**两套不同的脱壳脚本**，却出现**同一个症状**。说明病根不在「选哪条链」，
而在**两条链共用的某样东西**——即「脱壳这个动作本身的性质」。

**二、「一次性动作」撞上「会重建 video 的 Vue 单页应用」= 时好时坏**

| 链 | 脱壳动作 | 性质 |
|---|---|---|
| `js/tv/ysptv/detail.js` | `setupVideo()` 抓「当时的第一个 `<video>`」搬进黑容器 | **一次**，之后不再管 |
| `js/cctv/detail.js` | `fullscreen()` → `$$(".videoFull").trigger("click")` 点一次站点全屏键 | **一次**，点空 / 点早都无重试 |

而央视频是 Vue 单页应用：**站内切台、播放器初始化都会换掉 `<video>` 元素实例**。
一次性动作一旦落在「旧 video」上，**新 video 就永远留在站点自己的小窗里** ——
正是「视频在骨架窗口播放」；而「直接进」还是「切台进」决定了你撞上哪种情况，
所以表现为**无规律**。

顺带解释了两条链共有的另一处脆弱：`fullscreen()` 只有一次点击、`setupVideo` 只搬一次，
两者都**没有校验、没有重试**（`_tvFunc.check` 的 `num>maxNum` 分支甚至只清定时器不回调）。

**三、本轮改动（把「一次性」改成「持续施力到真的满屏」）**

| 文件 | 改动 |
|---|---|
| **`js/yspFullscreen.js`（新增）** | 央视频主视频「满屏兜底器」：持续盯着「当前确实在播的 video」顶到满屏，站点重建播放器时自动再校正 |
| `WebViewClientImpl.java` | yangshipin 分支在原有 `pageToastKill` 之外**再加注 `yspFullscreen`**（含 350ms 补注）；新增 `sYspFullscreenJs` 缓存与 `injectYspFullscreen()` |
| `js/cctv/detail.js` | `checkHistory()` 的无条件回流加一道「每会话一次」闸门（见第五节，去死循环风险） |

`yspFullscreen.js` 的关键设计：

- **两拍制，由轻到重**：第 1 拍只加类 + 内联样式（不搬 DOM，最不容易和站点打架，
  对齐 `end.js` 的 `.utv-video-full` 约定）；第 2 拍量出来仍不满屏（多为祖先带
  `transform` / 裁剪把 `fixed` 拽住）才搬进 body 级黑箱。
- **持续校正**：每 800ms 一拍、最长 90s，之后转 4s 长效看门狗；另有
  `MutationObserver`（站点重渲染即校正）与 `visibilitychange`（切回前台即校正）。
- **同一元素只搬一次 DOM**：站点重渲染会换**新**元素，那就对新元素再来一遍，
  但绝不与站点在同一元素上反复拉锯（避免闪烁）。
- **安全护栏**：
  - 只对「确实在播」的 video 施力（`readyState>2 && !paused && !ended && currentTime>0`），
    避免误搬暂停中的海报 / 频道列表里的小预览图；
  - `document.fullscreenElement` 有值时直接退出（站点自己的全屏生效就不插手）；
  - 层级固定 **99990**（对齐 `end.js` 的 `.utv-video-full`），**低于** App 自己的菜单层
    `999990`，保证画质 / 频道菜单仍显示在画面之上；
  - 幂等（`__DXTV_YSP_FULL__`），原生重复注入无副作用；
  - **只对 `yangshipin.cn` 注入**：不碰 `tv.cctv.com`（那 4 个入口 v4.5.16 已验证正常），
    **央视片库（cctv.html）/ 央视栏目（column.html）零改动**。
- **可自检**：`window.__DXTV_YSP_FULL_REPORT__` 含 `pick / forced / reparented / full / note`。

**四、为什么这次是「加法」而不是「改造」**

兜底器只在**两条链都没把画面撑满**时才动手；两条链正常时（视频已满屏）它一拍都不施力。
所以它**不会**把现在能用的路径改坏——最坏情况只是维持现状。

**五、顺手去掉的一处真实隐患：`checkHistory()` 的回流死循环**

`js/cctv/detail.js` 的 `checkHistory()` 原实现是**无条件回流**：

```js
if(value && value !== nowValue){ window.location.href = value; return; }
```

只要 `localStorage` 里的旧 URL 与当前 URL 不等，就把页面导航走。一旦**站点自身做重定向**
（例如给 URL 补挂查询参数），回来以后 `value` 依旧不等于 `nowValue`，就会
「跳过去 → 发现不等 → 再跳」地循环 —— 表现为**页面反复重载、脱壳链被反复打断**，
是「未脱壳 / 骨架裸露」的可疑来源之一（也解释了一部分「无规律」）。
改为**同一目标每个 WebView 会话只回流一次**（`sessionStorage` 闸门）：保留原有回流体验，
去掉死循环风险。

**六、静态校验**

- `js/yspFullscreen.js`、`js/cctv/detail.js` → `node --check` **语法 OK**。
- `WebViewClientImpl.java` 改动为纯新增（1 个缓存字段 + 1 个注入分支 + 2 个方法），
  未触碰 `tv.cctv.com` 分支与 `shouldInterceptRequest`。
- 央视片库 / 央视栏目未改动，遵守约束。

**七、待确认（决定下一步）**

1. 兜底器生效后，**央视源2 / CCTV直播入口是否都能满屏**？
2. 若仍不满屏，请在设备浏览器里直接打开 `https://www.yangshipin.cn/tv/home?pid=600001817`，
   确认央视频自身能否出画面（区分「我们没撑满」与「央视频要登录 / 不给播」）。
3. CCTV直播入口「不正常」时，是**进入就小窗**，还是**切台后才变小窗**？
   （后者正是本轮的「一次性动作」假设，前者的概率会落到站点侧。）

## v4.5.29 (2026-09-16) - android-x5：回退 v4.5.28 + 修两个原生根因（「频道名 X% 卡死」「脱壳脚本永不注入」）

> 实测反馈：央视源2 出现 3 种异常（三张截图的浮层分别是 `CCTV1 综合 70%` /
> `CCTV12 社会与法 70%` + `net::ERR_SOCKET_NOT_CONNECTED` / `CCTV 风云剧场 10%`），
> 全部卡死在浮层页面；**CCTV直播入口又退回上一次的卡死状况**。
> 据此**回退 v4.5.28 的全部改动**（`load_detail_tv.js` 恢复走 `tv/ysptv`），
> 并修复本轮挖到的两个**原生层（Java）根因** —— 它们与脱壳链的选择无关，
> 是「卡死」与「未脱壳」共同的机制性来源。

**一、先摆铁证：本轮有一次硬网络错误**

第 2 张截图的页面标题就是错误页原文：
`https://www.yangshipin.cn/tv/home?pid=600001817 的网页无法加载，因为 net::ERR_SOCKET_NOT_CONNECTED`。
`ERR_SOCKET_NOT_CONNECTED` 是**传输层连不上**（不是 404、不是超时），说明该次测试时
设备/模拟器与央视频之间的连接被切断。它会独立地让**所有** yangshipin 频道（央视源2 25 +
卫视 32 + 教育 1，共 58 条）以及 CCTV直播入口一起失败 —— 这一条不是代码能修的。
所以本轮有一部分现象属于环境噪声，判代码前请先确认网络。

**二、三个机制性发现（全部在读原生代码时定位）**

| # | 发现 | 后果 |
|---|---|---|
| 1 | 图上那个浮层**不是计时器**，是 `binding.liveName`（`LiveActivity.java:459` 的 `setText(currentLive.getName()+" "+newProgress+"%")`） | 它显示的是 WebView 的**加载进度** |
| 2 | `liveName` **唯一的清空路径**是 `newProgress==100`（`:461` → 延迟 1s 发 `message(2)`） | 进度到不了 100 → 浮层**永久残留** → 看着像「卡死」。三图停在 70/70/10，无一到 100 |
| 3 | `WebViewClientImpl.onPageFinished` 的注入门禁是 **`if (mWebView.getProgress() == 100)`**（`:193`） | 进度到不了 100 → **`end.js + load_detail_*.js` 整套脱壳脚本永不注入** → 页面裸奔 |

为什么进度到不了 100：yangshipin 是直播站，常驻 HLS 分片与心跳长连接，
WebView 的进度会长期停在 60~90%（SPA 站内切台后甚至回落）。
**而 MainActivity（CCTV直播入口）的遮罩有 15s 兜底、LiveActivity 的 `liveName` 一条兜底都没有**——
这正是「频道名 X% 永久浮层」只在央视网入口出现的原因。

**三、本轮改动**

1. **回退 v4.5.28**：`js/load_detail_tv.js` 四处改动全部撤销（映射恢复走 `tv/ysptv`，
   `_data` 恢复无条件预置，`loadFromLocal` / `loadFromRemote` 恢复单链）→ 文件 209 行退回 160 行。
2. **修门禁**：`WebViewClientImpl.onPageFinished` 解除 `getProgress()==100`，
   改为 onPageFinished 即注入（脚本自带 `_tvload` 幂等闸门，重复无副作用），
   若此刻进度未满再补一次 500ms 重注入。
3. **修浮层**：`LiveActivity` 新增 `STALE_NAME_CLEAR_MS=4000L` 与 `message(3)`——
   每次 `onProgressChanged` 顺延一次清空任务，进度一旦停滞/走完，浮层 4 秒内自动收起。

未触碰：`cctv.html`（央视片库） / `column.html`（央视栏目） / tv.cctv.com 相关链路。

**四、为什么门禁一修，央视源2 反而有希望出画面**

`js/tv/ysptv/detail.js` 在本工程**确实没有 DOM 脱壳**，但它有一个被低估的 `setupVideo()`：
创建一个 `position:fixed; z-index:2147483647; background:black; 100vw×100vh` 的容器把 `<video>` 装进去。
`2147483647` 是 CSS z-index 上限，**站点 UI 会被整块盖住 —— 视觉上等同于脱壳**。
它此前失败不是「没能力」，而是 `waitForVideoElement()` 拿不到 video 时 `setupVideo(null)` 会抛 `TypeError`，
且脚本**根本没被注入**（门禁拦下）。门禁解除后，这条链才第一次真正跑起来。

**五、静态校验**

`load_detail_tv.js` → `node --check` **OK**（回退后 160 行）。
两处 Java 改动已回读确认落位（`onPageFinished` 注入段、`handleMessage` 的 `case 3`、`onProgressChanged` 顺延段）。
本机无 Android SDK，Java 变更**未经编译验证**，请在 Android Studio 里 Build 一次。

**六、待确认**

1. 本轮测试时**设备网络是否正常**？第 2 张图的 `ERR_SOCKET_NOT_CONNECTED` 是不是偶发？
   （建议先单独测：在设备浏览器里直接打开 `https://www.yangshipin.cn/tv/home?pid=600001817`）
2. CCTV直播入口本轮「退回卡死」——是**黑屏卡住**，还是**又自动跳回首页**？
   （若又自动跳首页，说明 `myfocus.js:keyBackEvent` 的 App 短路之外还有第二条出口，需继续查）
3. 重测时请抓这两条 logcat：`[道玄电视] detail.js injected:` 与 `WebChromeClient onProgressChanged`，
   用来确认「脚本是否注入」与「进度最终停在多少」。

## v4.5.28 (2026-09-16) - android-x5：央视网入口 yangshipin 改走 cctv 脱壳链（央视源2 未脱壳）

> ⚠️ **本版已于 v4.5.29 回退**（实测 CCTV直播入口出现回退性卡死，按实测优先原则先退回基线）。
> 保留本节仅作技术记录 —— 「同一个网站、两条注入链、两套脱壳脚本」的对照分析仍然成立，
> 待网络与门禁问题澄清后可重新评估是否启用。

> 实测反馈：**CCTV直播入口已正常**（v4.5.27 生效 ✅）。但央视网入口里——
> **央视(17) 正常**，**央视源2(25) 计时器走完 → 未脱壳**：视频在窗口里正常播放，
> 但央视频整站 UI（顶栏「推荐/电视/赛事/更多」+ 搜索框 + 右侧 CCTV1~CCTV5+ 频道列表）裸露。
> 道玄提示：cctv-gao 当年因**无法解决央视源2 脱壳**，直接把该分组从央视网入口删掉了 ——
> 所以 gao 里**没有这项可参照**（已核实：gao 的 `js/cctv/tv.json` 确实无 `cctv2` 分组）。

**一、根因：同一个网站，两条注入链，加载了两套不同的脱壳脚本**

两个入口访问的**是同一类页面**（`https://www.yangshipin.cn/tv/home?pid=...`），
但因为承载它们的 Activity 不同、`WebViewClientImpl` 的 `type` 不同，注入的加载器不同，
最终加载了**两套完全不同的脱壳脚本**：

| | 央视网入口（LiveActivity） | CCTV直播入口（MainActivity） |
|---|---|---|
| `WebViewClientImpl` type | **1** | **0**（`BaseActivity:150`） |
| 注入的加载器 | `js/load_detail_tv.js` | `js/load_detail_video.js` |
| yangshipin 映射 | → `tv/ysptv` | → `cctv` |
| 实际脱壳脚本 | `js/tv/ysptv/detail.js`（x5 仅 2742B） | `js/cctv/detail.js`（4304B） |
| 附带底座 | 只 `zepto` + `common` | `zepto`+`common`+**`myfocus`**+**`vuex`**+**`detailBase`** |
| 实测 | ❌ 未脱壳（本轮反馈） | ✅ 正常 |

`js/tv/ysptv/detail.js` 之所以裸奔：**x5 里它是被砍掉 DOM 脱壳的精简版**
（gao 版 5938B 含 `doClean`+`hideDeep`+`MutationObserver` 持续重清；x5 版 2742B **一行都没有**），
只剩一次性 `setupVideo()` 把 `<video>` 挪进全屏容器；且当 `_tvFunc.waitForVideoElement()`
35 秒超时 `resolve(null)` 时，`setupVideo(null)` 会立刻 `TypeError` 抛异常，整条链当场崩掉。

**二、决定性证据：被注释掉的那一行**

`js/load_detail_tv.js` 里**原本就有一条 `yangshipin.cn/tv/home → "cctv"` 的映射，被人注释掉了**：

```js
/* if(url.startsWith("https://www.yangshipin.cn/tv/home")){ return "cctv"; } */   ← 被注释
if(url.startsWith("https://www.yangshipin.cn")){ return "tv/ysptv" }             ← 现走这条
```

即：**央视网入口的 yangshipin 历史上本来就走 `cctv` 链，是后来被改成 `tv/ysptv` 才坏的**。
而 `cctv` 链此刻正被 CCTV直播入口用于**同一个网站**且已验证可用
（两工程的 `js/cctv/detail.js`、`js/common.js`、`js/pageFsBtn.js` 均**逐字节相同**）。
所以可用方案**已存在于本 App 内**，这是接线修正，不是重造轮子。

**三、处置：4 处改动，全部集中在 `js/load_detail_tv.js`**

1. **恢复映射** —— `loadDetailByUrl()` 增加（在通用 yangshipin 分支之前）：
   `https://www.yangshipin.cn/tv/home` → `"cctv"`。
2. **`_data` 预置条件化** —— 顶部那句 `_data={hzList(video){…}}` 只服务 `tv/*` 系 detail.js；
   `js/cctv/detail.js` 自带 `let _data = {...}`，若此处再预置同名全局属性会造成同名遮蔽。
   现改为：**非 `yangshipin/tv/home` 时才预置**，与已验证可用、无此预置的
   `load_detail_video.js` 保持完全一致。
3. **`loadFromLocal()` 增加 cctv 分支** —— 按顺序补齐 cctv 链底座（每个 onload 后再下一个）：
   `zepto.min.js` → `common.js` → `myfocus.js` → `vuex.min.js` → `detailBase.js` → `cctv/detail.js`。
   依赖对应关系已逐一核实：
   `$$`←zepto，`_layer`/`_tvFunc`/`_apiX`←common（`common.js:563`），
   `_menuCtrl`←myfocus（`myfocus.js:20`），`PetiteVue`←vuex.min.js，`_detailInit`←detailBase（`detailBase.js:254`）。
4. **`loadFromRemote()` 同步补齐** —— 非 App 环境走远程时同样加上 `myfocus`/`vuex`/`detailBase` 三个底座，保持两条路径一致。

**四、影响范围（比反馈更广，但方向一致）**

`js/cctv/tv.json` 共 **806** 个频道，其中 `yangshipin.cn/tv/home` 形态共 **58 条**，
本轮全部改走 cctv 链（原本它们全都走的是那条坏掉的 `tv/ysptv`）：

| 分组 | 走新链 | 说明 |
|---|---|---|
| 央视源2 | 25/25 | 本轮反馈的问题分组 |
| 卫视 | 32/32 | 同样 yangshipin，同样此前未脱壳（**顺带修复**） |
| 教育 | 1/10 | `中国教育1 综合`（pid=600171827） |

已核实 tv.json 中**不存在**其它形态的 yangshipin URL；`tv/ysptv` 分支保留但当前数据集不再命中。

**不受影响**：`tv.cctv.com`（央视 18 条）仍走 `tv/cctv` 映射 + 原生 `injectCctvFullscreenPipeline`；
**央视片库（cctv.html）/ 央视栏目（column.html）零改动**（遵守"不损伤、不修改"约束，
它们是被 `getFileContent` 的 `tv-web/` 判断直接排除的本地页，不在此链上）。

**五、静态校验（本机无 Android SDK，只能静态分析）**

- `node --check js/load_detail_tv.js` → **语法 OK**。
- 依赖链逐一定位到定义处（见上表），无漏件。
- 原生收罩判据 `LiveActivity.FS_PROBE_JS`（`LiveActivity.java:624`）是**只读 DOM 判定**：
  只要有一个 ≥35% 视口且在播的 `<video>` 就返回 `playing` 收罩 —— **与"哪套脱壳脚本"无关**，
  故 cctv 链让主视频铺满后遮罩可正常收起（cctv 链的 `.videoFull` 点击正是干这个的）。
- 未改动任何 Java；未新增/删除文件；临时 diff/探测脚本已清理。

**六、待实测确认**

1. 央视网入口 → **央视源2(25)** 是否已脱壳（UI 消失、视频铺满）。
2. 顺带验证 **卫视** 与 **教育→中国教育1**（同链路，应一并正常）。
3. 若仍不脱壳 —— 请留意 logcat 中 `[道玄电视] cctv chain detail.js injected:` 是否打印、
   以及 `_tvFunc.check` 是否等到 `.videoFull`（央视频若改版/要登录，`.videoFull` 可能不存在）。

## v4.5.27 (2026-09-16) - android-x5：焊死「自动回首页」+ 三处跳转遮罩看门狗（CCTV直播卡死）

> 实测反馈：点 CCTV直播入口 → 计数器开始 → 计数器跑完 → **黑屏** → **自动退回首页**，
> 首页那层「…跳转…」遮罩**卡死**、遥控焦点全失效。
> 本轮做了**整条 yangshipin 链路的逐行对照**（cctv-gao 为基准），结论出人意料，先记在这里。

**一、关键结论：这条路是 cctv-gao 原样带过来的**

逐行 diff（自制 LCS 工具，忽略 BOM/换行差异）结果：

| 文件 | gao vs x5 |
|---|---|
| `js/cctv/detail.js`（yangshipin 脱壳主脚本） | **逐行相同** |
| `js/detailBase.js`（详情/菜单框架） | **逐行相同** |
| `js/common.js`（`_tvFunc`/`_layer`/`_apiX`） | **逐行相同** |
| `js/base.js` | **逐行相同** |
| `js/pageFsBtn.js` / `js/pageToastKill.js` / `js/cctvFullscreen.js` | **逐行相同** |
| `css/my.css` | 仅配色（深蓝/金色 vs 暗黑/金色） |
| `js/myfocus.js` | 按键映射（见下） |

也就是说：**「CCTV直播入口与 cctv-gao 相同」这件事本身，就是它坏的原因**——
第二步的移植并没有引入这个故障，它是从 cctv-gao 一起继承下来的老问题。

**二、本轮修掉的两个确切缺陷**

1. **焊死「自动回首页」的唯一出口** —— `js/myfocus.js`
   全工程只有一处会把 WebView 导航回首页：
   ```js
   keyBackEvent(){ … window.location.href = this.backUrl(); }   // backUrl() = _browser.getURL("index.html")
   ```
   它由 `_menuCtrl.back()`（`_messageCtrl.ctrl("back")`）与 **keyCode 81(=Q)** 直接触发，**不需要任何用户意图**。
   一旦触发，跳转前挂上的等待层就留在首页上，遥控焦点随之失效——正是实测现场。
   **处置**：`keyBackEvent()` 增加 App 内短路——`_tvFunc.isApp()` 为真时**不再自行导航**（App 的返回键本就归
   原生 `MainActivity.keyBack → WebView.goBack` 统一处理），只保留"先关菜单"的分支；仅无原生壳的
   浏览器/Gecko 环境保留跳首页兜底。

2. **三处「…跳转…」等待层加上看门狗** —— 它们全都是"显示后直接 `return` 去跳转、从没人关"，
   跳转一旦没落地（url 为空 / 被原生拦下 / 加载失败 / 被取消）就永久留在页面上，整页卡死：
   - `js/index.js`　`等待跳转...`：新增 `__tvCloseWait` 统一收口，挂 `pageshow` + `popstate` + `visibilitychange`
     + 6 秒看门狗（原来是只有 `pageshow` 一条）。
   - `js/home.js`　`正在跳转到 XXX 请耐心等待。。。`：等待层 id 留档 + 6 秒看门狗；`item.url` 为空直接不跳。
   - `js/detailBase.js`　`请耐心等待跳转。。。`：同上。

3. **补回遥控器键码**（对齐 cctv-gao）—— `js/myfocus.js`
   本工程此前只认电脑键盘 `W/A/S/D/Q/R`；遥控器的 `19/38`(上) `20/40`(下) `21/37`(左) `22/39`(右) `23/66`(确定)
   一个都没绑。现两组并存。

**三、定位到但本轮未动的「黑屏」根因（需你定夺）**

`js/cctv/detail.js`（央视直播页脱壳主脚本）的脱壳入口是**等央视频页面出现站点自有类名**：

```js
_tvFunc.check(function(){return $$(".videoFull").length>0}, function(){ _detailInit(null,999990,true); },1000);
// 以及 fullscreen(): $$(".videoFull").trigger("click"); $$(".y-full").hide();
// 画质列表: $$(".bei-list-inner").find(".item")…
```
- `.videoFull` / `.y-full` / `.bei-list-inner` **都是央视频站点自己的类名**（`js/pageFsBtn.js` 里只是把它们列进
  「全屏按钮候选选择器」清单，并不会创建它们）。
- 而 `js/pageFsBtn.js`（15+ 选择器 + `[class*="fullscreen"]` 松匹配的**通用全屏点击器**）
  **只对 `tv.cctv.com` 注入**，yangshipin 完全不注入。
- 于是 yangshipin 的脱壳**全部押在这几个第三方类名上**：央视频一旦改版，`_tvFunc.check` 白等 50 秒也不会
  触发 `_detailInit`，脱壳链整条不执行 → 页面停在原样 → 计时器跑完就只剩黑屏/骨架。
- 另一可能：央视频这条直播源本身要求登录/有白名单（与"北京地方台全军覆没（需要登录）"同性质），那就不是代码能解的。

**四、静态校验**
- 改动的 4 个 JS（`myfocus.js` / `index.js` / `home.js` / `detailBase.js`）全部 `node --check` **语法 OK**。
- 央视片库（`cctv.html` / `js/cctvideo/*`）、央视栏目（`column.html` / `js/cctvvideo/*`）、`load_detail_video.js`
  **零改动**。

**五、待实测**
CCTV直播入口：① 不应再出现"自动退回首页"；② 若仍退，页面也不会卡死（看门狗会收掉遮罩）。

**六、待确认（决定下一步怎么走）**
1. 卡死那层的**确切文字**是哪一条？——`正在跳转到 XXX 请耐心等待。。。`（属 `home.js`，只有 `tv.html`/`cctv.html` 会显示）
   还是 `等待跳转...`（属 `index.js`，首页）？这决定它到底是"首页"还是别的页面。
2. 当时**有没有按返回键**（或模拟器/遥控发过返回）？
3. 黑屏时页面是**纯黑**，还是能看到央视频的播放器外壳/海报？（用于区分"脱壳没跑"与"央视频要求登录"）

## v4.5.26 (2026-09-16) - android-x5：修复 yangshipin 全线失效（央视源2 / 卫视 黑屏·裸骨架）

> 实测反馈：**央视网入口**「央视（17）」正常，「央视源2（25）及后续其他节目」计时器走完仍**黑屏 / 裸骨架**；
> **CCTV直播入口** 进入播放窗口后回首页卡死。
> 定位结论：失败面 100% 落在 **yangshipin.cn**（央视源2 的 25 个、卫视组、CCTV直播入口都是它），
> 而正常面 100% 落在 **tv.cctv.com**。两者的唯一代码分叉，就是第二步移植进来的「onPageStarted 早注入」。

**一、根因（两步叠加，属本工程专属）**
1. 第二步从 cctv-gao 移植了 `WebViewClientImpl.onPageStarted` 里的**早注入**：`type==1` 且 URL 非 `tv.cctv.com` 时，
   在页面刚起步就把 `end.js + load_detail_tv.js` 注入进去。`tv.cctv.com` 被该条件排除，所以它安然无恙——
   这正是「央视正常、yangshipin 全灭」的由来。
2. 本工程 `assets/tv-web/js/end.js` 与 cctv-gao **不同版本**：cctv-gao 版有 DOM 兜底
   （`... || document.head || document.documentElement` + `if (head)`），本工程版**没有兜底**，
   直接 `head.appendChild(style)` / `document.body.appendChild(script)`。
3. `onPageStarted` 触发时 `<head>` 刚解析、`<body>` 通常还不存在 → 早注入**中途抛异常**；
   而 `load_detail_tv.js` 顶部那句 `_tvload=true` 已经落地 → **闸门被假置位**。
4. 于是 `onPageFinished` 的正常注入被 `_tvload` 挡成**空转**，yangshipin 的脱壳资源（zepto / common / `tv/ysptv/detail.js`）
   永不加载 → 页面不脱壳、播放器不被接管 → 计时器走完只剩黑屏或网页骨架。

**二、修复（三处，均只作用于第三方源，不碰片库/栏目）**
- `impl/WebViewClientImpl.java`：**删除 `onPageStarted` 里的早注入**，恢复本工程改造前的「只走 onPageFinished 一次性注入」行为；
  `tv.cctv.com` 本就被排除在早注入之外，行为不变（仍走 `injectCctvFullscreenPipeline`）。
- `impl/WebViewClientImpl.java`：`onPageFinished` 注入前新增**自愈**——若发现 `_tvload` 被置位却连 `end.js` 的
  `_tvLoadRes` 都没定义出来（半途中断的假闸门），先放开再来（常量 `RESET_STALE_TVLOAD_JS`）。
- `assets/tv-web/js/end.js`：**补 DOM 兜底**（4 处 appendChild：`loadCssCode` / `createDiv` / `_tvLoadRes.js` /
  `_tvLoadRes.css` / `_tvLoadRes.jsBottom`），对齐 cctv-gao 的防御写法；**保留本工程自己的底色 `#0A1F3A`
  与 `_browser.getURL` 的 `utao.tv/tv-web/` 约定**，不做整文件覆盖。

**三、附带修复：首页「等待跳转...」卡死**
- `assets/tv-web/js/index.js`：原两处 `_layer.wait("等待跳转...")` **丢弃了返回的层 id**，页内跳转一旦被取消、
  或从别的页历史回退 / bfcache 回到首页，该遮罩就永远挂在首页上（实测截图里的卡死现场）。
  现改为统一走 `waitAndGo()` 并把 id 记到 `window.__tvWaitId`，再由 `init()` 里注册的 `pageshow` 兜底收掉。

**四、静态校验**
- `WebViewClientImpl.java` 括号配平 **BALANCED**；`index.js` / `end.js` / `cctvFullscreen.js` /
  `pageFsBtn.js` / `pageToastKill.js` / `load_detail_tv.js` 全部 `node --check` **语法 OK**。
- 片库 / 栏目（`cctv.html` / `column.html` / `js/cctvideo/*` / `load_detail_video.js`）**零改动**。

**五、待实测**
`android-x5` → Clean → Build → 装包，重点看：
① 央视网入口「央视源2」及卫视等 yangshipin 频道：计时器走完后**能出画面**（不再黑屏/裸骨架）；
② CCTV直播入口：进入播放后不再回首页卡死；
③ 央视（17）与 片库 / 栏目 保持原样。
若 ① 仍有黑屏，下一个嫌疑点是 `pageToastKill.js` 的**几何兜底**（居中 + 小尺寸 + fixed/absolute 即隐藏），
它可能误伤 yangshipin 播放器的居中播放键——届时应把几何兜底改为「必须同时命中文案」。

## v4.5.25 (2026-09-16) - android-x5（X5版）：移植脱壳遮罩 + 全屏（第二步）

> 按 cctv-gao 同法，把「脱壳加载遮罩（含计时器 `SESSION_STALE_MS` 修复）」与「央视网全屏」整套移植到 android-x5。
> **央视片库 / 央视栏目（直连 m3u8 标清）全程零改动**：`cctv.html` / `column.html` / `js/cctvideo/*` / `load_detail_video.js` 及其数据一律未触碰。

**一、新增遮罩资源与布局**
- 新增 `res/drawable/pulse_ring.xml`、`res/drawable/pulse_core.xml`。
- `res/layout/activity_main.xml` / `activity_live.xml`：各新增 `loadingOverlay`（脉冲圆环 ×3 + 核心点 + `loadingText` 计时文案），保留 android-x5 原有底色 `#0A1F3A`。

**二、`BaseActivity`：增量补页面加载钩子（不整体覆盖）**
- 新增 `mainHandler`、`WebViewClientImpl.PageLoadCallback pageLoadCallback`，把 `onStarted/onFinished/onError` 转到 `onPageLoadStarted/Finished/Error`（新增的三个空实现，供子类覆盖）。
- `onResume` 注册 `setPageLoadCallback(pageLoadCallback)`、`onPause` 注销。
- **保留 android-x5 原有实现**：`keyEventAll`（Instrumentation）、onPause/onResume 的 JS 开关等一律不动——因该文件与 cctv-gao 属「双向分叉」，整体覆盖会引入 x5 不需要的改动。

**三、整体覆盖的 3 个文件（对齐 cctv-gao v4.5.24；已逐行 diff 确认互为超集）**
- `impl/WebViewClientImpl.java`：新增 `PageLoadCallback` 接口 + `notifyStarted/Finished/Error`；`onPageStarted/Finished` 注入链路（`pageFsBtn.js` → `cctvFullscreen.js`；yangshipin → `pageToastKill.js`）；脚本内存缓存。`shouldInterceptRequest` 的 m3u8 逻辑与 x5 **逐行相同**。
- `BaseWebViewActivity.java`：新增整套遮罩状态机（`sessionActive/sessionStartAt`、`showLoadingOverlay/hideLoadingOverlay/hideLoadingOverlayInternal/releaseOverlayForBrowsing/startLoadingTextTick/startFsPoll` + `FS_PROBE_JS` + `SESSION_STALE_MS` 计时修复），`onProgressChanged` 收罩分支、JsInterface 的 `showLoading/hideLoading`。
- `LiveActivity.java`：同上遮罩状态机 + `loadLiveUrl()`（切台即起会话）+ `killLoadingToastTail()`（清播放器「全力加载中」气泡）+ 换台防抖。

**四、JS（仅央视网/直播链路，不涉片库/栏目）**
- 覆盖 `assets/tv-web/js/cctvFullscreen.js`（含 `__DXTV_FS_DONE__` / `__DXTV_ENTERING_PLAYER__` / `__DXTV_FS_INJECTED__` 标记）。
- 新增 `assets/tv-web/js/pageFsBtn.js`、`assets/tv-web/js/pageToastKill.js`（两者均不依赖 `_browser`/`extractDomain`，纯自包含）。

**五、随整体覆盖一并带入的少量行为变化（均为 cctv-gao 已实测版本）**
- `closeApp` / `killAppProcess()`：由「强杀进程」改为 `finishAffinity()`（不再像闪退）。
- `LiveActivity`：换台防抖 `1000ms → 250ms` 并取消未落地换台；`mWebView.setBackgroundColor(Color.BLACK)`。
- 如不需要，可随时回退（备份见 `F:/github-dx/_backup_android-x5_bu2_20260916/`）。

**六、静态校验**
- 4 个改动 Java 文件括号 / 圆括号 / 方括号配平 **BALANCED**。
- 全树无 `com.tencent.smtt` / `IX5` / `getSettingsExtension` 残留；布局 id 与 Java 引用一一对应；`UpdateService` 调用签名（`initBaseFolder/initTvData/getByKey/getByUrl/liveNext/getByLivesWithFavorites`）全部存在。

**七、待实测**
本机无 Android SDK。请 **Clean → Build → 装包**，重点验证：① 央视网入口 / CCTV直播入口点节目·切台时遮罩秒数从 0.1s 正常增长（不再 4000s+）；② 央视片库 / 央视栏目不受影响；③ 央视网全屏正常。

---

## v4.5.24 (2026-09-16) - android-x5（X5版）：去除 X5/TBS 内核 + 去除自更新（第一步）

> 本次为 **Android 原生层**改造：按 cctv-gao 同法，第一步把 X5/TBS 内核与自更新彻底移除。
> 本工程与 cctv-gao 的唯一差异（**央视片库 / 央视栏目直连 m3u8 标清**）**全程零改动**。
> 第二步（脱壳遮罩 + 全屏）另起版本。

**一、去除 X5（腾讯 TBS 内核）**
- 删除 X5 SDK：`app/libs/tbs_sdk_thirdapp_v4.3.0.386_..._20230210_114429.jar`；`app/libs/` 现已清空。
- 删除 X5 专用类：`X5ProcessInitService.java`、`impl/X5WebChromeClientExtension.java`。
- 全部 `com.tencent.smtt.*` → `android.webkit.*`：
  - `BaseActivity`：`mWebView` 改系统 `WebView`；删 `getSettingsExtension()` 整块与抽象方法 `webviewSet(IX5WebSettingsExtension)`；`setUserAgent(` → `setUserAgentString(`。
  - `BaseWebViewActivity` / `LiveActivity` / `DouyinActivity`：删 `setWebChromeClientExtension(...)`、删 `webviewSet` 覆盖、`IX5WebChromeClient.CustomViewCallback` → `WebChromeClient.CustomViewCallback`；`DouyinActivity` 删 `getSettingsExtension()` 块（保留 `setBlockNetworkImage(true)` 无图行为）。
  - `impl/WebViewClientImpl`、`impl/WebChromeClientImpl`：仅换 import（`WebViewClient` / `WebChromeClient` / `ValueCallback` / `WebResourceRequest` / `WebResourceResponse` / `SslError(Handler)` / `RenderProcessGoneDetail` / `JsResult` / `JsPromptResult` / `PermissionRequest`）。
  - `MyApplication` / `util/Util`：换 import。
- `AndroidManifest.xml`：删除 X5 服务 `com.tencent.smtt.export.external.DexClassLoaderProviderService`。
- `app/build.gradle`：`minSdk 16 → 21`（系统 WebView 的 `shouldInterceptRequest(WebView, WebResourceRequest)` 需 API 21，与 cctv-gao 一致）。

**二、去除自更新（APK 自更新 + 远程资源下载）**
- 删除 `service/UpdateX5Service.java`（X5 内核下载器）。
- `StartActivity` 重写为极简启动页：不再请求配置接口、不再弹升级框、不再下载 X5 内核，仅延迟 200ms 进主界面（`to()`）；顺带修掉「服务端不通就卡启动页」与 `onKeyDown` 回调错用 `onKeyUp` 的问题；删除内部类 `UpdateHandler`。
- `res/layout/activity_start.xml` 同步精简：移除 `updateHandler` 数据变量与整块更新 UI（`startX5Wrapper`/`updateApkWrapper` 等），仅保留加载指示（`progressLoad`）。
- `service/UpdateService` 收敛为纯本地数据层：删除远程 `tv-web.zip` 下载/在线版本校验（`checkOnlineVersion`）与启动期 assets→filesDir 全量拷贝（`syncAssetsTvWeb`），只保留 `initBaseFolder` + `initTvData` / `getByKey` / `getByUrl` / `liveNext` / `getByLivesWithFavorites`。`UpdateService.updateRes(this)` 调用点（`BaseWebViewActivity` / `LiveActivity`）改为 `initBaseFolder(this)`。
- `BaseWebViewActivity` JsInterface：删除 `openX5`、`updateApk` 两个 H5 触发分支；`querySysInfo` 去掉同步网络请求（原 `ConfigApi.getConfig()`，JS 线程最长卡 5 秒）与 `haveNew` 计算，`setX5Ok(false)`。
- 清理：`BaseWebViewActivity` / `LiveActivity` / `MainActivity` 里的 `x5Ok()` 死方法、`ConfigApi.syncIsX5Ok(this)` 调用。

**三、保留 / 不损伤**
- **央视片库（`cctv.html`）、央视栏目（`column.html` + `js/cctvvideo`）**：源码、资源、数据**零改动**。
- 脱壳页注入（`WebViewClientImpl.getCctvFullscreenJs` → `assets/tv-web/js/cctvFullscreen.js`）、历史/收藏、数据层函数原样保留。
- `ConfigApi` / `ConfigDTO` / `ApkInfo` 等类保留（现已无调用方，X5-free，可编译）。

**四、静态校验**
- 全树 `grep`（源码 + 清单 + 构建脚本）：`com.tencent.smtt` / `QbSdk` / `X5ProcessInitService` / `UpdateX5Service` / `X5WebChromeClientExtension` / `getSettingsExtension` / `webviewSet` / `setWebChromeClientExtension` / `updateRes` / `setUserAgent(` / `IX5*` **源码端 0 残留**（仅 `app/build/` 旧构建产物与下述 proguard 注释/keep 行命中，前者下次构建自动重建）。
- `app/proguard-rules.pro` 的 `-keep class com.tencent.smtt.export.external.**` 等 X5 keep 行**按 cctv-gao 原样保留**（删除 jar 后为无害空规则，保持与 cctv-gao 模板完全一致；`tv.utao.x5.domain.**` 属另一包，与本 X5 无关）。
- 全部 11 个改动 Java 文件括号 / 圆括号 / 方括号配平校验 **BALANCED**。
- 首次试编译（用户 19:28）暴露 1 处包名误换：`impl/WebViewClientImpl` 的 `SslError` 被错改为 `android.webkit.SslError`，**已修正为 `android.net.http.SslError`**（`SslErrorHandler` 仍在 `android.webkit`），与 cctv-gao 对齐；随后全树复核其余 `android.webkit.*` / `android.net.http.*` 导入均无误。

**五、待实测**
本机无 Android SDK，未编译。请 **Clean → Build → 装包** 验证：① 冷启动直接进主界面；② 央视网入口 / CCTV直播入口正常播放；③ 片库 / 栏目不受影响。

**六、遗留（第二步）**
脱壳遮罩 + 全屏处理尚未移植（android-x5 现为「去 X5 / 去更新」后的干净底座），下一步对照 cctv-gao 移植遮罩状态机（含 `SESSION_STALE_MS` 计时修复）与全屏逻辑。

---

## v4.5.7 (2026-08-30) - 首页 5 入口图片再缩 20%（12.8vw → 10.24vw）

**改动**：`index.html` 内联 `<style>` 将 `#tv-index-content .tv-item img` 由 `12.8vw` 再缩 20% 至 `10.24vw`（12.8 × 0.8 = 10.24）。累计缩放链：16vw → 12.8vw → 10.24vw。仅作用首页 5 入口图标，**不动全局 `my.css` 的 `.tv-item img`（16vw）**，避免误伤片库（cctv.html）与栏目页（column.html）缩略图。图标保持正方形、成比例缩放不变形。

---

## v4.5.6 (2026-08-30) - 首页 5 入口图片缩小 20%

**改动**：`index.html` 内联 `<style>` 新增 `#tv-index-content .tv-item img { width: 12.8vw; height: 12.8vw; }`（原 16vw，缩 20%）。采用 `#tv-index-content` 作用域精准覆盖，仅作用首页 5 入口图标，**不动全局 `my.css` 的 `.tv-item img`（16vw）**，避免误伤片库（cctv.html）与栏目页（column.html）缩略图。图标保持正方形（16vw → 12.8vw 成比例缩放）。

---

## v4.5.5 (2026-08-29) - 恢复黄历观影祝福模块 + 农历模块与首页 5 入口增大行距

**恢复农历模块**：`index.html` 在 `lunar.js` 之后重新引用 `js/zhufu.js`（黄历观影祝福系统）。该脚本自初始化（监听 `DOMContentLoaded`，依赖 `window.Lunar`），在 `body` 末尾注入 `.almanac-container` 农历模块，无需额外代码改动。

**增大行距**：
- 农历模块（`js/zhufu.js` `almanacStyles`）：`body` 整体 `line-height` 1.3→1.5；`.header/.date-display/.god-positions/.god-item` 1.2→1.6，`.blessing` 1.25→1.7；各区块 `margin` 同步放大（标题 6→12px、日期/祝福 5→10px、吉神 8→14px），容器与上方 5 入口间距 `margin: 0 auto`→`2.5vh auto`。
- 首页 5 入口（`index.html` 内联 `<style>`，仅作用于 `#tv-index-content`）：`.tv-item` 纵向 `margin` 0.8→1.4vh，标签 `span` `line-height` 1.9、`margin-top` 1vh，图标与文字呼吸感更足。

---

## v4.5.4 (2026-08-29) - 栏目页遥控器焦点根治（v-show 换 :style + move-updown-id 静态化 + 直接落焦点）

**问题**：实测「央视栏目」进入任一级节目列表（vods 视图）后，遥控器方向键无反应，鼠标操作正常。

**根因**：
1. `column.js` 使用 `v-show` 切换 cats/vods 两视图，但当前 `vuex.min.js` 构建版不保证支持 `v-show`，导致两视图可能同时渲染、互相干扰；`TvFocus.rescueFocus()` 依 `style.display` 判可见，会误把隐藏视图当可见。
2. `move-updown-id` 用动态绑定 `:move-updown-id="'col-'"`，PetiteVue 编译后可能未落属性，使 `TvFocus.idFound()` 失效。
3. `_focus()` 仅通过 `window.__setFocus` 间接落焦点，若 `PetiteVue` 代理或时序异常，焦点框无法稳定加到 DOM。

**修复**（`js/cctvideo/column.js`）：
- `v-show` 全部替换为 `:style`（cats 视图 `flex/grid`，vods 视图 `none`），与已验证的片库 `js/home.js` 视图切换模式一致，确保 `rescueFocus()` 只扫当前可见内容。
- `move-updown-id="col-"` / `move-updown-id="vod-"` 改为静态属性，彻底规避动态绑定不确定性。
- `_focus()` 改为元素就绪后**直接** `TvFocus.curFocusId = id; TvFocus.applyFocus(id)`，再兜底调用 `__setFocus`；即使 Vue 代理异常也能落焦点。
- 顶部补 `const _ctrlx = {};`，避免 myfocus.js 的 `ok()/menu()` 在 `_ctrlx` 未定义时触发 ReferenceError。

---

## v4.5.3 (2026-08-29) - 片库去综艺空分类 + 栏目页 vods 遥控器焦点修复

**片库去综艺**：`js/cctvideo/home.js` `channels()` 删除 `zy`「综艺」频道（央视接口该分类已无节目），片库从 5 类降为 4 类——电视剧 / 动画片 / 纪录片 / 特别节目。

**栏目页 vods 焦点修复**（`js/cctvideo/column.js`，对齐已验证的片库 `js/home.js` 焦点模式）：
- cols / vods 的 `tv-item` 补 `:move-updown-id`（`'col-'` / `'vod-'`）前缀定位属性，使 `TvFocus.idFound()` 走前缀+数字偏移 O(1) 精确定位，避免 DOM 兄弟遍历在异步渲染场景下的不确定性。
- 重写 `_focus()`：增加 `getElementById(id)` 元素存在性检测，元素未就绪时每 100ms 重试（最多 2.5s），根治 PetiteVue 异步渲染 100 个带图单集卡片完成前调用导致焦点框落空。
- `openColumn()` 切 `view='vods'` 后立即 `_focus('back-cats')` 落焦点到返回栏，消除「进入单集列表空档期」遥控器全失焦。

---

## v4.5.2 (2026-08-29) - 首页新增「央视栏目」单入口（替换特别节目）

**新入口**：首页「特别节目」替换为「央视栏目」（`index.js` `apps()`），图标 `img/lanmu.png`，跳转 `column.html`。入口内分 4 类——新闻 19 / 少儿 18 / 综合 60 / 综艺 48，共 145 个栏目（`js/cctvideo/columns.js`，`window._CCTV_COLUMNS`，含栏目名 + TOPC id）。

**栏目页**（`column.html` + `js/cctvideo/column.js`）：两视图——`cats` 类别清单（4 类标签栏 + 栏目卡片文字块）、`vods` 单集清单（缩略图 `move-updown="5"` 五列）。数据走央视接口 `NewVideo/getVideoListByColumn?id=TOPC...&p=1&n=100&sort=desc&mode=0&serviceId=tvcctv`（PAGE=100 单次拉最新集，不分页）；单集点击 `live.html?guid=...&name=...` 复用现有取流播放链路，无需另建 hls 解析。返回键覆盖 `TvFocus.keyBackEvent`：vods→栏目清单，cats→首页。

**删除特别节目**：`index.js` 删 `PASSWORD_CONFIG` 密码验证与「特别节目」密码分支；删 `tebie.html`、`js/cctv/tebie.js`、`js/cctv/tebie.json`、`img/tebie.png`（已备份至 `_backup_tebie_20260829/`）。

**取消农历观影祝福**：`index.html` 删 `js/zhufu.js` 引用（黄历观影祝福系统下线），保留 `lunar.js`；`zhufu.js` 文件暂留未删，恢复仅需加回一行引用。

---

## v4.5.1 (2026-08-28) - 央视片库分页遥控焦点根治（末页失焦/死链）

**现象**：机顶盒遥控器在央视片库分页区三类病症——① 末行下移到不了「下一页」（仅鼠标可点）；② 进入末页光标停在「下一页」，OK 后四向键全死、仅返回键退主页；③ 列表区内按上键回不到顶部三行（筛选/年代/频道）。

**根因与修复**：
- **末行→下一页断链**（`myfocus.js` `idFound()` line 248）：下行目标不存在时改返 `null`（原返 `elem`），使 `next()` 进入 DOM 兄弟遍历兜底，从末行稳定落到 `tvnext`。网格内下移（foundId 存在）、上移、顶部导航均不变。
- **列表区回不了前三行**（`home.js` line 37）：`move-up` 此前被误改为无 `#` 的 `tv-tv`（jQuery 当标签选择器选不到），复原为 `tvId(item.tag,'#tv-')`（=`#tv-tv` 真实频道行）。上键链路恢复：列表首项→频道行→年代行→筛选行。
- **末页死按钮方案**（`home.js` line 37）：末页「下一页」按钮保留显示、文案切 `{{hasNext(item)?'下一页':'没了'}}`，OK 由 `loadMore` 首行 `noMore` 保护天然无反应，避免隐藏按钮致焦点悬空。
- **病毒包扩散**（`home.js` line 132 新增 `hasNext(item)`）：原「没了」文案绑 `noMore` 持久标志，翻回上一页仍误显「没了」并挡死翻页。改为 `hasNext = (page+1)*PAGE < allVods.length || !noMore`——仅真末屏显示「没了」，其余各页「下一页」职能完好。
- **末页光标落点**（`cctvideo/home.js` `_focusPager` line 152）：翻入末页光标自动落「上一页」（`tvId('prev')`）；第 1 页无「上一页」按钮时（line 186 `page>0` 守卫）改落「下一页」，防悬空死链。
- **翻回被挡死**（`cctvideo/home.js` `loadMore` line 170）：`noMore` 保护由一刀切 `if(noMore) return` 收窄为「本地无下一页 **且** 数据源到底」才 return，本地有数据可正常切片翻回。
- **悬空根治（覆盖一切边角）**（`myfocus.js` `getFocus` line 168 + `rescueFocus` line 176）：按键入口兜底——`curFocusId` 指向元素已不存在即自动转移至当前可见频道的「上一页→下一页→列表项」，根治所有「焦点指向已删元素」场景。

**收官纯洁化**：删除「已经到底了」独立假按钮与 `noMore()` 死方法、`_bak` 备份、过时注释与战役口语；三文件 `node --check` 全过。

**实测结论**：不点末页「下一页」→回路全程畅通；点了偶现「没了」露头（罕见、无害），主公令见好就收、不再修改。

---

## v4.5.0 (2026-08-27) - 央视片库「年代筛选 + 真翻页」

**年代筛选（5年区间，早年合并）**：顶部新增年代栏 `全部|1999前|2000-2004|2005-2009|2010-2014|2015-2019|2020-2024|2025-2026`。央视接口仅支持单年 `year=N`、不支持区间参数（实测 `yearStart/yearEnd`/`fromYear` 等全无效），故区间由前端并发拉该区间各单年（`fc=频道&year=Y`）合并；`1999前` 拉全量后客户端过滤 `year<=1999`。

**真翻页（替换语义，恒一页）**：重构为统一 `allVods` 模型——`channelPage` 重置当前视图，`_loadRemote`（全部视图）远程真分页追加到 `allVods`、`_loadYearRange`（区间视图）合并全区间进 `allVods`；`loadMore`/`prevPage` 用切片（`allVods.slice(page*100,+100)`）显示当前屏，`vods` 恒约一页，切频道/切年代即释放，不跨视图堆积、缓存仅首屏写（不写续页）。

**其他**：`n=200`→`n=100`（接口上限，超量静默截断）；去 `detail` 自动预加载（纯「上一页/下一页」按钮驱动）；序号改全局 `vod.seq`（每屏显示真实全局序号）；加「上一页」按钮（首屏禁用）。

## v4.4.9 (2026-08-27) - 央视片库「下一页」去重：缓存与翻页拆离（方案B）

**根因**：原 `channelPage` 将「首屏缓存秒显」与「翻页远程加载」混在同一函数，且缓存命中分支无条件把缓存整批 push 进 vods、强制 `pageNum=1` 并返回。点「下一页」(`nextPage`) 或滚动触发自动预加载 (`detail`) 时同样调用 `channelPage`，误命中首屏缓存→重复 append 同一批 106 条、`pageNum` 永远锁在 1 → 内容 107=1。实测央视接口 `p` 翻页正常（p=1/2/3 内容各异），问题纯在前端缓存误命中。

**修复（方案B·拆离）**：
- `js/cctvideo/home.js`：拆出 `loadMore()/_loadRemote()`。首屏 `channelPage` 仍走缓存秒显；`nextPage`/`detail` 改调 `loadMore`，**永远走远程 `p=pageNum+1`、不读缓存**，拉真实下一页。
- 写缓存仅限首屏（`pageNum===1`），翻页累积数据不写入，避免下次进页面秒显爆量。
- 清理冗余变量 `channelName`。

---

## v4.4.8 (2026-08-27) - 放弃火锅随喜页机顶盒遥控，改纯点击导航

**放弃机顶盒遥控（回退早前方案）**：`kuxuan.html`/`dsm.html` 移除 `window.__cctvKey` 与 `keydown` 双路遥控代码及 `tv-focus` 焦点样式；`BaseWebViewActivity.dispatchKeyEvent` 回退为仅 `live.html` 派发（火锅随喜页走原生通道，不加载遥控）。机顶盒上这两页无遥控焦点，仅以触屏/鼠标点击交互。

**导航重构（支持我→打赏码→火锅）**：首页「支持我」入口 `index.js` 由 `kuxuan.html` 改为 `dsm.html`（打赏码）。`dsm.html` 新增无 tabindex 的「返回火锅页」触屏入口（→`kuxuan.html`），机顶盒 DPAD 不可聚焦故进不了火锅页。`kuxuan.html` 两按钮名称互换、位置不变：左「去随喜吧」→`dsm.html`，右「再辣点儿哈！」→辣椒特效。

**按钮间距**：`kuxuan.html` 两按钮 `gap` 维持 80px（模拟器已确认合适）。

---

## v4.4.7 (2026-08-27) - 高清不降级 + 代码瘦身 + 进出列表加速

**高清不降级（#77）**：移除 `degradeToSd` 自动降级（原 `error`/`waiting≥8s` 即降标清，机顶盒缓冲常超 8 秒→一进就标清）。现固定 2000 高清直链，永不降级（`live.js` 删 `_quality`/`_autoSd`/`_stallTimer`/`sdUrl` 及 `player.on error/waiting` 降级监听）。

**代码瘦身（#78）**：删 `index.html` 埋点脚本 `js/com/js-sdk-pro.min.js` 及 `index.js` 的 `LA.init` 初始化。注意：`lunar.js`(428KB)+`zhufu.js`(16KB) 为**首页农历/黄历观影祝福模块**所依赖（zhufu.js 用 `window.Lunar`），须保留；`vuex.min.js` 实为 PetiteVue 框架本体，须保留。真实减重约 20KB（仅埋点）。

**进出列表加速（#79）**：`cctv.html` 节目数据 `sessionStorage` 缓存——退出播放 `history.back` 重建页面时秒显缓存，不再等远程 200 条 JSON；后台静默刷新。

---

## v4.4.6 (2026-08-27) - 选集换源 + 面板自动隐藏 + 单一事件源治理

**选集换源成功（核心修复）**：切集改用 `player.switchURL()`（xgplayer-hls 专用切源 API）。
此前 `player.load()` 在已播放态不重载 HLS，导致选集点中后画面不切换（静默失效）。

**面板自动隐藏**：选集换源成功后延迟 3 秒自动隐藏面板（B 案：switchURL 异步、无法确认画面已切换成功，故延迟隐藏），无需返回键。

**单一事件源治理（化繁为简）**：移除全部兜底——
- `BaseWebViewActivity.onBackPressed` 返回拦截
- `live.js` 的 `document keydown` 监听
- `__cctvKey` 内的返回键分支（history.back / closePanel）

仅保留 `MainActivity.dispatchKeyEvent → window.__cctvKey` 单一派发；返回键交回 Android 默认退出播放页。

**交互模型**：播放页唯一焦点「选集」（默认金边高亮）→ OK 弹出面板 → 方向键选集 → OK 换源 → 3 秒后面板自动隐藏。高清优先固定 2000 直链，卡顿临时降 1200（切集即恢复，不再永久锁死）。

**清理**：删除本轮堆叠的 `[道玄][将军]` 考古注释与被注释死代码；修正 `BaseWebViewActivity` 派发注释。

---

## v4.4.5 (2026-08-26) - 选集遥控派发根治

- **根因**：`BaseWebViewActivity.dispatchKeyEvent` 用 `wv.evaluateJavascript("javascript:if(window.__cctvKey)...")` 派发，但 `evaluateJavascript` 不应带 `javascript:` 前缀（那是 `loadUrl` 写法）→ 整条报错、`__cctvKey` 从未被调用。
- **修复**：去掉 `javascript:` 前缀，派发生效；统一单一事件源（仅 Android 层 `dispatchKeyEvent` 经 `__cctvKey` 派发），保留 120ms 同键去抖。

---

## v4.4.4 (2026-08-26) - 清理 live.html 的 utao 残留 common.js 引用

- 删除 `live.html` 对不存在的 `js/common.js` 的 `<script>` 引用（消除 404 报错）。取流走 Java 层 `addJavascriptInterface` 注入的 `window._api`，与 common.js 无关。

---

## v4.4.3 (2026-08-26) - 画质真修复（高清直链）+ 选集去抖

- 高清固定 `toBr(raw,'2000')` 直链（HEAD 200 实测有效），弃用主链自适应；sd 固定 `toBr(raw,'1200')`。
- `window.__cctvKey` 加 120ms 同键去抖，消除系统 WebView 与 Android 层双触发导致的选集乱跳。

---

## v4.4.2 (2026-08-26) - 高清优先修正 + 遥控选集聚焦

- 高清优先用主链交给 hls.js 自适应；仅在 error/缓冲≥8s 时降 1200。
- 暴露 `window.__cctvKey(code)`，由 `dispatchKeyEvent` 直接派发，绕开 X5 不派发 keydown 的坑。

---

## v4.4.1 (2026-08-26) - 播放页遥控链路根治

- 真因：X5 内核默认不把遥控 DPAD/OK 合成网页 keydown，网页监听收不到；且非面板态 `return` 吞掉返回键。
- `BaseWebViewActivity` 新增 `dispatchKeyEvent`，对 `live.html` 页把按键映射为 webCode 经 `evaluateJavascript` 派发；首页不影响。`home.js` 首页改零等待直跳播放页。

---

## v4.4.0 (2026-08-26) - 机顶盒专项：去黄底 + 选集焦点 + 高清优先 + 加速

- 原生布局 WebView 容器黄底改为深蓝 `#0A1F3A`（activity_*.xml + `setBackgroundColor`）。
- 移除 `getFullscreen().request()` 自动全屏，保留「选集」HTML 浮层常驻可见。
- 画质：高清优先 + 卡顿降级；`home.js` 直带 guid 加速进入播放页。

---

## v4.3.9 (2026-08-26) - 选集页内切源（player.load）

- `playEpisode` 改 `player.load(hls)` 页内切源（丝滑不重载）；黄底兜底（务必 Clean→Build 装包）。

## v4.3.8 (2026-08-26) - 切集根治：原生桥取流 + 整页重载

- `live.html` 引 `common.js` 获 `_apiX.getJson` 原生桥取流；切集改整页重载 `live.html?url=` 复用已验证路径。

## v4.3.7 (2026-08-26) - 选集切集不换源修复

- 播放页取流改走原生桥 `window._api.getJson`（带 tv-ref、绕 CORS），替代被 CORS 拦截的裸 XHR。

## v4.3.6 (2026-08-26) - 片库选集下沉播放页（央视网式）

- 列表页去选集层；播放页内「选集」按钮 + 底部面板 + 自动连播下一集。

## v4.3.5 (2026-08-26) - 选集层被 wait 浮层卡住修复

- `_layer.wait()` 生成的浮层 z-index 9999999 盖住选集层；`home.js` 保存 waitId 并 `_layer.close(waitId)`。

## v4.3.4 (2026-08-26) - 栏目扩展：新增「综艺」栏

## v4.3.3 (2026-08-26) - 央视片库选集菜单

## v4.3.2 (2026-08-26) - 清理 utao 残留米黄全局背景（rset.css #FAF9DE→#0a1f3a）

## v4.3.1 (2026-08-26) - 回滚取流改动 + 放弃亮剑修复（个别 CDN 403，非客户端可解）

## v4.3.0 (2026-08-25) - 复活央视片库流畅播放（脱壳→直链）

- `goto()` 加 `site==="cctv"` 分支走 `playCctvVod`；`live.js` 取值 `decodeURIComponent` + 片库 VOD 设 `isLive:false`。

---

## v4.2.5 (2026-08-25) - 移除央视网 1905 两频道（实测无法播放）

## v4.2.3 (2026-08-25) - 历史功能 Java 死支清理（删片库向 History 死法，保留直播记台）

## v4.2.4 (2026-08-25) - 清理 HistoryDao 五孤儿方法

## v4.2.2 (2026-08-25) - 仓库孤儿清理（自循环死簇删除）

## v4.2.1 (2026-08-24) - 特别节目返回流程修复（WebView 历史栈逐级返回优先）

## v4.2.0 (2026-08-24) - 支持我页整治 + 随喜页定型 + 代码清理

## v4.1.0 (2026-08-23) - 启动/退出体验修复 + 频道精简（去 1905、退出对话框整改、dxds.apk）

## v4.0.0 (2026-08-22) - 道玄电视·去 utao 化重构（包名统一、图标替换、五入口重命名、古风水墨）

---

## v1.0.1 (2025-10-03) - TV 遥控器优化（退出对话框焦点导航、按键优先级）

## v1.0.0 (2025-10-03) - 初版：退出对话框 + 启动首页切换 + 智能启动逻辑
