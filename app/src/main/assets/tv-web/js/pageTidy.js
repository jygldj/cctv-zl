/* [v4.5.37] 清掉「站点播放器自己的顶部工具条 / 渐变遮罩」。
 *
 * 现象：除央视网入口的「央视17」外，其余节目（央视源2 / 卫视 / 各省地方台 / CCTV直播入口）
 * 在计数器走完、视频起播的那一刻，屏幕顶部约 15vh（正好压在台标那一行）
 * 会浮起一层纯半透明、无文字的遮罩，约 1~2 秒后**整体淡出消失**（不是自下而上收缩）。
 *
 * 定性：「整体退去」是标准 HTML5 播放器的控件自动隐藏行为 ——
 * 起播时亮出顶部渐变 scrim + 标题栏，两三秒后整片 opacity 淡出。
 * 它不是本工程的页面脚本造的：end.js / common.js / my.css 里
 * 不存在「纯半透明、无文字、贴顶一条」的浮层（.tv-notify 是绿/蓝不透明带 6vh 大字、
 * close() 秒删无动画；.tv-wait 是全屏）。原生侧也只有全屏 #000 的 alpha 淡出，
 * 没有位移/高度动画，同样做不出这个东西。
 *
 * 为什么只有央视17 干净：它走 js/cctvFullscreen.js，其中 cleanPage() 会把
 * 整棵 DOM 树（querySelectorAll('*')）里除 video 容器/祖先链外的元素全部 display:none，
 * 站点控件条根本没机会露脸。本脚本就是把这条思路**按需收敛**到另外两条链：
 * 不滥杀，只精确摘掉「贴在屏幕顶部的横条」。
 *
 * 相对 v4.5.36 的三处实质修正：
 *   1) 扫描范围：原只扫 body 的直接子/孙两层 → 改为**全树**（与 cleanPage 一致）。
 *      这是上一版最大的漏洞：播放器控件条常埋在 body>div#app>div.player>div.bar 这种深度；
 *   2) position 判定：原只认 fixed/sticky → 补上 **absolute**。
 *      播放器控件几乎都是相对播放器容器的 absolute，而播放器容器脱壳后已铺满视口，
 *      因此视觉上同样紧贴屏幕顶 —— 漏掉它的概率极高；
 *   3) 隐藏方式：原 display:none 会触发重排、可能打断站点 JS →
 *      改为 visibility:hidden + opacity:0 + pointer-events:none + transition:none。
 *      元素留在文档流里、JS 照常跑，但视觉与触摸/点击同时失效，
 *      且 transition:none 掐掉淡出动画，不会留下渐隐尾巴。
 *
 * 安全边界（宁可不生效，也不要误伤）：
 *   1) 只在「主视频确实起播」后才开始 —— 页面未脱壳时的顶部导航栏绝不能动；
 *   2) 跳过 script/style/iframe 等非可视标签，跳过 html/body 自身；
 *   3) 跳过 video 本身、含 video 的容器、以及 video 的整条祖先链（脱壳容器绝不动）；
 *   4) 只摘 position 非 static、上沿贴顶 <=6px、高 <=35vh、宽 >=半屏 的横条；
 *   5) 白名单放行画质菜单等必要控件；
 *   6) 已摘元素若被站点 JS 又改回可见，会立刻再压回去（单独监听，只盯这少数几个）；
 *   7) 全程有窗口，到点自动停，不做常驻。
 */
(function () {
    'use strict';
    if (window.__DXTV_PAGETIDY_INSTALLED__) { return; }
    window.__DXTV_PAGETIDY_INSTALLED__ = true;

    var TAG = '[道玄电视-清顶条]';

    var SKIP_TAGS = {
        SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, BASE: 1,
        HEAD: 1, HTML: 1, BODY: 1, NOSCRIPT: 1, TEMPLATE: 1,
        IFRAME: 1, VIDEO: 1, AUDIO: 1, SOURCE: 1, TRACK: 1, CANVAS: 1
    };

    /* 这些是用户要用到的控件 / 本工程自己的浮层，即使长得像顶条也得放行。
       注意 .tv-notify：它是 position:absolute; top:0; width:100%; height:10vh+2vh
       合计约 14vh —— 与实测那条遮罩的高度几乎一模一样，是最容易被自己人误伤的靶子。 */
    var KEEP_SEL = [
        '.bei-list-inner',
        '[class*="quality"]', '[class*="Quality"]',
        '[class*="rates"]', '[class*="bitrate"]',
        '[class*="xj"]', '[id*="cctv-fs"]',
        '.tv-notify', '.tv-text', '.tv-wait', '.notify-less',
        '[id^="dxtv"]', '[class^="dxtv"]'
    ];

    var TOP_EDGE = 6;        /* 判定「贴顶」的容忍像素 */
    var MAX_H_RATIO = 0.35;  /* 高于屏高 35% 就不算顶部条 */
    var MIN_W_RATIO = 0.5;   /* 窄于半屏就不算横条 */

    var FAST_TICK = 80;      /* 前段密扫：起播瞬间控件条一冒头就按掉 */
    var FAST_ROUND = 25;     /* 25 × 80ms = 2 秒 */
    var SLOW_TICK = 300;     /* 后段疏扫，兜住后插入的 */
    var SLOW_ROUND = 14;     /* 14 × 300ms ≈ 4.2 秒 —— 合计约 6.2 秒窗口 */
    var RESCAN_EVERY = 6;    /* 每 6 轮做一次全树复扫，其余只看新增节点 */

    var killed = [];         /* 已摘掉的元素 */
    var watchers = [];       /* 针对已摘元素的 MutationObserver */
    var pending = [];        /* 新增节点队列 */
    var treeMO = null;
    var started = false;
    var round = 0;
    var timer = null;

    function matches(el, sel) {
        if (!el) return false;
        try {
            if (el.matches) return el.matches(sel);
            if (el.webkitMatchesSelector) return el.webkitMatchesSelector(sel);
            if (el.msMatchesSelector) return el.msMatchesSelector(sel);
        } catch (e) {}
        return false;
    }

    function isKeep(el) {
        for (var i = 0; i < KEEP_SEL.length; i++) {
            if (matches(el, KEEP_SEL[i])) return true;
        }
        return false;
    }

    function holdsVideo(el) {
        try { return !!(el.querySelector && el.querySelector('video')); } catch (e) { return true; }
    }

    function inVideoChain(el, v) {
        var p = v;
        var guard = 0;
        while (p && guard++ < 40) {
            if (p === el) return true;
            p = p.parentNode;
        }
        return false;
    }

    /* 把 video 顶到最高层：第二道保险。与 cctvFullscreen.js 一致（它用 2147483647，
       央视17 实测干净）。只改 z-index，不动 position，避免破坏尚未脱壳的布局。 */
    function raiseVideo(v) {
        try {
            var st = window.getComputedStyle ? window.getComputedStyle(v) : null;
            if (st && st.position !== 'static') {
                v.style.setProperty('z-index', '2147483647', 'important');
            }
        } catch (e) {}
    }

    function hide(el) {
        var idx = killed.indexOf(el);
        if (idx < 0) {
            el.setAttribute('data-dxtv-topclean', '1');
            var r = null;
            try { r = el.getBoundingClientRect(); } catch (e) {}
            var st = null;
            try { st = window.getComputedStyle(el); } catch (e) {}
            /* 取证：一旦实测仍有残留，logcat 抓这一条就能看到凶手真容 */
            console.warn(TAG + ' 命中 top=' + (r ? Math.round(r.top) : '?') +
                ' h=' + (r ? Math.round(r.height) : '?') +
                ' w=' + (r ? Math.round(r.width) : '?') +
                ' pos=' + (st ? st.position : '?') +
                ' <' + el.tagName.toLowerCase() +
                ' class="' + (el.className || '') +
                '" id="' + (el.id || '') + '">');
            killed.push(el);
        }

        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        el.style.setProperty('transition', 'none', 'important');
        el.style.setProperty('animation', 'none', 'important');

        /* 站点若把它改回可见，立刻再压回去 */
        try {
            if (window.MutationObserver && !el.__dxtvTidyMO) {
                var mo = new MutationObserver(function () {
                    try {
                        var s = window.getComputedStyle(el);
                        if (s && s.visibility !== 'hidden') {
                            el.style.setProperty('visibility', 'hidden', 'important');
                            el.style.setProperty('opacity', '0', 'important');
                        }
                    } catch (e) {}
                });
                mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
                el.__dxtvTidyMO = mo;
                watchers.push(mo);
            }
        } catch (e) {}
    }

    function test(el, v, vh, vw) {
        if (!el || el.nodeType !== 1) return false;
        if (SKIP_TAGS[el.tagName]) return false;
        if (el === document.documentElement || el === document.body) return false;
        if (el === v) return false;
        if (el.getAttribute('data-dxtv-topclean')) return false;
        if (holdsVideo(el)) return false;
        if (inVideoChain(el, v)) return false;
        if (isKeep(el)) return false;

        var st = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (!st) return false;
        if (st.visibility === 'hidden' || st.opacity === '0') return false;
        if (st.display === 'none') return false;
        if (st.position === 'static') return false;

        var r = el.getBoundingClientRect();
        if (!r || r.height <= 0 || r.width <= 0) return false;
        if (r.top > TOP_EDGE) return false;
        if (r.height > vh * MAX_H_RATIO) return false;
        if (r.width < vw * MIN_W_RATIO) return false;
        return true;
    }

    function sweep(v, vh, vw, fullTree) {
        var nodes;
        if (fullTree) {
            nodes = document.querySelectorAll('body *');
        } else {
            /* 先看新增队列（快），队列为空时退化也不用慌 —— 下次 rescan 兜底 */
            nodes = pending.splice(0, pending.length);
        }
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (!el) continue;
            /* 新增节点自身可能不符合（比如它是个外层容器），
               但它内部可能有控件条 —— 顺带往下看一层。 */
            if (test(el, v, vh, vw)) { hide(el); continue; }
            if (fullTree) continue;
            if (!el.children) continue;
            for (var j = 0; j < el.children.length; j++) {
                if (test(el.children[j], v, vh, vw)) { hide(el.children[j]); }
            }
        }
    }

    function tick() {
        round++;
        try {
            var v = document.querySelector('video');
            if (!v || !document.body) return;
            var vh = window.innerHeight || document.documentElement.clientHeight || 1;
            var vw = window.innerWidth || document.documentElement.clientWidth || 1;
            raiseVideo(v);
            sweep(v, vh, vw, (round % RESCAN_EVERY === 1));
        } catch (e) {}

        if (round >= FAST_ROUND + SLOW_ROUND) { stopAll(); return; }
        var t = (round <= FAST_ROUND) ? FAST_TICK : SLOW_TICK;
        timer = setTimeout(tick, t);
    }

    function stopAll() {
        try { if (timer) clearTimeout(timer); } catch (e) {}
        try { if (treeMO) treeMO.disconnect(); } catch (e) {}
        /* 摘都摘完了，盯梢的可以撤了 —— 不做常驻 */
        for (var i = 0; i < watchers.length; i++) {
            try { watchers[i].disconnect(); } catch (e) {}
        }
        watchers.length = 0;
        console.log(TAG + ' 窗口结束，已摘 ' + killed.length + ' 个');
    }

    function start() {
        if (started) return;
        started = true;
        try {
            if (window.MutationObserver && document.body) {
                treeMO = new MutationObserver(function (recs) {
                    for (var i = 0; i < recs.length; i++) {
                        var added = recs[i].addedNodes;
                        for (var j = 0; j < added.length; j++) {
                            if (added[j] && added[j].nodeType === 1) pending.push(added[j]);
                        }
                    }
                    if (pending.length > 400) pending.splice(0, pending.length - 400);
                });
                treeMO.observe(document.body, { childList: true, subtree: true });
            }
        } catch (e) {}
        tick();
    }

    /* 等主视频真的解码出帧再动手：过早清理会把页面尚未脱壳时的顶部导航栏也一并干掉，
       那是灾难。readyState>=2 已足以说明画面出来了，不必等 currentTime 走起来。 */
    var waited = 0;
    var w = setInterval(function () {
        waited += 200;
        var v = document.querySelector('video');
        if (v && v.readyState >= 2) {
            clearInterval(w);
            start();
            return;
        }
        if (waited >= 25000) { clearInterval(w); }
    }, 200);
})();
