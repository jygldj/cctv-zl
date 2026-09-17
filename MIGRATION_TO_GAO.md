# cctv-zl 整树对齐 cctv-gao —— 回补清单（第 1 步 · 只读产出）

> 生成时间：2026-09-17
> 状态：**尚未动手改任何代码**。本文件是"用 gao 替换 zl"之前的差异盘点，供决策。
> 基线：cctv-gao/android-gao（封版 v4.5.24，含待实测的 v4.5.25 流畅度优化）

---

## 一、结论先行

方案**可行**，但要按"文件"替换，不能按"入口"删。

两工程内核基础一致（都无 X5/TBS 依赖，同为系统 WebView），
Java 层 **61 个文件路径完全一致**，其中 **32 个内容完全相同**，只有 29 个有差异。

真正需要人工判断的只有 **3 项**（见第四节标 ⚠️ 的），其余要么可丢、要么 gao 版本更好。

---

## 二、可整块替换（无任何风险）

| 范围 | 数量 | 说明 |
|---|---|---|
| `app/src/main/java/**` | 61 个文件 | 路径一一对应，零适配成本。其中 32 个本来就相同 |
| `app/src/main/res/**` | 布局/资源 | 需单独核对，见第六节 |
| JS 注入链 | 12 个脚本 | 见第三节 |

**JS 侧文件名清单两边完全一致** —— zl 仅多出 `begin.js` 与 `pageTidy.js`（后者是今天为修顶部遮罩新加的），
gao 无独有脚本。

---

## 三、必须保留的 zl 文件（替换后要回补）

| 文件 | 原因 |
|---|---|
| `tv-web/cctv.html` | 央视片库。zl 版 715B 比 gao 版 649B 多一行深蓝背景 `html,body{background:#0a1f3a}` |
| `tv-web/column.html` | 央视栏目。两边大小相同（1338B），但保留 zl 版保险 |
| `tv-web/dsm.html` | **支持我。gao 完全没有**（gao 的"支持我"指向 `kuxuan.html`） |
| `tv-web/js/cctv/tv.json` | 频道数据。zl 87141B 比 gao 85043B 多 2098B，频道更全 |
| `tv-web/js/xg/` | 地方台 `iapp`/`iapp2`/`jxntv`/`sctv` 的 live.html 依赖它。两边目录组织不同，保留 zl 版 |
| `tv-web/js/cctvideo/*` | 片库/栏目的依赖（`cctv.html` 引用 `home.js`，`column.html` 引用 `columns.js`+`column.js`） |
| `tv-web/kuxuan.html`、`huo.js`、`ya.js` 等 | zl 自有页面/脚本，gao 无对应或内容不同 |

**入口改动**：`js/index.js` 第 5 个入口必须改回 `dsm.html`（gao 版写的是 `kuxuan.html`）。

---

## 四、zl 独有待评估项（替换后会丢失，逐条判断）

### ❌ 明确不回补（4 项，回补反而更差）

| # | 项目 | 判断理由 |
|---|---|---|
| 1 | `RESET_STALE_TVLOAD_JS` + 早注入（v4.5.34） | **已实测证伪**。上一版打包验证过：早注入已在包内、地方台依旧 90% 不脱壳。gao 的早注入本来就存在且更简洁 |
| 2 | 早注入额外排除 `yangshipin.cn` | gao 不排除，其实测 CCTV直播入口表现与 zl 一致（都有顶部遮罩），排除与否无收益 |
| 3 | yangshipin 整链复用（v4.5.31，type==1+ysp → load_detail_video.js） | gao 无此逻辑，但央视源2/卫视/地方台均正常，说明不需要 |
| 4 | `BaseActivity` 的 `Instrumentation` 模拟按键 | **gao 版本更好**。gao 注释明确：原用 `Instrumentation.sendKeySync`，普通应用无 `INJECT_EVENTS` 权限会直接抛异常，已改掉；zl 仍在用 |

### ✅ 回补后是净收益（2 项，gao 版本更优）

| # | 项目 | 收益 |
|---|---|---|
| 5 | `setWebContentsDebuggingEnabled(true)` 恒开 | gao 改为 `BuildConfig.DEBUG`。**release 包不再常开调试通道 —— 这是 zl 慢 3~5 秒的实锤之一** |
| 6 | `setSupportMultipleWindows(false)` / `OVER_SCROLL_NEVER` / `setDefaultTextEncodingName("UTF-8")` | zl **一处都没有**（gao 有 2 处）。省加载期开销，避免遥控器误触页面滑动 |

### ⚠️ 需要人工确认（3 项）

| # | 项目 | 现状 | 建议 |
|---|---|---|---|
| 7 | `LiveActivity` 浮层 4 秒自清（v4.5.29，`STALE_NAME_CLEAR_MS=4000L`） | gao 有 `liveName.setText("")` 但**无定时自清**。zl 这处修的是"频道名 X% 卡死" | **倾向回补**。若实测出现浮层卡死再补也来得及，但先补上更保险 |
| 8 | `WebChromeClientImpl` 的 JS 弹窗对话框（alert/confirm） | zl 支持，gao 不支持 → 站点弹窗会被直接吞掉 | **倾向回补**。若某个站点靠 `confirm` 确认才能起播，缺了会卡住 |
| 9 | `BaseActivity` 的 `onRequestPermissionsResult` 权限回调 | 影响外置存储权限申请 | 需确认 gao 是否用别的方式处理；若 gao 无此逻辑且运行正常，可不补 |

### 🟢 可直接丢（1 项）

| # | 项目 | 理由 |
|---|---|---|
| 10 | `MyApplication.initPieWebView()` | 该方法是为 Android 9+ **多进程** WebView 数据目录隔离。**两工程 Manifest 均无 `android:process`，都是单进程**，非必需 |

---

## 五、替换后自动获得的 gao 收益

1. **流畅度优化（gao v4.5.25）**：注入脚本静态缓存（zl 也有，两边都有 11~12 处）、换台防抖 250ms（两边都有）、**WebView 性能设置（zl 缺，见上表 #6）**、**release 关调试（zl 缺，见上表 #5）**
2. `LiveActivity` 更简洁的遮罩计时逻辑（gao v4.5.24 专门修过"一上来就 4000s+"）
3. `keyEventAll` 不用 Instrumentation，避开权限异常
4. 地方台脱壳：差异锁定在 `load_detail_tv.js` + `tv/common/detail.js`，整树对齐后一并解决

---

## 六、还没核对的部分（第 2 步开工前必须补）

- `app/src/main/res/**`（布局、drawable、values）：本次未做全量对比
- `app/build.gradle`：两边 `applicationId` 不同（zl=`com.daoxuan.cctv`，gao=`com.daoxuan.cctv.web`），**替换时不能动这一行**
- `AndroidManifest.xml`：两工程 Activity 声明一致，但 zl 多了网络安全性配置等，需逐行核对
- `js/begin.js`（zl 独有，127B）：需确认被谁引用

---

## 七、执行顺序（待批准）

1. ✅ 第 1 步：差异盘点（本文件）
2. ⬜ 第 2 步：备份 zl 现状 → 整树替换 Java（61 个）+ JS 注入链（12 个）
3. ⬜ 第 3 步：回补第三节的保留文件 + 第四节标 ✅/⚠️ 的项目
4. ⬜ 第 4 步：`node --check` + 括号配平校验 → Clean → Build → 装包实测
5. ⬜ 第 5 步：实测重点 = 地方台脱壳 / 顶部遮罩 / 起播速度 / 片库栏目回归

---

## 八、风险提示

1. **克隆解决不了 CCTV直播入口的顶部遮罩** —— 用户实测确认 gao 的该入口**同样有遮罩**，会原样带过来，需单独治。
2. **必须改 `applicationId`** —— 保持 zl 的 `com.daoxuan.cctv`，否则与已装版本冲突。
3. **签名**：`app/build.gradle` 里的 `storeFile` 路径指向已不存在的目录，打包前需自行放好 jks（本次未动签名配置）。

---

## 九、执行记录（2026-09-17 14:40）

### 回滚点

物理备份：`F:\github-dx\_backup_cctv-zl_20260917_1438\`（java + tv-web + Manifest + build.gradle，共 171 文件 / 3.9M）。
覆盖未提交改动，比 git 分支可靠。

### 已执行

| 步骤 | 内容 | 结果 |
|---|---|---|
| 资源兼容预检 | gao Java 引用的 `R.xxx` 在 zl res 中是否都存在 | ✅ 全部存在。此前脚本报的 6 个 `R.id` 缺失是误报（只扫文件名、未解析 XML 内 `@+id/`）；`simple_list_item_1` 是 `android.R` 系统资源 |
| Java 层 | 61 个文件整树替换为 gao 版 | ✅ |
| JS 注入链 | 15 个脚本替换为 gao 版 | ✅ |
| 入口修正 | `index.js` 第 5 入口 `kuxuan.html` → `dsm.html` | ✅ |
| 回补 #7 | `LiveActivity` 浮层 4 秒自清 | ✅ 已加常量 + `case 3` + 进度回调顺延 |

### 清单更正（两处误判，实际无需回补）

| 原判 | 复查结果 |
|---|---|
| #8 `WebChromeClientImpl` JS 弹窗 | **误判**。gao 同样有 `onJsAlert/onJsConfirm/onJsPrompt`；且 zl 那处 AlertDialog 代码是**注释掉的死代码**，实际只 `return true`，两边行为一致 |
| #9 `BaseActivity` 权限回调 | **误判**。gao 也有，用的是 `PermissionUtil.REQUEST_EXTERNAL_STORAGE` |

### 保持 zl 原版未动（已逐一验证）

`cctv.html` / `column.html` / `dsm.html` / `js/cctv/tv.json` / `js/xg/` / `js/cctvideo/`
`AndroidManifest.xml` / `res/` / `applicationId`（仍为 `com.daoxuan.cctv`）

### 校验

- Java 61 个文件：剥离注释与字符串后**括号全配平**
- JS 15 个脚本：`node --check` **全部通过**
- 片库兼容：gao 版提供的全局符号完整覆盖 zl 原版，**零丢失**

### 有意保留的"未挂载"状态

`js/pageTidy.js`（v4.5.37 为顶部遮罩新写的清理器）**文件保留，但不挂到链上** ——
gao 版 `load_detail_tv.js` / `load_detail_video.js` 没有它的挂载点。
理由：这次要先得到一份**纯净的 gao 行为**做对比基准；且该脚本实测"效果不明显"。
若实测后确认仍需它，只需在两处链尾补挂载点即可。
