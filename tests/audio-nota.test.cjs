const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');

test('gravação encerra as trilhas e não insere em outra nota',async()=>{
  let paradas=0, uploads=0, recorder;
  const stream={getTracks:()=>[{stop:()=>paradas++}]};
  class Recorder{static isTypeSupported(){return true;}constructor(){recorder=this;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:{size:1}});this.onstop();}}
  const ctx={navigator:{mediaDevices:{getUserMedia:async()=>stream}},MediaRecorder:Recorder,File:class{},setTimeout:()=>1,clearTimeout:()=>{},t:x=>x,status:()=>{},$ :()=>({textContent:''}),window:{cadernoDesktop:{saveAttachment:()=>{uploads++;}}},editing:{id:'a'},state:{vaultPath:'cofre'},editorDaNota:{editor:{area:()=>({})}}};
  vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('const LIMITE_DE_AUDIO'),app.indexOf('function imagensDoEvento')),ctx);
  await ctx.gravarAudio();assert.equal(recorder.state,'recording');
  ctx.editing={id:'outra'};await ctx.gravarAudio();
  assert.equal(paradas,1);assert.equal(uploads,0);
});
