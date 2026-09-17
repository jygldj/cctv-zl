const { execSync } = require("child_process");
const path = require("path");
const yaml = require('js-yaml');
//const toml = require('toml');
const fs = require("fs");
const utf8="utf8";

// 先执行 huo.js 脚本
console.log("开始执行 huo.js 脚本...");
try {
    const huoScriptPath = path.join(__dirname, "huo.js");
    execSync(`node "${huoScriptPath}"`, { stdio: 'inherit', cwd: __dirname });
    console.log("huo.js 脚本执行完成");
} catch (error) {
    console.error("执行 huo.js 脚本失败:", error.message);
    process.exit(1);
}

function  yamlToJson(path){
    fs.readdir(path, (err, files) => {
        files.forEach(file => {
            //let name = file.name;
            if(file.endsWith(".yml")){
                let  jsonData=  yaml.load(fs.readFileSync(path+file, utf8));
                fs.writeFileSync(path+file.substring(0,file.indexOf("."))+".json",JSON.stringify(jsonData),utf8);
            }
          /*  if(file.endsWith(".toml")){
                let  jsonObj=  toml.parse(fs.readFileSync(path+file, utf8));
                fs.writeFileSync(path+file.substring(0,file.indexOf("."))+".json",JSON.stringify(jsonObj),utf8);
            }*/
        });
    });
}

yamlToJson("js/cctv/");
const yamlString = fs.readFileSync('update.yml', utf8);
const jsonData = yaml.load(yamlString);
fs.writeFileSync("update.json",JSON.stringify(jsonData),utf8);
console.log("node "+JSON.stringify(jsonData));