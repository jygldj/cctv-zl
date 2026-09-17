/* 央视片库专属页面脚本（由旧版 js/home.js 独立而来）。
   与央视网入口 js/home.js 彻底分家：两边再改互不影响。
   遥控器行序：频道行 → 年代行 → 节目网格（上/下键按此顺序逐级往返）。 */
const Filter = {
    default: 0,
    hot: 1,
    new: 2,
    best: 3
};
(function(){
    const _html={
        init(){
           this.initApp();
        },
        initHtml(){
            const html = `
            <div class="tv-body" id="tv-body" @vue:mounted="initData()">
              <div class="tv-header">
                <div v-for="item in channels" :key="'ch-'+item.tag" class="tv-btn" :id="tvId(item.tag)" :class="{'tv-active':item.tag==currentChannel.tag}"
                 @click="switchChannel(item)" :move-down="tvId(currentYear,'#yr-')">{{item.name}}</div>
              </div>
              <div class="tv-header">
                <div v-for="yr in yearFilters" :key="'yr-'+yr.key" class="tv-btn tv-year-btn" :id="tvId(yr.key,'yr-')" :class="{'tv-active':yr.key===currentYear}"
                @click="switchYear(yr)"
                   :move-down="moveDown(currentChannel.tag)" :move-up="tvId(currentChannel.tag,'#tv-')">{{yr.label}}</div>
              </div>
              <div  v-for="item in channels" :key="'ct-'+item.tag" class="tv-content" :id="tvId(item.tag,'tvd-')" :style="{display:(item.tag==currentChannel.tag ? 'grid' : 'none')}">
               <div v-for="(vod,index) in item.vods" :key="'vod-'+index+'-'+item.tag" @click="goto(vod)" :id="tvId(index,item.tag)" :move-updown-id=item.tag class="tv-item"
                 move-updown="5" :move-up="tvId(currentYear,'#yr-')">
                    <span class="tv-idx">{{vod.seq}}</span>
                    <img v-if="vod.pic" :src=vod.pic :alt=vod.name />
                    <span :class="{'tv-btn':!vod.pic}">{{vod.name}}{{vod.remark}}</span>
               </div>
               <div v-if="item.page>0" :move-updown-id=item.tag class="tv-item tv-prev" @click="prevPage(item)" :id="tvId('prev',item.tag)" :move-up="tvId(currentYear,'#yr-')">上一页</div>
               <div v-if="item.vods.length>0" :move-updown-id=item.tag class="tv-item tv-next" @click="nextPage(item)" :id="tvId('next',item.tag)" :move-up="tvId(currentYear,'#yr-')">{{hasNext(item)?'下一页':'没了'}}</div>
              </div>
           </div>`
           return html;
        },
        initApp(){
            document.body.innerHTML = this.initHtml();
            const app = PetiteVue.createApp({
                channels:[],
                currentChannel:null,
                focusId:"tv",
                filters:[],
                yearFilters:[
                    {key:'early', label:'1999前',  range:'early'},
                    {key:'2000',  label:'2000-2004', range:[2000,2001,2002,2003,2004]},
                    {key:'2005',  label:'2005-2009', range:[2005,2006,2007,2008,2009]},
                    {key:'2010',  label:'2010-2014', range:[2010,2011,2012,2013,2014]},
                    {key:'2015',  label:'2015-2019', range:[2015,2016,2017,2018,2019]},
                    {key:'2020',  label:'2020-2024', range:[2020,2021,2022,2023,2024]},
                    {key:'2025',  label:'2025-2026', range:[2025,2026]}
                ],
                currentYear:'2025',
                yearRange(){
                    let y=this.yearFilters.find(x=>x.key===this.currentYear);
                    return y?y.range:null;
                },
                initData(){
                    _data.initData(this);
                    if(this.channels.length>0){
                        this.currentChannel=this.channels[0];
                        let idFirst = this.tvId(this.currentChannel.tag);
                        this.focusId = idFirst;
                        if(window.TvFocus){
                            window.TvFocus.curFocusId = idFirst;
                            window.TvFocus.applyFocus(idFirst);
                        }
                    }
                },
                switchFilter(filter){
                    this.currentChannel.filter=filter;
                    _data.channelPage(this.currentChannel, this.yearRange());
                },
                switchChannel(item){
                       this.currentChannel=item;
                       _data.channelPage(item, this.yearRange());
                },
                switchYear(yr){
                    this.currentYear=yr.key;
                    _data.channelPage(this.currentChannel, yr.range);
                },
                moveDown(id){
                   return "#tvd-"+id+":.tv-item";
                },
                goto(item){
                    if(item.site==="cctv"){
                        this.playCctvFirst(item);
                        return;
                    }
                    let isApp= _tvFunc.isApp();
                    let waitId=null;
                    try { waitId= _layer.wait("正在跳转到 "+item.name+" 请耐心等待。。。"); } catch(e){}
                    item.url=_tvFunc.url(item.url);
                    if(!item.url){
                        if(null!=waitId){ _layer.close(waitId); }
                        return;
                    }
                    if(null!=waitId){
                        setTimeout(function(){ try{ _layer.close(waitId); }catch(e){} },6000);
                    }
                    if(!isApp||_tvFunc.isGecko()){
                        if(item.url.startsWith("https://tv.utao.tv/tv-web/")){
                            item.url=item.url.substring(26);
                        }
                        window.location.href = item.url;
                        return;
                    }
                    window.location.href = item.url;
                },
                playCctvFirst(item){
                    // 零等待直跳播放页：全集与首集在 live.html 内并行取（首页不阻塞取流）
                    let dst="live.html?album="+encodeURIComponent(item.id)+"&name="+encodeURIComponent(item.name);
                    window.location.href=dst;
                },
                playGuid(guid, albumId, name){
                    let waitId=_layer.wait("正在获取播放地址...");
                    let m3u8Url="https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid="+encodeURIComponent(guid);
                    _apiX.getJson(m3u8Url,{"User-Agent":_apiX.userAgent(false),"tv-ref":"https://tv.cctv.com/"},function(t2){
                        let jo;
                        try{ jo=JSON.parse(t2); }catch(e){ _layer.close(waitId); _layer.msg("解析播放地址失败"); return; }
                        let hls=jo.hls_url;
                        if(!hls){ _layer.close(waitId); _layer.msg("获取播放地址失败"); return; }
                        _layer.close(waitId);
                        let dst="live.html?url="+encodeURIComponent(hls)+"&album="+encodeURIComponent(albumId||"")+"&name="+encodeURIComponent(name||"");
                        window.location.href=dst;
                    },function(){ _layer.close(waitId); _layer.msg("获取播放地址失败"); });
                },
                nextPage(item){
                    _data.loadMore(item);
                },
                hasNext(item){
                    return (item.page+1)*_data.PAGE < item.allVods.length || !item.noMore;
                },
                prevPage(item){
                    _data.prevPage(item);
                },
                filterName(item) {
                    switch(item){
                        case Filter.default:
                            return "默认";
                        case Filter.hot:
                            return "热门";
                        case Filter.new:
                            return "最新";
                        case Filter.best:
                            return "好评"
                    }
                    return "默认";
                },
                setFocus(id){
                    this.focusId=id;
                    if(window.TvFocus){
                        window.TvFocus.curFocusId=id;
                        window.TvFocus.applyFocus(id);
                    }
                },
                tvId(value,pre){
                    if(pre){
                        return pre+value;
                    }
                    return 'tv-'+value;
                }
            }).mount('#tv-body');
            window.__setFocus = function(id){ app.setFocus(id); };
        }
    };
    window._tvHtmlInit=function(){
        _html.init();
        TvFocus.init(null);
    };
})();
