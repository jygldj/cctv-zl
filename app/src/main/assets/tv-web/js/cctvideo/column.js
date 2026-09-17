// 央视栏目点播（道玄电视）
// 数据源：js/cctvideo/columns.js（window._CCTV_COLUMNS：新闻/少儿/综合/综艺 四类栏目 + TOPC id）
// 取数：https://api.cntv.cn/NewVideo/getVideoListByColumn?id={TOPC}&p=1&n=100&sort=desc&mode=0&serviceId=tvcctv
// 播放：live.html?guid={guid}&name={title}（复用现有 live.js guid 取流链路，App 内播放页）
// 返回键：单集视图 → 返回栏目清单；栏目清单视图 → 返回首页 index.html
const _ctrlx = {}; // 防止 myfocus.js 的 ok()/menu() 触发 ReferenceError
let _colData = {
    vue: null,
    PAGE: 100,   // 一次拉最新 100 集（接口 n 上限 100，栏目点播滚动浏览、不分页）
    initData(vue){
        this.vue = vue;
        vue.view = 'cats';
        vue.cats = window._CCTV_COLUMNS || [];
        vue.curCat = vue.cats[0] || {tag:'xw', name:'新闻栏目', list:[]};
        vue.curColumn = null;
        vue.vods = [];
        vue.loading = false;
        this._focus('cat-' + vue.curCat.tag);
    },
    _focus(id){
        if(!id){ return; }
        let tries = 0;
        const tryFocus = function(){
            const el = document.getElementById(id);
            if(el){
                // 直接落焦点到 TvFocus，避免 __setFocus 未就绪或 PetiteVue 代理异常导致失焦
                if(window.TvFocus){
                    window.TvFocus.curFocusId = id;
                    window.TvFocus.applyFocus(id);
                }
                if(window.__setFocus){ window.__setFocus(id); }
                return;
            }
            tries++;
            if(tries < 25){ setTimeout(tryFocus, 100); }   // 元素未就绪时最多重试 2.5s
        };
        setTimeout(tryFocus, 80);
    },
    openCat(cat){
        if(this.vue.loading) return;
        this.vue.curCat = cat;
        this.vue.curColumn = null;
        this.vue.view = 'cats';
        this.vue.vods = [];
        this._focus('cat-' + cat.tag);
    },
    openColumn(col){
        if(this.vue.loading) return;
        this.vue.curColumn = col;
        this.vue.view = 'vods';
        this.vue.vods = [];
        this._focus('back-cats');   // 切视图即时落焦点到返回栏，避免空档期遥控器失焦
        this._load();
    },
    backToCats(){
        if(this.vue.view !== 'vods') return;
        this.vue.view = 'cats';
        this.vue.curColumn = null;
        this._focus('col-0');
    },
    _load(){
        const self = this;
        const col = this.vue.curColumn;
        if(!col || !col.topc){ this.vue.loading = false; return; }
        this.vue.loading = true;
        const waitId = _layer.wait("正在加载「" + col.name + "」...");
        const url = "https://api.cntv.cn/NewVideo/getVideoListByColumn?id=" + encodeURIComponent(col.topc) +
            "&p=1&n=" + this.PAGE + "&sort=desc&mode=0&serviceId=tvcctv";
        _apiX.getJson(url,
            {"User-Agent": _apiX.userAgent(false), "tv-ref": "https://tv.cctv.com/"},
            function(text){
                self.vue.loading = false;
                _layer.close(waitId);
                let data;
                try{ data = JSON.parse(text); }catch(e){ self.vue.vods = []; _layer.notify("数据解析失败"); return; }
                if(!data.data || !data.data.list || data.data.list.length === 0){
                    self.vue.vods = [];
                    _layer.notify("该栏目暂无节目");
                    return;
                }
                self.vue.vods = data.data.list.map(function(it){
                    return { name: it.title, pic: _tvFunc.image(it.image), guid: it.guid, time: it.time };
                });
                self._focus('vod-0');
            },
            function(){
                self.vue.loading = false;
                _layer.close(waitId);
                self.vue.vods = [];
                _layer.notify("加载失败，请检查网络");
            }
        );
    },
    play(vod){
        if(!vod || !vod.guid){ _layer.notify("无播放地址"); return; }
        _layer.wait("正在打开播放...");
        const dst = "live.html?guid=" + encodeURIComponent(vod.guid) + "&name=" + encodeURIComponent(vod.name || "");
        window.location.href = dst;
    }
};

(function(){
    const _html = {
        init(){
            this.initApp();
        },
        initHtml(){
            return `
<div class="tv-body" id="tv-body" @vue:mounted="initData()">
  <div class="tv-header" :style="{display:(view==='cats'?'flex':'none')}">
    <div v-for="cat in cats" :key="'cat-'+cat.tag" class="tv-btn" :id="tvId(cat.tag,'cat-')"
         :class="{'tv-active':cat.tag===curCat.tag}" @click="openCat(cat)"
         move-down="#col-0">{{cat.name}}</div>
  </div>
  <div class="tv-header" :style="{display:(view==='vods'?'flex':'none')}">
    <div class="tv-btn" id="back-cats" @click="backToCats" move-down="#vod-0">← 返回栏目</div>
    <div class="tv-btn tv-active" style="flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{curColumn ? curColumn.name : ''}}</div>
  </div>
  <div class="tv-content" :style="{display:(view==='cats'?'grid':'none')}">
    <div v-for="(col,index) in curCat.list" :key="col.topc" class="tv-item"
         :id="tvId(index,'col-')" @click="openColumn(col)"
         move-updown-id="col-" :move-up="tvId(curCat.tag,'#cat-')" move-updown="5">
      <span class="col-label">{{col.name}}</span>
    </div>
    <div v-if="curCat.list.length===0" class="tv-item"><span>暂无栏目</span></div>
  </div>
  <div class="tv-content" :style="{display:(view==='vods'?'grid':'none')}">
    <div v-for="(vod,index) in vods" :key="'vod-'+index" class="tv-item"
         :id="tvId(index,'vod-')" @click="play(vod)"
         move-updown-id="vod-" move-up="#back-cats" move-updown="5">
      <img v-if="vod.pic" :src="vod.pic" :alt="vod.name" />
      <span class="vod-label">{{vod.name}}</span>
    </div>
    <div v-if="vods.length===0 && !loading" class="tv-item"><span>暂无节目</span></div>
  </div>
</div>`;
        },
        initApp(){
            document.body.innerHTML = this.initHtml();
            const app = PetiteVue.createApp({
                view:'cats',
                cats:[],
                curCat:null,
                curColumn:null,
                vods:[],
                loading:false,
                initData(){ _colData.initData(this); },
                openCat(cat){ _colData.openCat(cat); },
                openColumn(col){ _colData.openColumn(col); },
                backToCats(){ _colData.backToCats(); },
                play(vod){ _colData.play(vod); },
                setFocus(id){ if(window.TvFocus){ window.TvFocus.applyFocus(id); } },
                tvId(value, pre){ return pre ? pre+value : 'tv-'+value; }
            }).mount('#tv-body');
            window.__setFocus = function(id){ app.setFocus(id); };
        }
    };
    window._colHtmlInit = function(){
        _html.init();
        if(window.TvFocus){
            TvFocus.init(null);
            // 覆盖返回键：单集视图 → 返回栏目清单；栏目清单视图 → 返回首页
            TvFocus.keyBackEvent = function(){
                if(_colData.vue && _colData.vue.view === 'vods'){
                    _colData.backToCats();
                }else{
                    window.location.href = _browser.getURL("index.html");
                }
            };
        }
    };
    $(function(){
        _colHtmlInit();
    });
})();
