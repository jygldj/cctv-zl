const _appVersion = {
    16: "4.1",
    17: "4.2",
    18: "4.3",
    19: "4.4",
    20: "4.4W",
    21: "5",
    22: "5.1",
    23: "6",
    24: "7",
    25: "7.1",
    26: "8",
    27: "8.1",
    28: "9",
    29: "10",
    30: "11",
    31: "12",
    32: "12L",
    33: "13",
    34: "14",
    35: "15"
};

function getAndroidName(version) {
    if (version < 16) {
        return "小于安卓4.1";
    }
    if (version > 35) {
        return "大于安卓15";
    }
    return "安卓" + _appVersion[version];
}

const _html = {
    init() {
        /* [v4.5.26 / v4.5.27] 兜底：无论何种原因回到首页（WebView 历史回退 / bfcache 恢复 /
           跳转没落地 / 前后台切换），都把可能残留的「等待跳转...」遮罩收掉，
           避免首页卡死、遥控焦点无法恢复。
              · pageshow          : bfcache 恢复（goBack 回退到首页）
              · popstate          : 历史栈变化
              · visibilitychange  : 从后台切回前台
              · 6 秒看门狗         : 兜住上面三条都覆盖不到的漏网情况（见 waitAndGo） */
        const closeWait = function () {
            try {
                if (window.__tvWaitId != null && window._layer && window._layer.close) {
                    window._layer.close(window.__tvWaitId);
                }
            } catch (e) {}
            window.__tvWaitId = null;
        };
        window.__tvCloseWait = closeWait;
        try { window.addEventListener("pageshow", closeWait); } catch (e) {}
        try { window.addEventListener("popstate", closeWait); } catch (e) {}
        try {
            document.addEventListener("visibilitychange", function () {
                if (!document.hidden) { closeWait(); }
            });
        } catch (e) {}
        this.initApp();
    },
    initApp() {
        console.log("initAppinitApp");
        PetiteVue.createApp({
            apps: [],
            focusId: "",
            info: {
                sys: "当前系统",
                version: "当前版本",
                x5Ok: true
            },
            initData() {
                _data.initData(this);
                // [道玄] 机顶盒 X5 webview 渲染时序差异，$nextTick 内 #app-0 可能尚未挂载导致 .tv-focus 未加上，
                // 焦点框架 focus-home.js 取 $(".tv-focus") 为空 → 方向键失效。改用 setTimeout 兜底并判存在。
                const addFocus = () => {
                    const first = document.getElementById("app-0");
                    if (first) {
                        first.classList.add("tv-focus");
                        console.log("[焦点] app-0 已加 tv-focus");
                    } else {
                        console.error("[焦点] #app-0 未渲染，100ms 后重试");
                        setTimeout(addFocus, 100);
                    }
                };
                this.$nextTick(addFocus);
                setTimeout(addFocus, 300);
            },
            appChoose(item) {
                console.log("appChoose  " + item.name);
                try { _apiX.toast("探针:点击了[" + item.name + "] url=" + item.url); } catch (e) { console.error(e); }
                console.log(`appChoose item ${item.name} ${item.url}`);
                let dataUrl = item.url;
                if (_utao_version && (_utao_version === "{version}" || _utao_version <= 20)) {
                    this.waitAndGo(dataUrl);
                    return;
                }
                if (dataUrl === "tv.html") {
                    // 央视网入口无条件直接进 LiveActivity，默认加载 cctv13，避免进入 tv.html H5 平铺列表页
                    try { _apiX.toast("探针:央视网进LiveActivity分支"); } catch (e) { console.error(e); }
                    _apiX.msgStr("activity", "live");
                    return;
                }
                this.waitAndGo(dataUrl);
            },
            /**
             * [v4.5.26] 等待层 id 必须留档：页内跳转一旦被取消、或从别的页面历史回退 /
             * bfcache 恢复到首页，这个「等待跳转...」遮罩会一直挂在屏幕上（实测首页卡死）。
             * 留档后交给 init() 里注册的 pageshow 兜底收掉。
             */
            waitAndGo(dataUrl) {
                try { window.__tvWaitId = _layer.wait("等待跳转..."); } catch (e) { window.__tvWaitId = null; }
                /* [v4.5.27] 看门狗：跳转没落地（被原生拦下 / 加载失败 / 被取消）时，
                   6 秒后自动收掉等待层，否则首页会一直挂着「等待跳转...」且遥控焦点失效。 */
                setTimeout(function () {
                    if (window.__tvCloseWait) { window.__tvCloseWait(); }
                }, 6000);
                window.location.href = dataUrl;
            },
            tvId(value, pre) {
                if (pre) {
                    return pre + value;
                }
                return 'tv-' + value;
            }
        }).mount('#tv-body');

        // [道玄] 启动焦点框架：全工程此前从未 new FOCUS(...)，focus-home.js 是死代码，
        // 导致机顶盒上 index 页 5 入口无遥控焦点(仅原生返回键能调右侧页)。此处实例化并绑定 OK 键。
        try {
            new FOCUS({
                event: {
                    keyOkEvent: function () {
                        const f = document.querySelector(".tv-focus");
                        if (f) { f.click(); }
                    },
                    keyBackEvent: function () {
                        // 返回键交原生 Activity 处理(右侧1/3退出页)，JS 不拦截，避免双击
                    }
                }
            });
            console.log("[焦点] FOCUS 框架已实例化");
        } catch (e) {
            console.error("[焦点] FOCUS 实例化失败", e);
        }

        // 兜底：部分 TV/模拟器环境下 Vue/PetiteVue @click 与 myfocus 的 trigger("click") 可能不触发 appChoose，
        // 故在央视网卡片（apps[0] → id=app-0）渲染完成后挂原生 click / 遥控器 OK(Enter) 兜底，直接进 LiveActivity。
        setTimeout(function () {
            try {
                const cctvCard = document.getElementById('app-0');
                if (cctvCard) {
                    const goLive = function (e) {
                        try {
                            if (e) e.preventDefault();
                            _apiX.toast("兜底:央视网直接进LiveActivity");
                            _apiX.msgStr("activity", "live");
                        } catch (err) { console.error(err); }
                    };
                    cctvCard.addEventListener('click', goLive);
                    cctvCard.addEventListener('keydown', function (e) {
                        if (e && (e.key === 'Enter' || e.keyCode === 13 || e.keyCode === 23)) goLive(e);
                    });
                } else {
                    console.error("兜底:未找到 #app-0 卡片，apps 可能未渲染");
                }
            } catch (e) { console.error(e); }
        }, 500);
    }
};

let _data = {
    vue: null,
    initData(vue) {
        this.vue = vue;
        this.apps();
    },
    apps() {
        let apps = [];
        const isGecko = _tvFunc.isGecko();
        console.log("isGecko", isGecko);
        apps.push({ id: 0, url: "tv.html", name: "央视网", pic: "img/ysw.png" });
        apps.push({ id: 0, url: "https://www.yangshipin.cn/tv/home?pid=600002475", name: "CCTV直播", pic: "img/ysp.png" });
        apps.push({ id: 0, url: "cctv.html", name: "央视片库", pic: "img/yspk.png" });
        apps.push({ id: 0, url: "column.html", name: "央视栏目", pic: "img/lanmu.png" });
        apps.push({ id: 0, url: "dsm.html", name: "支持我", pic: "img/dsm.png" });

        apps.forEach((item, index) => {
            item.id = index;
            item.pic = _tvFunc.image(item.pic);
            _data.vue.apps.push(item);
        });
    }
};

$$(function () {
    _html.init();
});
