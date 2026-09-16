const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validateState, upgradeBackup, folderPaths, descendants, pathKey, folderColor, withHabits } = require('./domain.js');
const yaml = require('js-yaml');

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
  if (typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Metadados Markdown inválidos.');
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
const ATTACHMENT_LIMIT = 20 * 1024 * 1024;
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' };
// Pelo conteúdo, não pelo nome nem pelo tipo declarado. SVG fica de fora: pode carregar script.
function imageSignature(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString('latin1'))) return 'gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
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
  constructor(directory, { historyLimit = HISTORY_LIMIT } = {}) { this.directory = path.resolve(directory); this.queue = Promise.resolve(); this.historyLimit = historyLimit; }
  exclusive(operation) { const result=this.queue.then(operation); this.queue=result.catch(()=>{}); return result; }
  async safePath(relative) {
    if (typeof relative!=='string'||!relative||relative.includes(':')||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')) throw new Error('Caminho inválido.');
    const target=path.resolve(this.directory,relative);
    if(!target.startsWith(this.directory+path.sep))throw new Error('Caminho fora do cofre.');
    let cursor=this.directory;
    for(const part of relative.split('/')){
      cursor=path.join(cursor,part);
      try{if((await fs.lstat(cursor)).isSymbolicLink())throw new Error('Links simbólicos não são permitidos nas pastas gerenciadas.');}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return target;
  }
  async scan() {
    const files=new Map(), directories=[];
    const walk=async(relative='')=>{
      for(const entry of await fs.readdir(path.join(this.directory,relative),{withFileTypes:true})){
        if(!relative&&(entry.name.startsWith('.')||entry.name==='caderno.json'))continue;
        if(!relative&&entry.isDirectory()&&await temMarcaDeAnexos(path.join(this.directory,entry.name)))continue;
        const file=relative?`${relative}/${entry.name}`:entry.name;
        const target=await this.safePath(file);
        if(entry.isDirectory()){directories.push(file);await walk(file);}
        else if(entry.isFile()){const info=await fs.stat(target);files.set(file,{data:await fs.readFile(target),mtime:info.mtimeMs,birthtime:info.birthtimeMs});}
      }
    };
    await walk();return {files,directories};
  }
  async read() {
    await fs.mkdir(this.directory,{recursive:true});
    if(await optionalRead(await this.safePath('.transaction.json')))throw new Error('Salvamento interrompido. Preserve o cofre e consulte .transaction.json e .history antes de continuar.');
    const metadata=await optionalRead(await this.safePath('caderno.json'));
    const data=metadata===null?{notes:[],tasks:[],habits:[],habitLog:{},studies:[]}:JSON.parse(metadata);
    if(data.formatVersion&&![2,3].includes(data.formatVersion))throw new Error('Versão do cofre não suportada.');
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
    const paths=folderPaths(folders);
    for(const f of folders)f.path=paths.get(f.id);
    const state=validateState(withHabits({formatVersion:3,notes,tasks:data.tasks,routine:data.routine,habits:data.habits,habitLog:data.habitLog,folders}));
    const revision=hash(JSON.stringify([metadata,[...directories].sort(),[...files].sort(([a],[b])=>a.localeCompare(b)).map(([file,v])=>[file,hash(v.data)])]));
    return {state:{...state,revision,vaultPath:this.directory},files,directories,metadata};
  }
  load(){return this.exclusive(async()=>(await this.read()).state);}
  locked(operation){
    return this.exclusive(async()=>{
      await fs.mkdir(this.directory,{recursive:true});const lockPath=await this.safePath('.kiro.lock');let lock;
      try{lock=await fs.open(lockPath,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('O cofre está ocupado. Verifique .kiro.lock se houve uma interrupção.');throw error;}
      try{return await operation();}finally{await lock.close();await fs.unlink(lockPath);}
    });
  }
  save(input){const snapshot=upgradeBackup(input);return this.locked(()=>this.write(snapshot));}
  async write(input,restoring=null){
    validateState(input);const before=await this.read();
    if(input.revision!==before.state.revision)throw new Error('O cofre mudou em outro editor. Exporte suas alterações e recarregue antes de salvar.');
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
    for(const [file,value]of before.files){
      if(noteFiles.has(file)||FOLDER_MARKERS.includes(path.posix.basename(file)))continue;
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
    const metadata=JSON.stringify({formatVersion:3,tasks:input.tasks,habits:input.habits||[],habitLog:input.habitLog||{},folders:input.folders.map(f=>({id:f.id,title:f.title,parentId:f.parentId||'',path:paths.get(f.id),description:f.description||'',color:folderColor(f.color)}))},null,2);
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
    const transaction=`${Date.now()}-${randomUUID()}`, backup=`.history/${transaction}`, stage=`.staging/${transaction}`;
    // Back up attachments, hidden contents of visible folders, and empty folders.
    for(const dir of before.directories)await fs.mkdir(await this.safePath(`${backup}/${dir}`),{recursive:true});
    for(const [file,v]of oldFiles)await atomicWrite(await this.safePath(`${backup}/${file}`),v.data);
    for(const [file,data]of writes)await atomicWrite(await this.safePath(`${stage}/${file}`),data);
    if((await this.read()).state.revision!==input.revision)throw new Error('O cofre mudou durante o salvamento. Recarregue antes de continuar.');
    const deletedFolders=beforeFolders.filter(f=>!paths.has(f.id));
    const roots=deletedFolders.filter(f=>!deletedFolders.some(p=>p.id===f.parentId));
    const deletedNotes=before.state.notes.filter(n=>!input.notes.some(x=>x.id===n.id));
    const ancestors=folder=>{const chain=[];let id=folder.parentId;while(id){const p=beforeFolders.find(f=>f.id===id);if(!p)break;chain.unshift(p);id=p.parentId;}return chain;};
    for(const root of roots){
      const ids=descendants(beforeFolders,root.id);
      await this.archive(transaction,{kind:'folder',id:root.id,title:root.title,originalPath:root.diskPath||root.path,folders:deletedFolders.filter(f=>ids.has(f.id)),notes:deletedNotes.filter(n=>ids.has(n.folderId)),ancestors:ancestors(root)},before);
    }
    for(const note of deletedNotes)if(!roots.some(root=>descendants(beforeFolders,root.id).has(note.folderId))){
      const folder=beforeFolders.find(f=>f.id===note.folderId);
      await this.archive(transaction,{kind:'note',id:note.id,title:note.title,originalPath:note.file,folders:[],notes:[note],ancestors:folder?[...ancestors(folder),folder]:[]},before);
    }
    await atomicWrite(await this.safePath('.transaction.json'),JSON.stringify({backup,stage,writes:writes.map(([f])=>f),removals,removedDirs},null,2));
    // Never recursively delete an active directory: unexpected external additions
    // cause rmdir to fail, preserving them and leaving the recovery journal.
    for(const file of removals)await fs.unlink(await this.safePath(file));
    for(const dir of removedDirs)await fs.rmdir(await this.safePath(dir));
    for(const dir of [...desiredDirs].sort((a,b)=>a.length-b.length))await fs.mkdir(await this.safePath(dir),{recursive:true});
    for(const [file]of writes)await fs.rename(await this.safePath(`${stage}/${file}`),await this.safePath(file));
    await fs.unlink(await this.safePath('.transaction.json'));
    try{await this.tidy(transaction);}catch{/* a faxina não pode falhar um salvamento já aplicado */}
    return (await this.read()).state;
  }
  /** Pasta onde vão as imagens coladas: a primeira que está livre ou já é do Kiro. */
  async attachmentFolder(){
    for(const name of ATTACHMENT_FOLDERS){
      const directory=await this.safePath(name);
      if(!await pathExists(directory)||await temMarcaDeAnexos(directory))return name;
    }
    throw new Error('Não há pasta livre para guardar imagens. Renomeie a pasta "Anexos" do cofre.');
  }
  /** Guarda uma imagem e devolve o caminho relativo ao cofre, pronto para ![[...]]. */
  saveAttachment({name='',data}={}){
    return this.exclusive(async()=>{
      if(!Buffer.isBuffer(data)||!data.length)throw new Error('Imagem vazia.');
      if(data.length>ATTACHMENT_LIMIT)throw new Error('Imagem maior que 20 MB.');
      const extension=imageSignature(data);
      if(!extension)throw new Error('O arquivo não é uma imagem PNG, JPEG, GIF ou WebP.');
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
  /** Lê uma imagem do cofre para exibir. Só extensões de imagem e nada oculto. */
  async readAttachment(relative){
    const type=typeof relative==='string'&&relative.includes('.')&&!relative.split('/').some(part=>part.startsWith('.'))&&IMAGE_TYPES[relative.split('.').pop().toLowerCase()];
    if(!type)throw new Error('Imagem inválida.');
    const file=await this.safePath(relative);
    const info=await fs.stat(file);
    if(!info.isFile()||info.size>ATTACHMENT_LIMIT)throw new Error('Imagem inválida.');
    return {data:await fs.readFile(file),type};
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
    const ordenadas=entradas.filter(nome=>/^\d+-[\w-]+$/.test(nome)).sort((a,b)=>Number(a.split('-')[0])-Number(b.split('-')[0]));
    for(const antiga of ordenadas.slice(0,Math.max(0,ordenadas.length-this.historyLimit))){
      if(antiga===transaction)continue;
      await fs.rm(await this.safePath(`.history/${antiga}`),{recursive:true,force:true});
    }
  }
  async archive(transaction,entry,before){
    const base=`.trash/${transaction}/${entry.id}`;
    const covers=file=>entry.kind==='folder'?entry.folders.some(f=>f.diskPath&&inside(file,f.diskPath)):file===entry.originalPath;
    // Guardar só anexos e as notas realmente excluídas. Uma nota que apenas saiu
    // da pasta continua viva em outro caminho; arquivá-la faria a restauração
    // recriar o arquivo e duplicar o caderno-id, quebrando a leitura do cofre.
    const arquivosDeNotas=new Set(before.state.notes.map(n=>n.file).filter(Boolean));
    const notasExcluidas=new Set(entry.notes.map(n=>n.file).filter(Boolean));
    entry.directories=before.directories.filter(covers);
    entry.files=[...before.files.keys()].filter(file=>covers(file)&&(!arquivosDeNotas.has(file)||notasExcluidas.has(file)));
    entry.deletedAt=Number(transaction.split('-')[0]);
    for(const file of entry.files)await atomicWrite(await this.safePath(`${base}/files/${file}`),before.files.get(file).data);
    await atomicWrite(await this.safePath(`${base}/entry.json`),JSON.stringify(entry));
  }
  async readTrash(entryId){
    if(!/^[\w-]+\/[\w-]+$/.test(entryId))throw new Error('Item de lixeira inválido.');
    const base=`.trash/${entryId}`;
    const current=await optionalRead(await this.safePath(`${base}/entry.json`));
    if(current)return JSON.parse(current);
    const old=await optionalRead(await this.safePath(`${base}/note.json`));
    if(!old)throw new Error('Item não encontrado na lixeira.');
    const note=JSON.parse(old);
    return {kind:'note',id:note.id,title:note.title,notes:[note],folders:[],ancestors:[],files:[],directories:[],deletedAt:Number(entryId.split('-')[0])};
  }
  trash(){return this.exclusive(async()=>{
    const current=(await this.read()).state;let transactions;
    try{transactions=await fs.readdir(await this.safePath('.trash'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const result=[];
    for(const transaction of transactions)for(const id of await fs.readdir(await this.safePath(`.trash/${transaction}`))){
      const entryId=`${transaction}/${id}`, entry=await this.readTrash(entryId);
      if(current.folders.some(f=>f.id===entry.id)||current.notes.some(n=>n.id===entry.id))continue;
      if(await optionalRead(await this.safePath(`.trash/${entryId}/restored`)))continue;
      result.push({...entry.notes[0],kind:entry.kind,id:entry.id,title:entry.title,entryId,deletedAt:entry.deletedAt,folderCount:entry.folders.length,noteCount:entry.notes.length});
    }
    return result.sort((a,b)=>b.deletedAt-a.deletedAt).filter((n,i,all)=>all.findIndex(x=>x.id===n.id)===i);
  });}
  restore({entryId,revision}){return this.locked(async()=>{
    const before=await this.read();if(before.state.revision!==revision)throw new Error('O cofre mudou. Recarregue antes de restaurar.');
    const entry=await this.readTrash(entryId), input=structuredClone(before.state);
    if(input.folders.some(f=>f.id===entry.id)||input.notes.some(n=>n.id===entry.id))throw new Error('Este item já está no cofre.');
    for(const ancestor of entry.ancestors)if(!input.folders.some(f=>f.id===ancestor.id))input.folders.push(ancestor);
    for(const folder of entry.folders){if(input.folders.some(f=>f.id===folder.id))throw new Error('Uma subpasta já existe no cofre.');input.folders.push(folder);}
    for(const note of entry.notes){if(input.notes.some(n=>n.id===note.id))throw new Error('Uma nota já existe no cofre.');input.notes.push({...note,folderId:input.folders.some(f=>f.id===note.folderId)?note.folderId:''});}
    validateState(input);
    const files=new Map();for(const file of entry.files)files.set(file,await fs.readFile(await this.safePath(`.trash/${entryId}/files/${file}`)));
    const allFolders=[...entry.ancestors,...entry.folders];
    const map=(file,paths)=>{const f=allFolders.filter(f=>f.diskPath&&inside(file,f.diskPath)).sort((a,b)=>b.diskPath.length-a.diskPath.length)[0];return f?paths.get(f.id)+file.slice(f.diskPath.length):file;};
    const result=await this.write(input,{entry,files,directories:entry.directories,map});
    await atomicWrite(await this.safePath(`.trash/${entryId}/restored`),'true');return result;
  });}
}
module.exports={Vault,parseMarkdown,markdown,atomicWrite,rewritePaths,HISTORY_LIMIT};
