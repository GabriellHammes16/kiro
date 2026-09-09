const FOLDER_MARKER = '.kuroi-folder.json';
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
  constructor(directory) { this.directory = path.resolve(directory); this.queue = Promise.resolve(); }
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
        const file=relative?`${relative}/${entry.name}`:entry.name;
        const target=await this.safePath(file);
        if(entry.isDirectory()){directories.push(file);await walk(file);}
        else if(entry.isFile())files.set(file,{data:await fs.readFile(target),mtime:(await fs.stat(target)).mtimeMs});
      }
    };
    await walk();return {files,directories};
  }
  async read() {
    await fs.mkdir(this.directory,{recursive:true});
    if(await optionalRead(await this.safePath('.transaction.json')))throw new Error('Salvamento interrompido. Preserve o cofre e consulte .transaction.json e .history antes de continuar.');
    const metadata=await optionalRead(await this.safePath('caderno.json'));
    const data=metadata===null?{notes:[],tasks:[],routine:[],studies:[]}:JSON.parse(metadata);
    if(data.formatVersion&&![2,3].includes(data.formatVersion))throw new Error('Versão do cofre não suportada.');
    const {files,directories}=await this.scan();
    const legacy=data.formatVersion?[]:validateState(data).notes;
    const notes=[...files].filter(([file])=>visible(file)&&/\.md$/i.test(file)).map(([file,value])=>parseMarkdown(value.data.toString('utf8'),file,value.mtime,legacy.find(n=>file===`Notas/${(n.file||'').replace(/\\/g,'/')}`)||{}));
    for(const n of legacy)if(!notes.some(x=>x.id===n.id))notes.push({...n,file:undefined});
    const folders=[], byDisk=new Map();
    for(const diskPath of directories.filter(visible).sort((a,b)=>a.split('/').length-b.split('/').length)){
      const marker=files.get(`${diskPath}/${FOLDER_MARKER}`);
      const cached=(data.folders||[]).find(f=>f.path===diskPath);
      const id=marker?JSON.parse(marker.data.toString('utf8')).id:cached?.id||`folder-${hash(diskPath).slice(0,32)}`;
      const folder={id,title:path.posix.basename(diskPath),parentId:byDisk.get(parentPath(diskPath))?.id||'',diskPath,description:cached?.description||''};
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
    const state=validateState({formatVersion:3,notes,tasks:data.tasks,routine:data.routine,folders});
    const revision=hash(JSON.stringify([metadata,[...directories].sort(),[...files].sort(([a],[b])=>a.localeCompare(b)).map(([file,v])=>[file,hash(v.data)])]));
    return {state:{...state,revision,vaultPath:this.directory},files,directories,metadata};
  }
  load(){return this.exclusive(async()=>(await this.read()).state);}
  locked(operation){
    return this.exclusive(async()=>{
      await fs.mkdir(this.directory,{recursive:true});const lockPath=await this.safePath('.kuroi.lock');let lock;
      try{lock=await fs.open(lockPath,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('O cofre está ocupado. Verifique .kuroi.lock se houve uma interrupção.');throw error;}
      try{return await operation();}finally{await lock.close();await fs.unlink(lockPath);}
    });
  }
  save(input){const snapshot=upgradeBackup(input);return this.locked(()=>this.write(snapshot));}
  async write(input,restoring=null){
    validateState(input);const before=await this.read();
    if(input.revision!==before.state.revision)throw new Error('O cofre mudou em outro editor. Exporte suas alterações e recarregue antes de salvar.');
    const paths=folderPaths(input.folders), beforeFolders=before.state.folders;
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
      if(noteFiles.has(file)||path.posix.basename(file)===FOLDER_MARKER)continue;
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
        if(archivedNotes.has(file)||path.posix.basename(file)===FOLDER_MARKER)continue;
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
    const metadata=JSON.stringify({formatVersion:3,tasks:input.tasks,routine:input.routine,folders:input.folders.map(f=>({id:f.id,title:f.title,parentId:f.parentId||'',path:paths.get(f.id),description:f.description||''}))},null,2);
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
    return (await this.read()).state;
  }
  async archive(transaction,entry,before){
    const base=`.trash/${transaction}/${entry.id}`;
    const covers=file=>entry.kind==='folder'?entry.folders.some(f=>f.diskPath&&inside(file,f.diskPath)):file===entry.originalPath;
    entry.directories=before.directories.filter(covers);entry.files=[...before.files.keys()].filter(covers);entry.deletedAt=Number(transaction.split('-')[0]);
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
module.exports={Vault,parseMarkdown,markdown,atomicWrite,rewritePaths};
