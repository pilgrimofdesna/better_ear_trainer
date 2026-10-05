const fs=require("fs");const d="dist/assets/";const f=fs.readdirSync(d);
const js=fs.readFileSync(d+f.find(x=>x.endsWith(".js")),"utf8").replace(/<\/script/gi,"<\/script");
const css=fs.readFileSync(d+f.find(x=>x.endsWith(".css")),"utf8");
const html=`<title>Stellar Ear</title>
<style>:root{color-scheme:dark}${css}</style>
<canvas id="sky"></canvas>
<div id="app"></div>
<script type="module">${js}</script>
`;fs.writeFileSync(process.argv[2],html);console.log(html.length);
