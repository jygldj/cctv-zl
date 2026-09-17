let _data={
    vue:null,
    PAGE:30,    // 每页条数（央视接口上限 n=100；全局30，真翻页上下页切换、不平铺）
    initData(vue){
       this.vue=vue;
       this.channels();
       this.channelPage(this.vue.channels[0], vue.yearRange());
    },
    channels(){
        const mk=(id,tag,name)=>({id:id,tag:tag,name:name,loading:false,pageNum:0,vods:[],allVods:[],page:0,noMore:false,yearFilter:null});
        _data.vue.channels.push(mk("tv","tv","电视剧"));
        _data.vue.channels.push(mk("dhp","dhp","动画片"));
        _data.vue.channels.push(mk("jlp","jlp","纪录片"));
        _data.vue.channels.push(mk("tbjm","tbjm","特别节目"));
    },
    _mapVod(it){
        return {id:it.id,name:it.title,pic:_tvFunc.image(it.image),url:it.url,remark:it.sc,year:it.year,site:"cctv"};
    },
    // 年代筛选（区间）合并后、或远程拉取后，统一把 allVods 切片到当前屏，并计算全局序号
    _assignPage(item, page){
        item.page=page;
        item.vods = item.allVods.slice(page*this.PAGE, page*this.PAGE+this.PAGE);
        item.allVods.forEach(function(v,i){ v.seq=i+1; });
    },
    // 入口：yearRange=null(全部) 或 年份数组(如[2005..2009]) 或 'early'(≤1999)
    channelPage(channelItem, yearRange){
        if(!channelItem){ channelItem=this.vue.channels[0]; }
        // 切换年代/频道：重置当前视图（替换语义，不跨视图堆积）
        channelItem.yearFilter = yearRange || null;
        channelItem.page=0;
        channelItem.allVods=[];
        channelItem.vods=[];
        channelItem.noMore=false;
        channelItem.pageNum=0;
        channelItem.loading=false;
        if(yearRange){
            this._loadYearRange(channelItem, yearRange);
        }else{
            // 全部视图：首屏缓存秒显（仅首屏写缓存，翻页不写）
            let cacheKey="cctv_vods_"+channelItem.id;
            try{
                let cached=sessionStorage.getItem(cacheKey);
                if(cached){
                    let arr=JSON.parse(cached);
                    channelItem.allVods=arr.slice();
                    this._assignPage(channelItem,0);
                    channelItem.pageNum=1;
                    console.log("[缓存] 秒显 "+channelItem.name+" ("+arr.length+")");
                    return;
                }
            }catch(e){}
            this._loadRemote(channelItem);
        }
    },
    // 全部视图：远程真分页，追加到 allVods，切片显示（vods 恒一页，切走即释放）
    _loadRemote(channelItem){
        channelItem.loading=true;
        let cacheKey="cctv_vods_"+channelItem.id;
        let requestUrl="https://api.cntv.cn/list/getVideoAlbumList?serviceId=tvcctv&n="+this.PAGE+
            _tvFunc.paramStr({p:channelItem.pageNum+1, fc:channelItem.name});
        const self=this;
        _apiX.getJson(requestUrl,
            { "User-Agent": _apiX.userAgent(false), "tv-ref": "https://tv.cctv.com/" },
            function(text){
                channelItem.loading=false;
                let data;
                try{ data=JSON.parse(text); }catch(e){ return; }
                if(!data.data||!data.data.list||data.data.list.length===0){
                    channelItem.noMore=true;
                    self._focusPager(channelItem);
                    return;
                }
                channelItem.pageNum++;
                let chunk=[];
                if(channelItem.pageNum===1 && channelItem.tag==="tv"){
                    _data.hotList(chunk);   // 首页热门置顶（仅电视剧）
                }
                data.data.list.forEach(function(it){
                    chunk.push(self._mapVod(it));
                });
                channelItem.allVods = channelItem.allVods.concat(chunk);
                if(channelItem.pageNum===1){
                    try{ sessionStorage.setItem(cacheKey, JSON.stringify(channelItem.allVods)); }catch(e){}
                }
                // 推进显示：首屏显示第0屏；翻页追加后显示新拉到的最后一屏
                if(channelItem.pageNum===1){
                    channelItem.page=0;
                }else{
                    channelItem.page=Math.floor((channelItem.allVods.length-1)/self.PAGE);
                }
                self._assignPage(channelItem, channelItem.page);
                if(chunk.length < self.PAGE){ channelItem.noMore=true; }
                self._focusPager(channelItem);
            },
            function(){ channelItem.loading=false; }
        );
    },
    // 年代区间：服务端不支持区间参数，并发拉该区间每个单年 → 合并 allVods → 切片翻页
    _loadYearRange(channelItem, years){
        channelItem.loading=true;
        const self=this;
        const headers={"User-Agent":_apiX.userAgent(false),"tv-ref":"https://tv.cctv.com/"};
        const fc=channelItem.name;
        function mapAndFinish(merged){
            // 区间内按年份降序（新到旧）
            merged.sort(function(a,b){ return (parseInt(b.year,10)||0)-(parseInt(a.year,10)||0); });
            merged.forEach(function(v,i){ v.seq=i+1; });
            channelItem.allVods=merged;
            self._assignPage(channelItem,0);
            channelItem.loading=false;
            console.log("[年代] "+channelItem.name+" 合并 "+merged.length+" 条");
        }
        if(years==='early'){
            // 早年(≤1999)：按单年真筛（服务端 year=Y 已实证生效），并发池 batch=5 节流
            // 取代原"拉全量1166再客户端过滤"，传输/解析量降至约31部，机顶盒不再卡死
            let earlyYears=[];
            for(let y=1965; y<=1999; y++){ earlyYears.push(y); }
            let merged=[]; let idx=0; let active=0; const BATCH=5;
            function pump(){
                while(active<BATCH && idx<earlyYears.length){
                    let y=earlyYears[idx++]; active++;
                    let u="https://api.cntv.cn/list/getVideoAlbumList?serviceId=tvcctv&n="+self.PAGE+_tvFunc.paramStr({p:1, fc:fc, year:y});
                    _apiX.getJson(u, headers, function(t){
                        let d; try{ d=JSON.parse(t); }catch(e){ d=null; }
                        if(d&&d.data&&d.data.list){
                            d.data.list.forEach(function(it){ merged.push(self._mapVod(it)); });
                        }
                        active--; if(idx<earlyYears.length){ pump(); } else if(active===0){ mapAndFinish(merged); }
                    }, function(){
                        active--; if(idx<earlyYears.length){ pump(); } else if(active===0){ mapAndFinish(merged); }
                    });
                }
            }
            pump();
            return;
        }
        // 按年并发合并
        let merged=[]; let done=0;
        years.forEach(function(y){
            let u="https://api.cntv.cn/list/getVideoAlbumList?serviceId=tvcctv&n="+self.PAGE+_tvFunc.paramStr({p:1, fc:fc, year:y});
            _apiX.getJson(u, headers, function(t){
                let d; try{ d=JSON.parse(t); }catch(e){ d=null; }
                if(d&&d.data&&d.data.list){
                    d.data.list.forEach(function(it){ merged.push(self._mapVod(it)); });
                }
                done++; if(done===years.length) mapAndFinish(merged);
            }, function(){ done++; if(done===years.length) mapAndFinish(merged); });
        });
    },
    // 翻页后自动聚焦：末页 → "上一页"（第一页无上一页按钮时落"下一页"）；非末页 → "下一页"
    _focusPager(channelItem){
        if(!window.__setFocus || !this.vue) return;
        if(channelItem.noMore){
            // 末页 → 落"上一页"；第一页无"上一页"按钮 → 落"下一页"（防悬空）
            if(channelItem.page > 0){
                window.__setFocus(this.vue.tvId('prev', channelItem.tag));
            }else{
                window.__setFocus(this.vue.tvId('next', channelItem.tag));
            }
        }else{
            window.__setFocus(this.vue.tvId('next', channelItem.tag));
        }
    },
    loadMore(channelItem){
        if(!channelItem) return;
        if(channelItem.loading) return;
        const start=(channelItem.page+1)*this.PAGE;
        if(start >= channelItem.allVods.length){
            if(channelItem.noMore) return;   // 本地无下一页且数据源已到底：死按钮无反应
            if(channelItem.yearFilter){
                channelItem.noMore=true;   // 区间已全量，到底
                this._focusPager(channelItem);
                return;
            }
            // 全部视图：远程拉下一页（追加到 allVods，切走即释放，不跨视图堆积）
            this._loadRemote(channelItem);
            return;
        }
        // 本地仍有下一页数据（翻回后也可再翻下）：切片下一屏
        this._assignPage(channelItem, channelItem.page+1);
        this._focusPager(channelItem);
    },
    prevPage(channelItem){
        if(!channelItem) return;
        if(channelItem.page>0){
            this._assignPage(channelItem, channelItem.page-1);
            this._focusPager(channelItem);
        }
    },
    hotList(vods){
        console.log("hotList");
        vods.push({id:"VIDA1389081608990301",name:"父母爱情",pic:"https://p2.img.cctvpic.com/photoAlbum/page/performance/img/2024/4/1/1711942736387_70.jpg?tvImg=1",
            url:"https://tv.cctv.com/2024/01/04/VIDEmMKK2OVtm2pMSQiAEhCs240104.shtml?spm=C55853485115.P6UrzpiudtDc.0.0",remark:"全44集","site":"cctv"});
        vods.push({id:"VIDA1354531513618469",name:"武林外传",pic:"https://p4.img.cctvpic.com/photoAlbum/vms/standard/img/2023/9/21/VSETMEtC9nNzXx7iy6JJYCwa230921.jpg?tvImg=1",
            url:"https://tv.cctv.com/2014/07/27/VIDE1406399770522952.shtml?spm=C55853485115.PN6hjciJxJ1y.0.0",remark:"全80集","site":"cctv"});
        vods.push({id:"VIDA1354512311612143",name:"亮剑",pic:"https://p5.img.cctvpic.com/photoAlbum/vms/standard/img/2020/5/20/VSETYigTldWkcHwocINdAFuf200520.jpg?tvImg=1",
            url:"https://tv.cctv.com/2015/08/27/VIDE1440638136134698.shtml",remark:"全26集","site":"cctv"});
        vods.push({id:"VIDAgebq1gBc7EB3jtZwdFo7201130",name:"大秦赋",pic:"https://p4.img.cctvpic.com/photoAlbum/page/performance/img/2024/5/28/1716874699072_401.jpg?tvImg=1",
            url:"https://tv.cctv.com/2024/10/18/VIDEKWXuGU1GXpdIut6CmEtH241018.shtml?spm=C55853485115.PhPcBCVf4H0G.0.0",remark:"全78集","site":"cctv"});
        vods.push({id:"VIDAJNNHiuXByYkLTOs0zo2k210202",name:"觉醒年代",pic:"https://p1.img.cctvpic.com/fmspic/vms/image/1612151682835.jpg?tvImg=1",
            url:"https://tv.cctv.com/2023/07/10/VIDEamWUkj0LyiDSzquOL66q230710.shtml?spm=C28340.Pu9TN9YUsfNZ.S93183.454",remark:"全43集","site":"cctv"});
        vods.push({id:"VIDA1380440349816906",name:"打狗棍",pic:"https://p2.img.cctvpic.com/fmspic/vms/image/2013/09/29/VSET_1380439539940665.jpg?tvImg=1",
            url:"https://tv.cctv.com/2022/10/26/VIDETeLtJa1OePcjGPUI2K3b221026.shtml?spm=C55853485115.Pbqb0ldQ5nlz.0.0",remark:"全70集","site":"cctv"});

    }
};
 $(function(){
    _tvHtmlInit();
 });
