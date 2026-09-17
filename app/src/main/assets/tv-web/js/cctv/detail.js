const _ctrlx={
    ok(){
        //$$(".vjs-play-control").click();
        _menuCtrl.menu();
    }
};
(function(){
   let _app={
     init(){
           this.checkHistory();
           _tvFunc.check(function(){return  $$(".videoFull").length>0},function(index){
                 //全屏
               let menuId = _detailInit(null,999990,true);
           },1000);
        },
        historyUrlKey:"_tv_channel_url",
        checkHistory(){
            let nowValue= window.location.href;
            let key = this.historyUrlKey;

            /* [v4.5.32] App 内（原生频道列表）**只记录、不回流**。
               实测症状：在 A 台 → 点 B 台，播出来的还是 A；再点一次 B 才真的变成 B；
               换任何新频道都要点两次，第一次永远是被拉回「上一个」。
               机理：本函数原意是「回到上次看的频道」，落到 App 里就成了这样 ——
                   1) 在 A 台时 nowValue===value，走到最后 localStorage=A，正常播 A
                   2) 点 B 台：LiveActivity 是 mWebView.loadUrl(B)，整页重载
                      → nowValue=B / value=A，不等 → window.location.href = A  ← 跳回 A
                   3) 页面重载 A：nowValue=A / value=A，相等 → 写 A，播 A
                      ★ 用户看到：点了 B，出来 A（「第一次是上次的节目频道」）
                   4) 再点 B：v4.5.30 那道「同一目标每会话一次」的闸门此时命中，
                      不再跳 → localStorage=B，播 B
                      ★ 用户看到：第二次才正确
               之后换到 C，又会因为「_tv_hist_back_ + B」这个 guardKey 是新的而重演一次。
               App 里频道由原生列表给出、用户点哪个就看哪个，这个「记忆回流」毫无价值，
               故 App 内改为只把当前 URL 记为「最后看的」，绝不执行导航。 */
            try{
                if(typeof _tvFunc!=="undefined" && _tvFunc && _tvFunc.isApp && _tvFunc.isApp()){
                    try{ localStorage.setItem(key, nowValue); }catch(e){}
                    return;
                }
            }catch(e){}

            let value = localStorage.getItem(key);
            if(value&&value!==nowValue){
                /* [v4.5.30] 保留「回到上次看的频道」这个回流，但加一道「每会话一次」的闸门。
                   原实现是无条件回流：只要 value !== nowValue 就 window.location.href = value。
                   一旦站点自身做重定向（比如给 URL 补挂参数），回来以后 value 依旧不等于
                   nowValue，就会「跳过去 → 发现不等 → 再跳」地循环，表现为页面反复重载、
                   脱壳链被反复打断 —— 实测「未脱壳 / 骨架裸露」的可疑来源之一。
                   同一目标每个 WebView 会话只回流一次，既可复现原有体验又不会打转。 */
                let guardKey = "_tv_hist_back_" + value;
                let jumped = false;
                try{ jumped = sessionStorage.getItem(guardKey) === "1"; }catch(e){}
                if(!jumped){
                    try{ sessionStorage.setItem(guardKey, "1"); }catch(e){}
                    window.location.href=value;
                    return;
                }
            }
            localStorage.setItem(key,nowValue);
        }
    };
    _app.init();
  /*  _tvFunc.check(function (){return document.getElementsByTagName("video").length>0;},function (){
        document.getElementsByTagName("video")[0].classList.add("utv-video-full");
    });*/
})();

let _data={
    vue:null,
    initData(vue){
        this.vue=vue;
        this.vue.video=false;
        this.vue.tab="xj";
        this.fullscreen();
        this.tvListData();
        this.hzList();
    },
    fullscreen(){
        $$(".videoFull").trigger("click");
        $$(".y-full").hide();
   /*     $$(".video-con").click(function(){
            console.log("video click")
            _menuCtrl.menu();
        })*/
        $$("body").on("click", function(){
            console.log("video click")
            _menuCtrl.menu();
        });
        //音量100
        _tvFunc.volume100();
    },
    hzList(){
        _tvFunc.check(function(){return $$(".bei-list-inner").length>0},function(index){
            _data.hzListDo();
            $$("#_tv_begin").remove();
        },300);
    },
    hzListDo(){
        _data.vue.hzs.splice(0);
        $$(".bei-list-inner").find(".item").each(function(i,item){
            let id=""+i;
            $$(item).attr("id","xhz-"+id);
            let isCurrent=$$(item).hasClass("active");
            let hzName= $$(item).text().trim().replace(/\s*/g,"");
            if(hzName.includes("VIP")){
                return;
            }
            let itemData={id:id,name:hzName,isVip:false,level:_tvFunc.hzLevel(hzName,2)};
            if(isCurrent){
                _data.vue.now.hz=itemData;
            }
            _data.vue.hzs.push(itemData);
            //_data.vue.data.hz.splice(index,1,itemData);
        });
    },
    historyUrlKey:"_tv_channel_url",
    xjExt(item){
        //需要重新加载画质等
        setTimeout(function(){
            console.log("_app.historyUrlKey"+_data.historyUrlKey)
            localStorage.setItem(_data.historyUrlKey,window.location.href);
            _data.hzList();
        },2000);
    },
    xjIndex:0,
    tvListData(){
        $$(".tv-main-con-r-list-left-imga").each(function(i,item){
            _data.workChannelItem("a-",i,item);
        });
        $$(".tv-main-con-r-list-left-imgb").each(function(i,item){
            _data.workChannelItem("b-",i,item);
        });
    },
    workChannelItem(pre,i,item){
        let text= $$(item).text().trim().replace(/\s*/g,"");
        if(text.includes("VIP")){
            return;
        }
        if(text.includes("CGTN")){
            return;
        }
        let id = this.xjIndex+"";
        $$(item).attr("id","xxj-"+id);
        let isCurrent=$$(item).hasClass("tvSelect");
        text=this.doChannelName(text);
        //={vodId:next_id,id:item.id,url:item.url,isVip:false,remark:"",title:title,index:index,site:"cctv"};
        let itemData={vodId:null,id:id,url:"",title:text,isVip:false,remark:"",index:this.xjIndex};
        this.xjIndex++;
        if(isCurrent){
            _data.vue.now.xj=itemData;
        }
        //{"vodId":item.cid,"id":item.vid,url:_app.url(item.cid,item.vid),"isVip":isVip,"remark":remark,"title":title}
        _data.vue.xjs.push(itemData);
    },
    doChannelName(name){
        if(name==="CCTV16-HD"){
            return "CCTV16";
        }
        if(name==="福建东南卫视"){
            return "福建卫视";
        }
        name= name.replace("(限免)","")
            .replace("频道","");
        return name;
    }
};