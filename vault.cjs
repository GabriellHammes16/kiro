const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validateState, upgradeBackup, folderPaths, descendants, pathKey, folderColor, withHabits, validFolderName, aplicarRenomeacaoDeLinks } = require('./domain.js');
const yaml = require('js-yaml');
const KiroFluxo = require('./fluxo.js');
const { palavraParaDicionario } = require('./corretor.js');
// Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
const frase = f => f;

const hash = value => createHash('sha256').update(value).digest('hex');
const slug = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'nota';
const empty = () => ({ notes: [], tasks: [], habits: [], habitLog: {}, studies: [] });
async function optionalRead(file) {
  try { return await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

function frontmatter(header) {
  const fields = header ? yaml.load(header[1], { schema: yaml.CORE_SCHEMA }) || {} : {};
  if (typeof fields !== 'object' || Array.isArray(fields)) throw new Error(frase('Metadados Markdown inválidos.'));
  return fields;
}
const validDate = value => Number.isFinite(value) && value > 0 && value <= 8.64e15;
function parseMarkdown(raw, file, mtime, legacy = {}, birthtime) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const header = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const fields = frontmatter(header);
  const body = header ? normalized.slice(header[0].length).replace(/^\n/, '').replace(/\n$/, '') : normalized;
  const note = {
    id: fields['caderno-id'] || legacy.id || `file-${hash(file).slice(0, 32)}`,
    title: typeof fields.title === 'string' ? fields.title : path.basename(file, path.extname(file)),
    body, links: Array.isArray(fields.links) ? fields.links : [],
    tags: Array.isArray(fields.tags) ? fields.tags : typeof fields.tags === 'string' ? fields.tags.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean) : [],
    folderId: fields.folderId || legacy.folderId || '', updatedAt: mtime, file,
    // Nota antiga sem o campo: a data do arquivo basta para exibir; só grava quando a nota mudar.
    createdAt: [fields.createdAt, legacy.createdAt, birthtime].find(validDate) ?? mtime,
  };
  return note;
}
function markdown(note, previous = '') {
  const header = previous.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const fields = frontmatter(header);
  delete fields.pasta;
  const metadata = { ...fields, 'caderno-id': note.id, title: note.title, links: note.links, tags: note.tags || [], folderId: note.folderId || '', ...(note.createdAt !== undefined && { createdAt: note.createdAt }), updatedAt: note.updatedAt };
  return `---\n${yaml.dump(metadata, { schema: yaml.CORE_SCHEMA, lineWidth: -1, noRefs: true })}---\n\n${note.body}\n`;
}

const FOLDER_MARKER = '.kiro-folder.json';
// Cofres criados quando o aplicativo se chamava KUROI: as marcas antigas continuam
// valendo na leitura, e a gravação seguinte já escreve as novas.
const FOLDER_MARKERS = [FOLDER_MARKER, '.kuroi-folder.json'];
// Cada gravação copia o cofre inteiro para .history. Sem teto, isso cresce sem fim.
const HISTORY_LIMIT = 30;
const SUFIXO_PRESERVADA = '-preservada';
// Escrita de agente copia só o que mudou, em fila própria: um agente escrevendo em sequência
// não fica lento com o tamanho do cofre nem expulsa as cópias completas dos salvamentos do app.
const SUFIXO_PARCIAL = '-parcial';
const SNAPSHOT_ID = /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-preservada|-parcial)?$/;
// Imagens coladas nas notas moram numa pasta marcada na raiz do cofre. A marca tira
// a pasta da varredura: as imagens não viram pasta na árvore, não entram na revisão
// (colar não gera conflito com a nota aberta) e não são copiadas para .history a
// cada salvamento, o que multiplicaria o espaço em disco pelo limite do histórico.
const ATTACHMENT_MARKER = '.kiro-anexos';
const ATTACHMENT_MARKERS = [ATTACHMENT_MARKER, '.kuroi-anexos'];
const ATTACHMENT_FOLDERS = ['Anexos', 'Anexos do Kiro', 'Anexos do KUROI'];
const temMarcaDeAnexos = async directory => {
  for (const marca of ATTACHMENT_MARKERS) if (await pathExists(path.join(directory, marca))) return true;
  return false;
};
const ATTACHMENT_LIMIT = 250 * 1024 * 1024;
const PLUGIN_FILE_LIMIT = 2 * 1024 * 1024;
const PLUGIN_DATA_LIMIT = 1024 * 1024;
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', pdf: 'application/pdf', wav:'audio/wav', mp3:'audio/mpeg', webm:'audio/webm', m4a:'audio/mp4', mp4:'video/mp4', txt:'text/plain; charset=utf-8', csv:'text/csv; charset=utf-8' };
const TEXT_LIMIT = 5 * 1024 * 1024;
// `partial`: `data` é só o começo do arquivo; o elemento cortado no fim termina onde os bytes acabam.
function audioSignature(data,partial=false){
  if(data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WAVE')return 'wav';
  if(data.length>=4&&(data.toString('ascii',0,3)==='ID3'||(data[0]===0xff&&(data[1]&0xe0)===0xe0&&(data[1]&0x18)!==0x08&&(data[1]&0x06)!==0)))return 'mp3';
  if(data.length<12||data.readUInt32BE(0)!==0x1a45dfa3)return null;
  const read=(start,end)=>{const out=[];let p=start;while(p<end){const first=data[p];if(!first)throw Error();let n=1,mask=0x80;while(n<=4&&!(first&mask)){n++;mask>>=1;}if(n>4)throw Error();if(p+n>=end){if(partial)break;throw Error();}let id=0;for(let i=0;i<n;i++)id=id*256+data[p++];const f=data[p];if(!f)throw Error();let s=1,m=0x80;while(s<=8&&!(f&m)){s++;m>>=1;}if(s>8)throw Error();if(p+s>end){if(partial)break;throw Error();}let size=f&(m-1);for(let i=1;i<s;i++)size=size*256+data[p+i];const unknown=size===2**(7*s)-1;p+=s;let stop=unknown?end:p+size;if(!Number.isSafeInteger(stop))throw Error();if(stop>end){if(!partial)throw Error();stop=end;}out.push({id,start:p,end:stop});p=stop;}return out;};
  try{const top=read(0,data.length),header=top.find(x=>x.id===0x1a45dfa3),segment=top.find(x=>x.id===0x18538067);if(!header||!segment||!read(header.start,header.end).some(x=>x.id===0x4282&&data.toString('ascii',x.start,x.end)==='webm'))return null;
    const tracks=read(segment.start,segment.end).find(x=>x.id===0x1654ae6b);if(!tracks)return null;
    const types=read(tracks.start,tracks.end).filter(x=>x.id===0xae).map(x=>read(x.start,x.end).find(y=>y.id===0x83)).map(x=>x&&x.end-x.start===1?data[x.start]:0);
    return types.length&&types.every(x=>x===2)?'webm':null;
  }catch{return null;}
}
// Trecho de um arquivo de `size` bytes pedido no cabeçalho Range: status, cabeçalhos e, fora o 416, o primeiro e o último byte.
function rangeOf(size,header){
  if(!header)return {start:0,end:size-1,status:200,headers:{'Accept-Ranges':'bytes','Content-Length':String(size)}};
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);if(!m||(!m[1]&&!m[2]))return {status:416,headers:{'Content-Range':`bytes */${size}`}};
  const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return {status:416,headers:{'Content-Range':`bytes */${size}`}};
  return {start,end,status:206,headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':String(end-start+1)}};
}
function attachmentRange(data,header){
  const r=rangeOf(data.length,header);
  return {data:r.status===416?Buffer.alloc(0):data.subarray(r.start,r.end+1),status:r.status,headers:r.headers};
}
// Primeiros bytes lidos para conferir a assinatura de áudio e vídeo num pedido de trecho.
const ATTACHMENT_HEAD=64*1024;
// Na leitura, áudio, vídeo e texto são conferidos de novo pelo conteúdo. `partial`: `data` é só o começo do arquivo.
function checkAttachment(data,type,extension,partial=false){
  if(/^(audio|video)\//.test(type)&&(audioSignature(data,partial)||mp4Signature(data))!==extension)throw new Error(frase('Áudio ou vídeo inválido.'));
  if(type.startsWith('text/')&&textSignature(data,extension)!==extension)throw new Error(frase('Texto inválido.'));
}
// Caixa "ftyp" nos bytes 4 a 8; a marca nos bytes 8 a 12 separa áudio M4A de vídeo MP4.
// HEIC e AVIF usam a mesma caixa: essas marcas não são vídeo, e caem na recusa.
const FTYP_IMAGE_BRANDS=new Set(['avif','avis','heic','heix','mif1','msf1']);
function mp4Signature(data){
  if(data.length<12||data.toString('latin1',4,8)!=='ftyp')return null;
  const brand=data.toString('latin1',8,12);
  if(FTYP_IMAGE_BRANDS.has(brand))return null;
  return brand==='M4A '?'m4a':'mp4';
}
// Texto não tem assinatura: vale pela extensão (.md vira .txt), por UTF-8 válido e por não ter byte nulo.
function textSignature(data,extension){
  if(!['txt','csv','md'].includes(extension)||data.length>TEXT_LIMIT||data.includes(0))return null;
  try{new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{return null;}
  return extension==='csv'?'csv':'txt';
}
// Pelo conteúdo, não pelo nome nem pelo tipo declarado. SVG fica de fora: pode carregar script.
function imageSignature(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString('latin1'))) return 'gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}
async function pathExists(file) { try { await fs.access(file); return true; } catch { return false; } }
const visible = name => !name.split('/').some(part => part.startsWith('.'));
const parentPath = file => path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file);
const inside = (file, directory) => file === directory || file.startsWith(directory + '/');
function rewritePaths(body, source, destination, changes) {
  function rewrite(value, wiki) {
    if (/^[a-z][\w+.-]*:|^#|^\/\//i.test(value)) return value;
    const match = value.match(/^([^#?]*)([\s\S]*)$/); const suffix = match[2];
    let target; try { target = decodeURI(match[1]); } catch { return value; }
    const relative = target.startsWith('./') || target.startsWith('../');
    const local = path.posix.normalize(path.posix.join(parentPath(source), target));
    const root = target.replace(/^\//, '');
    const keys = wiki && !relative ? [root, root + '.md', local, local + '.md'] : [local, root];
    const key = keys.find(candidate => changes.has(pathKey(candidate)));
    if (!key) return value;
    const newPath = changes.get(pathKey(key));
    let result = wiki && !relative ? newPath : path.posix.relative(parentPath(destination) || '.', newPath);
    if (wiki && !/\.md$/i.test(target)) result = result.replace(/\.md$/i, '');
    if (target.startsWith('./') && !result.startsWith('.')) result = './' + result;
    if (target.startsWith('/') && wiki) result = '/' + result;
    return (wiki ? result : encodeURI(result)) + suffix;
  }
  return body.replace(/\[\[([^\]\n]+)\]\]/g, (_, inner) => {
    const index = inner.indexOf('|'); const target = index < 0 ? inner : inner.slice(0,index);
    return '[[' + rewrite(target,true) + (index < 0 ? '' : inner.slice(index)) + ']]';
  }).replace(/(!?\[[^\]\n]*\]\()(<[^>]+>|[^\s)]+)([^)]*\))/g, (_, start, target, end) => {
    const angled = target.startsWith('<'); const raw = angled ? target.slice(1,-1) : target;
    const updated = rewrite(raw,false); return start + (angled ? '<' + updated + '>' : updated) + end;
  });
}
class Vault {
  // reaproveitarLeituras: uma escrita relê o cofre várias vezes; arquivo com a mesma data e tamanho não volta ao disco.
  // ponytail: uma edição externa com data e tamanho idênticos passaria batido; só o servidor de agentes liga isto, o app segue lendo do disco.
  constructor(directory, { historyLimit = HISTORY_LIMIT, reaproveitarLeituras = false } = {}) { this.directory = path.resolve(directory); this.queue = Promise.resolve(); this.historyLimit = historyLimit; this.leiturasGuardadas = reaproveitarLeituras ? new Map() : null; }
  exclusive(operation) { const result=this.queue.then(operation); this.queue=result.catch(()=>{}); return result; }
  async safePath(relative) {
    if (typeof relative!=='string'||!relative||relative.includes(':')||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')) throw new Error(frase('Caminho inválido.'));
    const target=path.resolve(this.directory,relative);
    if(!target.startsWith(this.directory+path.sep))throw new Error(frase('Caminho fora do cofre.'));
    let cursor=this.directory;
    for(const part of relative.split('/')){
      cursor=path.join(cursor,part);
      try{if((await fs.lstat(cursor)).isSymbolicLink())throw new Error(frase('Links simbólicos não são permitidos nas pastas gerenciadas.'));}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return target;
  }
  async conflictCopies() {
    await fs.mkdir(this.directory, { recursive: true });
    const found = [];
    const walk = async (relative = '') => {
      const entries = await fs.readdir(relative ? await this.safePath(relative) : this.directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const file = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isFile() && /(?:\.sync-conflict-\d{8}-\d{6}-[^.]+|conflicted copy|cópia em conflito)/i.test(entry.name)) found.push(file);
        if (entry.isDirectory() && !entry.name.startsWith('.')) await walk(file);
      }
    };
    await walk(); return found.sort();
  }
  async scan() {
    const files=new Map(), directories=[];
    const lerGuardado=async file=>{
      const alvo=path.join(this.directory,file), info=await fs.stat(alvo), guardado=this.leiturasGuardadas.get(file);
      const data=guardado&&guardado.mtimeMs===info.mtimeMs&&guardado.size===info.size?guardado.data:await fs.readFile(alvo);
      this.leiturasGuardadas.set(file,{data,mtimeMs:info.mtimeMs,size:info.size});
      return {data,mtime:Math.round(info.mtimeMs),birthtime:Math.round(info.birthtimeMs)};
    };
    const walk=async(relative='')=>{
      const entradas=await fs.readdir(path.join(this.directory,relative),{withFileTypes:true});
      // Arquivo comum, numa pasta que o walk já conferiu: pode pular o safePath. Atalho não cai aqui,
      // porque não é isFile(), e segue para o safePath, que o recusa.
      const lidos=this.leiturasGuardadas?new Map(await Promise.all(entradas.filter(e=>e.isFile()&&(relative||(!e.name.startsWith('.')&&e.name!=='caderno.json'))).map(async e=>[e.name,await lerGuardado(relative?`${relative}/${e.name}`:e.name)]))):null;
      for(const entry of entradas){
        if(!relative&&(entry.name.startsWith('.')||entry.name==='caderno.json'))continue;
        if(!relative&&entry.isDirectory()&&await temMarcaDeAnexos(path.join(this.directory,entry.name)))continue;
        const file=relative?`${relative}/${entry.name}`:entry.name;
        const jaLido=lidos?.get(entry.name);
        if(jaLido){files.set(file,jaLido);continue;}
        const target=await this.safePath(file);
        if(entry.isDirectory()){directories.push(file);await walk(file);}
        else if(entry.isFile()){const info=await fs.stat(target);files.set(file,{data:await fs.readFile(target),mtime:Math.round(info.mtimeMs),birthtime:Math.round(info.birthtimeMs)});}
      }
    };
    await walk();return {files,directories};
  }
  async read() {
    await fs.mkdir(this.directory,{recursive:true});
    if(await optionalRead(await this.safePath('.transaction.json')))throw new Error(frase('Salvamento interrompido. Preserve o cofre e consulte .transaction.json e .history antes de continuar.'));
    const metadata=await optionalRead(await this.safePath('caderno.json'));
    const data=metadata===null?{notes:[],tasks:[],habits:[],habitLog:{},studies:[]}:JSON.parse(metadata);
    if(data.formatVersion&&![2,3].includes(data.formatVersion))throw new Error(frase('Versão do cofre não suportada.'));
    const {files,directories}=await this.scan();
    const legacy=data.formatVersion?[]:validateState(data).notes;
    const notes=[...files].filter(([file])=>visible(file)&&/\.md$/i.test(file)).map(([file,value])=>parseMarkdown(value.data.toString('utf8'),file,value.mtime,legacy.find(n=>file===`Notas/${(n.file||'').replace(/\\/g,'/')}`)||{},value.birthtime));
    for(const n of legacy)if(!notes.some(x=>x.id===n.id))notes.push({...n,file:undefined});
    const folders=[], byDisk=new Map();
    for(const diskPath of directories.filter(visible).sort((a,b)=>a.split('/').length-b.split('/').length)){
      const marker=FOLDER_MARKERS.map(m=>files.get(`${diskPath}/${m}`)).find(Boolean);
      const cached=(data.folders||[]).find(f=>f.path===diskPath);
      const id=marker?JSON.parse(marker.data.toString('utf8')).id:cached?.id||`folder-${hash(diskPath).slice(0,32)}`;
      const folder={id,title:path.posix.basename(diskPath),parentId:byDisk.get(parentPath(diskPath))?.id||'',diskPath,description:cached?.description||'',color:folderColor(cached?.color)};
      folders.push(folder);byDisk.set(diskPath,folder);
    }
    if(data.formatVersion!==3){
      const studies=upgradeBackup({notes:[],tasks:[],routine:[],studies:data.studies||[]}).folders;
      for(const study of studies){
        const related=notes.find(n=>n.folderId===study.id&&n.file&&parentPath(n.file)!=='Notas'&&parentPath(n.file));
        const expected=`Notas/${slug(study.title)}-${study.id.slice(0,8)}`;
        const existing=byDisk.get(related?parentPath(related.file):expected);
        if(existing){const oldId=existing.id;existing.id=study.id;existing.title=study.title;existing.description=study.description;for(const child of folders)if(child.parentId===oldId)child.parentId=study.id;}
        else folders.push({...study,diskPath:undefined});
      }
      // Legacy names may coincide with a real sibling directory; preserve both.
      const used=new Set();
      for(const folder of folders){const base=folder.title;let i=2;while(used.has(`${folder.parentId}/${pathKey(folder.title)}`))folder.title=`${base} (${i++})`;used.add(`${folder.parentId}/${pathKey(folder.title)}`);}
    }
    for(const note of notes){
      const legacyFolder=data.formatVersion!==3&&folders.find(f=>f.id===note.folderId);
      note.folderId=legacyFolder?.id||byDisk.get(note.file?parentPath(note.file):'')?.id||'';
    }
    // Fluxos (.canvas): o id mora no caderno.json, porque o Obsidian descartaria um campo
    // extra dentro do arquivo. Arquivo movido por fora ganha id novo; nada se perde.
    // Duas passadas: primeiro quem tem registro válido garante o id (em qualquer ordem de
    // arquivo), só depois o resto ganha um id por hash — testado contra os já usados, senão
    // um arquivo recriado no caminho de um fluxo renomeado colidiria com o id que ele levou.
    const registrados=Array.isArray(data.fluxos)?data.fluxos:[], idsUsados=new Set(notes.map(n=>n.id));
    const canvasFiles=[...files].filter(([file])=>visible(file)&&/\.canvas$/i.test(file)).sort(([a],[b])=>a.localeCompare(b));
    const idPorArquivo=new Map();
    for(const [file] of canvasFiles){
      const salvo=registrados.find(r=>r&&r.path===file&&/^[a-zA-Z0-9_-]{1,100}$/.test(r.id||''))?.id;
      if(salvo&&!idsUsados.has(salvo)){idPorArquivo.set(file,salvo);idsUsados.add(salvo);}
    }
    for(const [file] of canvasFiles){
      if(idPorArquivo.has(file))continue;
      let id=`fluxo-${hash(file).slice(0,32)}`,n=1;
      while(idsUsados.has(id))id=`fluxo-${hash(`${file}\n${n++}`).slice(0,32)}`;
      idPorArquivo.set(file,id);idsUsados.add(id);
    }
    const fluxos=canvasFiles.map(([file,value])=>{
      const lido=KiroFluxo.ler(value.data.toString('utf8'));
      return {id:idPorArquivo.get(file),file,title:path.posix.basename(file).replace(/\.canvas$/i,''),folderId:byDisk.get(parentPath(file))?.id||'',...(lido.erro?{erro:lido.erro}:{canvas:lido.canvas})};
    });
    const paths=folderPaths(folders);
    for(const f of folders)f.path=paths.get(f.id);
    const state=validateState(withHabits({formatVersion:3,notes,tasks:data.tasks,routine:data.routine,habits:data.habits,habitLog:data.habitLog,folders,fluxos}));
    const revision=hash(JSON.stringify([metadata,[...directories].sort(),[...files].sort(([a],[b])=>a.localeCompare(b)).map(([file,v])=>[file,hash(v.data)])]));
    return {state:{...state,revision,vaultPath:this.directory},files,directories,metadata};
  }
  load(){return this.exclusive(async()=>(await this.read()).state);}
  // Cópia de um único arquivo, fora da fila que tidy() poda. O sufixo no nome evita abrir cada pasta para saber.
  preservarVersao(arquivo){return this.exclusive(async()=>{
    const id=`${Date.now()}-${randomUUID()}${SUFIXO_PRESERVADA}`;
    await atomicWrite(await this.safePath(`.history/${id}/${arquivo}`),await fs.readFile(await this.safePath(arquivo)));
    return id;
  });}
  descartarVersaoPreservada(id){return this.exclusive(async()=>{
    if(!SNAPSHOT_ID.test(id||'')||!id.endsWith(SUFIXO_PRESERVADA))return;
    await fs.rm(await this.safePath(`.history/${id}`),{recursive:true,force:true});
  });}
  async historyNote({noteId,snapshotId}){
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(noteId||'')||!SNAPSHOT_ID.test(snapshotId||''))throw new Error(frase('Histórico inválido.'));
    const root=`.history/${snapshotId}`; let found=null;
    const walk=async(relative='')=>{
      for(const entry of await fs.readdir(await this.safePath(relative?`${root}/${relative}`:root),{withFileTypes:true})){
        if(entry.name.startsWith('.'))continue;
        const file=relative?`${relative}/${entry.name}`:entry.name, target=await this.safePath(`${root}/${file}`);
        if(entry.isDirectory())await walk(file);
        else if(entry.isFile()&&/\.md$/i.test(file)){
          const info=await fs.stat(target);if(info.size>20*1024*1024)throw new Error(frase('Nota do histórico grande demais.'));
          const note=parseMarkdown(await fs.readFile(target,'utf8'),file,info.mtimeMs);
          if(note.id===noteId){if(found)throw new Error(frase('ID duplicado no histórico.'));found=note;}
        }
      }
    };
    await walk();if(!found)throw new Error(frase('Nota não encontrada no histórico.'));
    return {body:found.body};
  }
  history({noteId}){return this.exclusive(async()=>{
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(noteId||''))throw new Error(frase('Nota inválida.'));
    let ids;try{ids=await fs.readdir(await this.safePath('.history'));}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const versions=[];
    for(const snapshotId of ids.filter(id=>SNAPSHOT_ID.test(id)).sort().reverse()){
      try{await this.historyNote({noteId,snapshotId});versions.push({snapshotId,when:Number(snapshotId.split('-')[0])});}
      catch(error){if(error.message!==frase('Nota não encontrada no histórico.'))throw error;}
    }
    return versions;
  });}
  readHistory(pedido){return this.exclusive(()=>this.historyNote(pedido));}
  restoreHistory({noteId,snapshotId,revision}){return this.locked(async()=>{
    const before=await this.read();if(before.state.revision!==revision)throw new Error(frase('O cofre mudou. Recarregue antes de restaurar.'));
    const note=before.state.notes.find(n=>n.id===noteId);if(!note)throw new Error(frase('Nota não encontrada.'));
    const {body}=await this.historyNote({noteId,snapshotId});
    note.body=body;note.updatedAt=Date.now();return this.write(before.state);
  });}
  locked(operation){
    return this.exclusive(async()=>{
      await fs.mkdir(this.directory,{recursive:true});const lockPath=await this.safePath('.kiro.lock');let lock;
      try{lock=await fs.open(lockPath,'wx');}catch(error){if(error.code==='EEXIST')throw new Error(frase('O cofre está ocupado. Verifique .kiro.lock se houve uma interrupção.'));throw error;}
      try{return await operation();}finally{await lock.close();await fs.unlink(lockPath);}
    });
  }
  save(input,{copiaParcial=false}={}){const snapshot=upgradeBackup(input);return this.locked(()=>this.write(snapshot,null,copiaParcial));}
  async write(input,restoring=null,copiaParcial=false){
    validateState(input);const before=await this.read();
    if(input.revision!==before.state.revision)throw new Error(frase('O cofre mudou em outro editor. Exporte suas alterações e recarregue antes de salvar.'));
    for(const note of input.notes){const old=before.state.notes.find(n=>n.id===note.id);if(old&&old.title!==note.title)input=aplicarRenomeacaoDeLinks(input,note.id,old.title,note.title).state;}
    const paths=folderPaths(input.folders), beforeFolders=before.state.folders;
    for(const folderPath of paths.values())if(!folderPath.includes('/')&&await temMarcaDeAnexos(path.join(this.directory,folderPath)))throw new Error(`A pasta "${folderPath}" guarda as imagens coladas nas notas. Escolha outro nome.`);
    const owner=file=>beforeFolders.filter(f=>f.diskPath&&inside(file,f.diskPath)).sort((a,b)=>b.diskPath.length-a.diskPath.length)[0];
    const remap=file=>{const f=owner(file);return f?(paths.has(f.id)?paths.get(f.id)+file.slice(f.diskPath.length):null):file;};
    const desired=new Map(), desiredDirs=new Set(), changes=new Map(), used=new Set();
    const put=(file,data)=>{
      const key=pathKey(file);if(used.has(key))throw new Error(`Já existe um arquivo no destino: ${file}`);
      used.add(key);desired.set(file,Buffer.isBuffer(data)?data:Buffer.from(data));
    };
    for(const dir of before.directories){const target=remap(dir);if(target)desiredDirs.add(target);}
    for(const destination of paths.values())desiredDirs.add(destination);
    const noteFiles=new Set(before.state.notes.map(n=>n.file).filter(Boolean));
    // Fluxos que este salvamento grava: os que vieram no input e não estão com erro. Os
    // demais (com erro, ou ausentes do input) seguem como arquivos comuns, preservados.
    const fluxosAntes=before.state.fluxos||[];
    const gravaveis=(input.fluxos||[]).filter(f=>f.canvas&&!fluxosAntes.find(x=>x.id===f.id)?.erro);
    const fluxoFiles=new Set(gravaveis.map(f=>fluxosAntes.find(x=>x.id===f.id)?.file).filter(Boolean));
    // Fluxos excluídos: só quando o input traz a lista. undefined = quem salvou não mexe em
    // fluxos (ex.: backup antigo) e nada é excluído. O arquivo sai do lugar e vai para a lixeira.
    const excluidos=input.fluxos===undefined?[]:fluxosAntes.filter(f=>!input.fluxos.some(x=>x.id===f.id));
    const arquivosExcluidos=new Set(excluidos.map(f=>f.file));
    for(const [file,value]of before.files){
      if(noteFiles.has(file)||fluxoFiles.has(file)||arquivosExcluidos.has(file)||FOLDER_MARKERS.includes(path.posix.basename(file)))continue;
      const target=remap(file);if(target){put(target,value.data);changes.set(pathKey(file),target);}
    }
    const nextNotes=input.notes.map(note=>{
      const old=before.state.notes.find(n=>n.id===note.id);
      const filename=old?.file?path.posix.basename(old.file):note.file?path.posix.basename(note.file.replace(/\\/g,'/')):`${slug(note.title)}-${note.id}.md`;
      const file=note.folderId?`${paths.get(note.folderId)}/${filename}`:filename;
      const source=old?.file||note.file?.replace(/\\/g,'/')||file;
      changes.set(pathKey(source),file);
      return {...note,file,source};
    });
    if(restoring){
      for(const dir of restoring.directories){const target=restoring.map(dir,paths);if(target)desiredDirs.add(target);}
      const archivedNotes=new Set(restoring.entry.notes.map(n=>n.file));
      for(const [file,data]of restoring.files){
        if(archivedNotes.has(file)||FOLDER_MARKERS.includes(path.posix.basename(file)))continue;
        const target=restoring.map(file,paths);if(target){put(target,data);changes.set(pathKey(file),target);}
      }
    }
    const registroDeFluxos=[];
    for(const fluxo of gravaveis){
      const old=fluxosAntes.find(f=>f.id===fluxo.id);
      const nome=`${fluxo.title}.canvas`;
      const file=fluxo.folderId?`${paths.get(fluxo.folderId)}/${nome}`:nome;
      if((!old||fluxo.title!==old.title)&&!validFolderName(fluxo.title))throw new Error(`Nome de fluxo inválido: ${fluxo.title}`);
      // Cartões de nota acompanham a nota que mudou de pasta (o mesmo `changes` do rewritePaths).
      const canvas=KiroFluxo.renomearArquivos(fluxo.canvas,f=>changes.get(pathKey(f)));
      const lido=KiroFluxo.ler(KiroFluxo.serializar(canvas));
      if(lido.erro)throw new Error(`Fluxo "${fluxo.title}": ${lido.erro}`);
      const anterior=old&&before.files.get(old.file)?.data;
      const igual=anterior&&JSON.stringify(old.canvas)===JSON.stringify(canvas);
      put(file,igual?anterior:KiroFluxo.serializar(canvas));
      if(old)changes.set(pathKey(old.file),file);
      registroDeFluxos.push({id:fluxo.id,path:file});
    }
    for(const old of fluxosAntes)if(!gravaveis.some(f=>f.id===old.id)&&!arquivosExcluidos.has(old.file)){const destino=remap(old.file);if(destino)registroDeFluxos.push({id:old.id,path:destino});}
    // Fluxo restaurado da lixeira: volta com o id de antes, se ninguém o usa agora.
    for(const f of restoring?.entry.fluxos||[]){
      const destino=restoring.map(f.file,paths);
      if(destino&&!registroDeFluxos.some(r=>r.id===f.id||pathKey(r.path)===pathKey(destino))&&!input.notes.some(n=>n.id===f.id))registroDeFluxos.push({id:f.id,path:destino});
    }
    for(const note of nextNotes){
      const old=before.state.notes.find(n=>n.id===note.id);
      const previous=before.files.get(old?.file)?.data.toString('utf8')||restoring?.files.get(note.source)?.toString('utf8')||'';
      note.body=rewritePaths(note.body,note.source,note.file,changes);
      const equal=old&&old.file===note.file&&['title','body','links','tags','folderId'].every(key=>JSON.stringify(old[key]??(key==='tags'?[]:''))===JSON.stringify(note[key]??(key==='tags'?[]:'')));
      // Stamp IDs on plain Markdown too, so external moves preserve associations.
      const identified=/^caderno-id:/m.test(previous);
      put(note.file,equal&&identified?previous:markdown(note,previous));
    }
    for(const folder of input.folders)put(`${paths.get(folder.id)}/${FOLDER_MARKER}`,JSON.stringify({id:folder.id}));
    const metadata=JSON.stringify({formatVersion:3,tasks:input.tasks,habits:input.habits||[],habitLog:input.habitLog||{},fluxos:registroDeFluxos,folders:input.folders.map(f=>({id:f.id,title:f.title,parentId:f.parentId||'',path:paths.get(f.id),description:f.description||'',color:folderColor(f.color)}))},null,2);
    put('caderno.json',metadata);
    for(const file of desired.keys()){
      await this.safePath(file);let parent=parentPath(file);while(parent){desiredDirs.add(parent);parent=parentPath(parent);}
    }
    for(const dir of desiredDirs)if(used.has(pathKey(dir)))throw new Error(`Uma pasta e um arquivo têm o mesmo destino: ${dir}`);
    const oldFiles=new Map(before.files);if(before.metadata!==null)oldFiles.set('caderno.json',{data:Buffer.from(before.metadata)});
    const writes=[...desired].filter(([file,data])=>!oldFiles.get(file)?.data.equals(data));
    const removals=[...oldFiles.keys()].filter(file=>!desired.has(file));
    const removedDirs=before.directories.filter(d=>!desiredDirs.has(d)).sort((a,b)=>b.length-a.length);
    if(!writes.length&&!removals.length&&!removedDirs.length&&desiredDirs.size===before.directories.length)return before.state;
    const transaction=`${Date.now()}-${randomUUID()}`, nomeDaCopia=`${transaction}${copiaParcial?SUFIXO_PARCIAL:''}`, backup=`.history/${nomeDaCopia}`, stage=`.staging/${transaction}`;
    // Back up attachments, hidden contents of visible folders, and empty folders.
    // Cópia parcial: tudo o que esta gravação sobrescreve ou remove, mais o caderno.json (tarefas e hábitos).
    const afetados=new Set([...writes.map(([file])=>file),...removals,'caderno.json']);
    for(const dir of copiaParcial?removedDirs:before.directories)await fs.mkdir(await this.safePath(`${backup}/${dir}`),{recursive:true});
    for(const [file,v]of oldFiles)if(!copiaParcial||afetados.has(file))await atomicWrite(await this.safePath(`${backup}/${file}`),v.data);
    for(const [file,data]of writes)await atomicWrite(await this.safePath(`${stage}/${file}`),data);
    if((await this.read()).state.revision!==input.revision)throw new Error(frase('O cofre mudou durante o salvamento. Recarregue antes de continuar.'));
    const deletedFolders=beforeFolders.filter(f=>!paths.has(f.id));
    const roots=deletedFolders.filter(f=>!deletedFolders.some(p=>p.id===f.parentId));
    const deletedNotes=before.state.notes.filter(n=>!input.notes.some(x=>x.id===n.id));
    const ancestors=folder=>{const chain=[];let id=folder.parentId;while(id){const p=beforeFolders.find(f=>f.id===id);if(!p)break;chain.unshift(p);id=p.parentId;}return chain;};
    for(const root of roots){
      const ids=descendants(beforeFolders,root.id);
      await this.archive(transaction,{kind:'folder',id:root.id,title:root.title,originalPath:root.diskPath||root.path,folders:deletedFolders.filter(f=>ids.has(f.id)),notes:deletedNotes.filter(n=>ids.has(n.folderId)),ancestors:ancestors(root)},before,fluxoFiles);
    }
    for(const note of deletedNotes)if(!roots.some(root=>descendants(beforeFolders,root.id).has(note.folderId))){
      const folder=beforeFolders.find(f=>f.id===note.folderId);
      await this.archive(transaction,{kind:'note',id:note.id,title:note.title,originalPath:note.file,folders:[],notes:[note],ancestors:folder?[...ancestors(folder),folder]:[]},before);
    }
    for(const fluxo of excluidos)if(!roots.some(root=>descendants(beforeFolders,root.id).has(fluxo.folderId))){
      const folder=beforeFolders.find(f=>f.id===fluxo.folderId);
      await this.archive(transaction,{kind:'fluxo',id:fluxo.id,title:fluxo.title,originalPath:fluxo.file,folders:[],notes:[],fluxos:[{id:fluxo.id,title:fluxo.title,file:fluxo.file}],ancestors:folder?[...ancestors(folder),folder]:[]},before);
    }
    await atomicWrite(await this.safePath('.transaction.json'),JSON.stringify({backup,stage,writes:writes.map(([f])=>f),removals,removedDirs},null,2));
    // Never recursively delete an active directory: unexpected external additions
    // cause rmdir to fail, preserving them and leaving the recovery journal.
    for(const file of removals)await fs.unlink(await this.safePath(file));
    for(const dir of removedDirs)await fs.rmdir(await this.safePath(dir));
    for(const dir of [...desiredDirs].sort((a,b)=>a.length-b.length))await fs.mkdir(await this.safePath(dir),{recursive:true});
    for(const [file]of writes)await fs.rename(await this.safePath(`${stage}/${file}`),await this.safePath(file));
    await fs.unlink(await this.safePath('.transaction.json'));
    try{await this.tidy(nomeDaCopia);}catch{/* a faxina não pode falhar um salvamento já aplicado */}
    return (await this.read()).state;
  }
  /** Pasta onde vão as imagens coladas: a primeira que está livre ou já é do Kiro. */
  async attachmentFolder(){
    for(const name of ATTACHMENT_FOLDERS){
      const directory=await this.safePath(name);
      if(!await pathExists(directory)||await temMarcaDeAnexos(directory))return name;
    }
    throw new Error(frase('Não há pasta livre para guardar imagens. Renomeie a pasta "Anexos" do cofre.'));
  }
  /** Guarda uma imagem e devolve o caminho relativo ao cofre, pronto para ![[...]]. */
  saveAttachment({name='',data}={}){
    return this.exclusive(async()=>{
      if(!Buffer.isBuffer(data)||!data.length)throw new Error(frase('Imagem vazia.'));
      if(data.length>ATTACHMENT_LIMIT)throw new Error(frase('Imagem maior que 250 MB.'));
      const extension=imageSignature(data)||audioSignature(data)||mp4Signature(data)||textSignature(data,typeof name==='string'?name.split('.').pop().toLowerCase():'');
      if(!extension)throw new Error(frase('O arquivo não é uma imagem PNG, JPEG, GIF, WebP, PDF, áudio WAV, MP3, WebM ou M4A, vídeo MP4, texto TXT, MD ou tabela CSV (até 5 MB).'));
      const folder=await this.attachmentFolder();
      // A marca vem antes da imagem: a pasta nunca aparece na varredura sem ela.
      const marker=await this.safePath(`${folder}/${ATTACHMENT_MARKER}`);
      if(!await pathExists(marker))await atomicWrite(marker,'Imagens coladas nas notas do Kiro. Esta marca tira a pasta da árvore de notas.\n');
      const stem=typeof name==='string'?path.basename(name.replace(/\\/g,'/')).replace(/\.[^.]*$/,''):'';
      const now=new Date(), two=n=>String(n).padStart(2,'0');
      // "image.png" é o nome genérico que o navegador dá a um print colado.
      const base=stem&&!/^image$/i.test(stem)?slug(stem):`colado-${now.getFullYear()}${two(now.getMonth()+1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
      const file=`${folder}/${base}-${randomUUID().slice(0,6)}.${extension}`;
      await atomicWrite(await this.safePath(file),data);
      return {path:file};
    });
  }
  /** Anexos das pastas marcadas, do mais novo para o mais antigo: só extensões servidas, nada oculto nem a marca. */
  async listAttachments(){
    const lista=[];
    for(const name of ATTACHMENT_FOLDERS){
      const directory=await this.safePath(name);
      if(!await pathExists(directory)||!await temMarcaDeAnexos(directory))continue;
      for(const entry of await fs.readdir(directory,{withFileTypes:true})){
        if(!entry.isFile()||entry.name.startsWith('.')||!entry.name.includes('.')||!IMAGE_TYPES[entry.name.split('.').pop().toLowerCase()])continue;
        const info=await fs.stat(path.join(directory,entry.name));
        lista.push({path:`${name}/${entry.name}`,name:entry.name,size:info.size,mtime:info.mtimeMs});
      }
    }
    return lista.sort((a,b)=>b.mtime-a.mtime).map(({mtime,...a})=>a);
  }
  /** Lê uma imagem do cofre para exibir. Só extensões de imagem e nada oculto. */
  async readAttachment(relative){
    const {file,type,extension}=await this.attachmentFile(relative);
    const info=await fs.stat(file);
    if(!info.isFile()||info.size>ATTACHMENT_LIMIT)throw new Error(frase('Imagem inválida.'));
    const data=await fs.readFile(file);
    checkAttachment(data,type,extension);
    return {data,type};
  }
  /** Pedido com Range (o <video> pede trechos): lê do disco só o trecho pedido, e a assinatura de áudio e vídeo pelo começo do arquivo. Devolve o mesmo que attachmentRange, mais o tipo. */
  async readAttachmentRange(relative,header){
    const {file,type,extension}=await this.attachmentFile(relative);
    const handle=await fs.open(file,'r');
    try{
      const info=await handle.stat();
      if(!info.isFile()||info.size>ATTACHMENT_LIMIT)throw new Error(frase('Imagem inválida.'));
      const ler=async(start,length)=>{const b=Buffer.alloc(length);const {bytesRead}=await handle.read(b,0,length,start);return b.subarray(0,bytesRead);};
      // Texto acima de 5 MB nem é lido: não passaria na conferência e custaria ler o arquivo inteiro.
      if(type.startsWith('text/')&&info.size>TEXT_LIMIT)throw new Error(frase('Texto inválido.'));
      // Texto (até 5 MB) e arquivo pequeno não ganham nada com o trecho: lidos inteiros, com a mesma conferência de readAttachment.
      if(type.startsWith('text/')||info.size<=ATTACHMENT_HEAD){const data=await ler(0,info.size);checkAttachment(data,type,extension);return {type,...attachmentRange(data,header)};}
      checkAttachment(await ler(0,ATTACHMENT_HEAD),type,extension,true);
      const r=rangeOf(info.size,header);
      return {type,status:r.status,headers:r.headers,data:r.status===416?Buffer.alloc(0):await ler(r.start,r.end-r.start+1)};
    }finally{await handle.close();}
  }
  // Extensão servida, nada oculto e caminho dentro do cofre: o que as duas leituras conferem antes de abrir o arquivo.
  async attachmentFile(relative){
    const type=typeof relative==='string'&&relative.includes('.')&&!relative.split('/').some(part=>part.startsWith('.'))&&IMAGE_TYPES[relative.split('.').pop().toLowerCase()];
    if(!type)throw new Error(frase('Imagem inválida.'));
    return {file:await this.safePath(relative),type,extension:relative.split('.').pop().toLowerCase()};
  }
  /** Plug-ins ficam em <cofre>/.kiro/plugins/<id>/. Só o que está nessa pasta é servido. */
  async pluginPath(id,arquivo=''){
    if(!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id||''))throw new Error(frase('Identificador de plug-in inválido.'));
    if(arquivo&&!/^[a-z0-9][a-z0-9._-]{0,60}$/i.test(arquivo))throw new Error(frase('Caminho de plug-in inválido.'));
    // safePath ainda vale aqui: é ele que barra link simbólico apontando para fora do cofre.
    return this.safePath(`.kiro/plugins/${id}${arquivo?`/${arquivo}`:''}`);
  }
  /** Lista as pastas de plug-in com o manifesto lido; quem estiver quebrado volta como erro. */
  async listPlugins(){
    const raiz=path.join(this.directory,'.kiro','plugins');
    let entradas=[];
    try{entradas=await fs.readdir(raiz,{withFileTypes:true});}catch(erro){if(erro.code==='ENOENT')return [];throw erro;}
    const achados=[];
    for(const entrada of entradas.sort((a,b)=>a.name.localeCompare(b.name))){
      if(!entrada.isDirectory())continue;
      try{
        const bruto=await fs.readFile(await this.pluginPath(entrada.name,'manifest.json'),'utf8');
        achados.push({id:entrada.name,manifesto:JSON.parse(bruto)});
      }catch(erro){
        achados.push({id:entrada.name,erro:erro instanceof SyntaxError?frase('manifest.json não é um JSON válido.'):erro.message});
      }
    }
    return achados;
  }
  /** Código e telas: .js para o worker, .html e .css para as molduras. */
  async readPluginFile(id,arquivo){
    const alvo=await this.pluginPath(id,arquivo);
    if(!/\.(js|html|css)$/i.test(arquivo))throw new Error(frase('Só arquivos .js, .html ou .css de plug-in são servidos.'));
    const info=await fs.stat(alvo);
    if(!info.isFile()||info.size>PLUGIN_FILE_LIMIT)throw new Error(frase('Arquivo de plug-in inválido.'));
    return fs.readFile(alvo);
  }
  async inspectPlugin(id) {
    const entries = await fs.readdir(await this.pluginPath(id), { withFileTypes: true });
    const result = []; let total = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/^(?:manifest\.json|[a-z0-9][a-z0-9._-]{0,60}\.(?:js|html|css))$/i.test(entry.name)) continue;
      const file = await this.pluginPath(id, entry.name), info = await fs.stat(file);
      if (!info.isFile() || info.size > PLUGIN_FILE_LIMIT) throw new Error(frase('Arquivo de plug-in inválido.'));
      const data = await fs.readFile(file); total += data.length;
      if (data.length > PLUGIN_FILE_LIMIT || total > 4 * 1024 * 1024 || result.length >= 100) throw new Error(frase('Arquivo de plug-in inválido.'));
      result.push({ name: entry.name, text: data.toString('utf8') });
    }
    return result;
  }
  /** Escolhas do usuário (ativado, permissões concedidas) em .kiro/plugins.json. */
  async readPluginChoices(){
    const bruto=await optionalRead(path.join(this.directory,'.kiro','plugins.json'));
    try{const dado=JSON.parse(bruto||'{}');return dado&&typeof dado==='object'&&!Array.isArray(dado)?dado:{};}
    catch{return {};}
  }
  async writePluginChoices(escolhas){
    await atomicWrite(path.join(this.directory,'.kiro','plugins.json'),`${JSON.stringify(escolhas,null,2)}\n`);
    return escolhas;
  }
  /** Layout da tela Hoje em .kiro/hoje.json. Quem valida é a página (hoje.js): aqui só se lê e grava. */
  async readHomeLayout(){
    const bruto=await optionalRead(path.join(this.directory,'.kiro','hoje.json'));
    if(!bruto)return null;
    try{return JSON.parse(bruto);}catch{return null;}
  }
  async writeHomeLayout(layout){
    await atomicWrite(path.join(this.directory,'.kiro','hoje.json'),`${JSON.stringify(layout,null,2)}\n`);
    return layout;
  }
  /** Favoritos e grupos em .kiro/favoritos.json. */
  async readBookmarks(){
    const bruto=await optionalRead(path.join(this.directory,'.kiro','favoritos.json'));
    if(!bruto)return {itens:[]};
    try{const dado=JSON.parse(bruto);return dado&&typeof dado==='object'&&!Array.isArray(dado)?dado:{itens:[]};}catch{return {itens:[]};}
  }
  async writeBookmarks(favoritos){
    const obj=favoritos&&typeof favoritos==='object'&&!Array.isArray(favoritos)?favoritos:{itens:[]};
    await atomicWrite(path.join(this.directory,'.kiro','favoritos.json'),`${JSON.stringify(obj,null,2)}\n`);
    return obj;
  }
  /** Dicionário pessoal do corretor em .kiro/dicionario.txt: uma palavra por linha. */
  async readDictionary(){
    const bruto=await optionalRead(path.join(this.directory,'.kiro','dicionario.txt'));
    return [...new Set((bruto||'').split(/\r?\n/).map(p=>p.trim()).filter(Boolean))];
  }
  async addToDictionary(palavra){
    if(!palavraParaDicionario(palavra))throw new Error(frase('Palavra inválida.'));
    const r=((this._fila??=Promise.resolve()).then(async()=>{const palavras=await this.readDictionary();if(!palavras.includes(palavra)){palavras.push(palavra);await atomicWrite(path.join(this.directory,'.kiro','dicionario.txt'),palavras.join('\n')+'\n');}return palavras;}));this._fila=r.catch(()=>{});return r;
  }
  /** Espaço do próprio plug-in (kiro.storage), com teto de 1 MB. */
  async readPluginData(id){
    const bruto=await optionalRead(await this.pluginPath(id,'data.json'));
    try{return JSON.parse(bruto||'{}');}catch{return {};}
  }
  async writePluginData(id,dados){
    const texto=`${JSON.stringify(dados,null,2)}\n`;
    if(Buffer.byteLength(texto)>PLUGIN_DATA_LIMIT)throw new Error(frase('O plug-in passou de 1 MB de dados guardados.'));
    await atomicWrite(await this.pluginPath(id,'data.json'),texto);
    return dados;
  }
  /**
   * Chamado só depois que a gravação foi aplicada e o journal removido.
   * Nesse ponto não há transação pendente: o que restou em .staging é lixo de
   * um salvamento interrompido cujo journal já foi resolvido, e os snapshots
   * mais antigos podem sair. A lixeira é independente e não é tocada aqui.
   */
  async tidy(transaction){
    await fs.rm(await this.safePath('.staging'),{recursive:true,force:true});
    if(!(this.historyLimit>0))return;
    let entradas;
    try{entradas=await fs.readdir(await this.safePath('.history'));}
    catch(erro){if(erro.code==='ENOENT')return;throw erro;}
    const ordenadas=entradas.filter(nome=>/^\d+-[\w-]+$/.test(nome)&&!nome.endsWith(SUFIXO_PRESERVADA)).sort((a,b)=>Number(a.split('-')[0])-Number(b.split('-')[0]));
    for(const fila of [ordenadas.filter(nome=>nome.endsWith(SUFIXO_PARCIAL)),ordenadas.filter(nome=>!nome.endsWith(SUFIXO_PARCIAL))]){
      for(const antiga of fila.slice(0,Math.max(0,fila.length-this.historyLimit))){
        if(antiga===transaction)continue;
        await fs.rm(await this.safePath(`.history/${antiga}`),{recursive:true,force:true});
      }
    }
  }
  async archive(transaction,entry,before,fluxosGravados=new Set()){
    const base=`.trash/${transaction}/${entry.id}`;
    const covers=file=>entry.kind==='folder'?entry.folders.some(f=>f.diskPath&&inside(file,f.diskPath)):file===entry.originalPath;
    // Guardar só anexos e as notas realmente excluídas. Uma nota que apenas saiu
    // da pasta continua viva em outro caminho; arquivá-la faria a restauração
    // recriar o arquivo e duplicar o caderno-id, quebrando a leitura do cofre.
    // O mesmo vale para um fluxo que saiu da pasta apagada nesta mesma gravação:
    // fluxosGravados traz o caminho antigo de quem já foi regravado noutro lugar.
    const arquivosDeNotas=new Set(before.state.notes.map(n=>n.file).filter(Boolean));
    const notasExcluidas=new Set(entry.notes.map(n=>n.file).filter(Boolean));
    entry.directories=before.directories.filter(covers);
    entry.files=[...before.files.keys()].filter(file=>covers(file)&&(!arquivosDeNotas.has(file)||notasExcluidas.has(file))&&!fluxosGravados.has(file));
    entry.deletedAt=Number(transaction.split('-')[0]);
    for(const file of entry.files)await atomicWrite(await this.safePath(`${base}/files/${file}`),before.files.get(file).data);
    await atomicWrite(await this.safePath(`${base}/entry.json`),JSON.stringify(entry));
  }
  async readTrash(entryId){
    if(!/^[\w-]+\/[\w-]+$/.test(entryId))throw new Error(frase('Item de lixeira inválido.'));
    const base=`.trash/${entryId}`;
    const current=await optionalRead(await this.safePath(`${base}/entry.json`));
    if(current)return JSON.parse(current);
    const old=await optionalRead(await this.safePath(`${base}/note.json`));
    if(!old)throw new Error(frase('Item não encontrado na lixeira.'));
    const note=JSON.parse(old);
    return {kind:'note',id:note.id,title:note.title,notes:[note],folders:[],ancestors:[],files:[],directories:[],deletedAt:Number(entryId.split('-')[0])};
  }
  trash(){return this.exclusive(async()=>{
    const current=(await this.read()).state;let transactions;
    try{transactions=await fs.readdir(await this.safePath('.trash'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const result=[];
    for(const transaction of transactions)for(const id of await fs.readdir(await this.safePath(`.trash/${transaction}`))){
      const entryId=`${transaction}/${id}`, entry=await this.readTrash(entryId);
      if(current.folders.some(f=>f.id===entry.id)||current.notes.some(n=>n.id===entry.id)||(current.fluxos||[]).some(f=>f.id===entry.id))continue;
      if(await optionalRead(await this.safePath(`.trash/${entryId}/restored`)))continue;
      result.push({...entry.notes[0],kind:entry.kind,id:entry.id,title:entry.title,entryId,deletedAt:entry.deletedAt,folderCount:entry.folders.length,noteCount:entry.notes.length});
    }
    return result.sort((a,b)=>b.deletedAt-a.deletedAt).filter((n,i,all)=>all.findIndex(x=>x.id===n.id)===i);
  });}
  restore({entryId,revision}){return this.locked(async()=>{
    const before=await this.read();if(before.state.revision!==revision)throw new Error(frase('O cofre mudou. Recarregue antes de restaurar.'));
    const entry=await this.readTrash(entryId), input=structuredClone(before.state);
    if(input.folders.some(f=>f.id===entry.id)||input.notes.some(n=>n.id===entry.id))throw new Error(frase('Este item já está no cofre.'));
    if((input.fluxos||[]).some(f=>f.id===entry.id))throw new Error(frase('Este item já está no cofre.'));
    for(const ancestor of entry.ancestors)if(!input.folders.some(f=>f.id===ancestor.id))input.folders.push(ancestor);
    for(const folder of entry.folders){if(input.folders.some(f=>f.id===folder.id))throw new Error(frase('Uma subpasta já existe no cofre.'));input.folders.push(folder);}
    for(const note of entry.notes){if(input.notes.some(n=>n.id===note.id))throw new Error(frase('Uma nota já existe no cofre.'));input.notes.push({...note,folderId:input.folders.some(f=>f.id===note.folderId)?note.folderId:''});}
    validateState(input);
    const files=new Map();for(const file of entry.files)files.set(file,await fs.readFile(await this.safePath(`.trash/${entryId}/files/${file}`)));
    const allFolders=[...entry.ancestors,...entry.folders];
    const map=(file,paths)=>{const f=allFolders.filter(f=>f.diskPath&&inside(file,f.diskPath)).sort((a,b)=>b.diskPath.length-a.diskPath.length)[0];return f?paths.get(f.id)+file.slice(f.diskPath.length):file;};
    const result=await this.write(input,{entry,files,directories:entry.directories,map});
    await atomicWrite(await this.safePath(`.trash/${entryId}/restored`),'true');return result;
  });}
  async entradasDaLixeira(){
    let transacoes;
    try{transacoes=await fs.readdir(await this.safePath('.trash'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const lista=[];
    for(const transacao of transacoes)for(const id of await fs.readdir(await this.safePath(`.trash/${transacao}`))){
      const entryId=`${transacao}/${id}`;
      try{lista.push({entryId,entry:await this.readTrash(entryId),restaurada:Boolean(await optionalRead(await this.safePath(`.trash/${entryId}/restored`)))});}
      catch{lista.push({entryId,entry:null,restaurada:false});} // ilegível: sai junto ao esvaziar, sem mexer no histórico
    }
    return lista;
  }
  // Cada gravação copia o cofre para .history: sem limpar lá, o texto "apagado" continuaria no disco.
  // ponytail: lê cada nota de cada cópia, o que demora em cofres enormes; é uma ação rara e pedida de propósito.
  async apagarDoHistorico(entradas,vivos){
    const notas=new Set(),fluxos=new Set(),arquivos=new Set(),pastas=new Set();
    for(const entry of entradas){
      if(!entry||vivos.has(entry.id))continue;
      for(const n of entry.notes||[])if(!vivos.has(n.id))notas.add(n.id);
      for(const f of entry.fluxos||[])if(!vivos.has(f.id))fluxos.add(f.id);
      for(const f of entry.files||[])if(!/\.md$/i.test(f))arquivos.add(f);
      for(const d of entry.directories||[])pastas.add(d);
    }
    let copias;
    try{copias=await fs.readdir(await this.safePath('.history'));}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const copia of copias){
      const raiz=`.history/${copia}`;
      const percorrer=async(relativo='')=>{
        for(const item of await fs.readdir(await this.safePath(relativo?`${raiz}/${relativo}`:raiz),{withFileTypes:true})){
          const arquivo=relativo?`${relativo}/${item.name}`:item.name,alvo=await this.safePath(`${raiz}/${arquivo}`);
          if(item.isDirectory()){await percorrer(arquivo);continue;}
          if(!item.isFile())continue;
          let apagar=arquivos.has(arquivo);
          if(!apagar&&/\.md$/i.test(arquivo)){try{apagar=notas.has(parseMarkdown(await fs.readFile(alvo,'utf8'),arquivo,0).id);}catch{/* não é uma nota legível */}}
          if(apagar)await fs.rm(alvo,{force:true});
        }
      };
      await percorrer();
      // Fluxos não guardam o id no arquivo: o registro do caderno.json da cópia diz onde cada um está.
      const caderno=await optionalRead(await this.safePath(`${raiz}/caderno.json`));
      if(caderno&&fluxos.size){
        let dados=null;try{dados=JSON.parse(caderno);}catch{/* cópia antiga ilegível */}
        if(Array.isArray(dados?.fluxos)){
          for(const r of dados.fluxos)if(fluxos.has(r?.id)&&typeof r.path==='string')await fs.rm(await this.safePath(`${raiz}/${r.path}`),{force:true});
          dados.fluxos=dados.fluxos.filter(r=>!fluxos.has(r?.id));
          await atomicWrite(await this.safePath(`${raiz}/caderno.json`),JSON.stringify(dados));
        }
      }
      for(const pasta of [...pastas].sort((a,b)=>b.length-a.length))await fs.rmdir(await this.safePath(`${raiz}/${pasta}`)).catch(()=>{}); // só sai se ficou vazia
    }
  }
  async tirarDaLixeira(entryId){
    await fs.rm(await this.safePath(`.trash/${entryId}`),{recursive:true,force:true});
    await fs.rmdir(await this.safePath(`.trash/${entryId.split('/')[0]}`)).catch(()=>{});
  }
  idsVivos(state){return new Set([...state.notes,...state.folders,...(state.fluxos||[])].map(x=>x.id));}
  purgeTrash({entryId}){return this.locked(async()=>{
    const alvo=await this.readTrash(entryId),vivos=this.idsVivos((await this.read()).state);
    if(vivos.has(alvo.id))throw new Error(frase('Este item já está no cofre.'));
    const ids=new Set((alvo.notes||[]).map(n=>n.id));
    // Versões anteriores do mesmo item saem junto, senão reapareceriam na lista.
    const entradas=(await this.entradasDaLixeira()).filter(x=>x.entry&&(x.entry.id===alvo.id||(x.restaurada&&(x.entry.notes||[]).some(n=>ids.has(n.id)))));
    await this.apagarDoHistorico(entradas.map(x=>x.entry),vivos);
    for(const {entryId:id} of entradas)await this.tirarDaLixeira(id);
  });}
  emptyTrash(){return this.locked(async()=>{
    const vivos=this.idsVivos((await this.read()).state),entradas=await this.entradasDaLixeira();
    await this.apagarDoHistorico(entradas.map(x=>x.entry),vivos);
    await fs.rm(await this.safePath('.trash'),{recursive:true,force:true});
  });}
}
module.exports={Vault,parseMarkdown,markdown,atomicWrite,rewritePaths,attachmentRange,imageSignature,HISTORY_LIMIT,ATTACHMENT_LIMIT};
