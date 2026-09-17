let _data={
    vue:null,
    initData(vue){
        this.vue=vue;
        this.channels();
        this.channelPage();
    },
    channels(){
        let requestUrl="js/cctv/tv.json";
        _data.vue.focusId="cctv";
        // [道玄] 离线本地assets读取：原生桥 _apiNative 对本地路径走 FileUtil.readExt 回退 assets，
        // 规避 base.js 覆盖后的 _apiX.$$.ajax 在 file:// 下读本地文件失败（左侧列表丢失）
        try {
            let text = window._apiNative.getJson(requestUrl, JSON.stringify({}));
            console.log("text::: "+text)
            let data = JSON.parse(text);
            data.data.forEach((item,index)=>{
                item.id=index;
                _data.vue.channels.push(item);
            })
        } catch(e) {
            console.error("load tv.json error", e);
            if (typeof _layer !== 'undefined' && _layer.notify) { _layer.notify("加载频道失败 "+e.message); }
        }
    },
    channelPage(channelItem){

    }
};
$$(function(){

    _tvHtmlInit();
    //_layer.notify("请手动下载最新版升级(应用内升级部分版本和设备有问题)");
});