/* CineMood — sincronizzazione dati personali per UID Firebase.
   Condivide solo preferiti, visti, stagioni, episodi, voti.
   Ogni modifica viene applicata in transazione al documento corrente:
   nessuna copia completa di uno stato potenzialmente obsoleto. */
(function(){
  'use strict';
  const SHARED = ['favorites','watched','watchedSeasons','watchedEpisodes','ratings'];
  const clone = value => JSON.parse(JSON.stringify(value === undefined ? null : value));
  const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj || {},key);
  function normalize(raw) {
    const value = raw || {};
    return {
      favorites:{movie:clone(value.favorites?.movie || []),tv:clone(value.favorites?.tv || [])},
      watched:{movie:clone(value.watched?.movie || {}),tv:clone(value.watched?.tv || {})},
      watchedSeasons:clone(value.watchedSeasons || {}),
      watchedEpisodes:clone(value.watchedEpisodes || {}),
      ratings:{movie:clone(value.ratings?.movie || {}),tv:clone(value.ratings?.tv || {})},
      displayName:value.displayName || '',
      platforms:clone(value.platforms || []),
      notificationPrefs:clone(value.notificationPrefs || {})
    };
  }
  function ids(list) {
    const out = new Map();
    (Array.isArray(list) ? list : []).forEach(item => {
      if(item && item.id != null) out.set(String(item.id),item);
    });
    return out;
  }
  function difference(beforeRaw,afterRaw,extras) {
    const a=normalize(beforeRaw), b=normalize(afterRaw), changes=[];
    for(const type of ['movie','tv']){
      const oldFav=ids(a.favorites[type]), newFav=ids(b.favorites[type]);
      for(const id of new Set([...oldFav.keys(),...newFav.keys()])){
        if(JSON.stringify(oldFav.get(id))!==JSON.stringify(newFav.get(id)))
          changes.push({kind:'fav',type,id,value:clone(newFav.get(id) || null)});
      }
      for(const kind of ['watched','ratings']){
        const x=a[kind][type], y=b[kind][type];
        for(const id of new Set([...Object.keys(x),...Object.keys(y)])){
          if(JSON.stringify(x[id])!==JSON.stringify(y[id]))
            changes.push({kind,type,id,value:own(y,id)?clone(y[id]):null});
        }
      }
    }
    for(const kind of ['watchedSeasons','watchedEpisodes']){
      const x=a[kind],y=b[kind];
      for(const id of new Set([...Object.keys(x),...Object.keys(y)])){
        const oldSet=new Set((x[id]||[]).map(Number));
        const newSet=new Set((y[id]||[]).map(Number));
        for(const n of new Set([...oldSet,...newSet])){
          if(oldSet.has(n)!==newSet.has(n))
            changes.push({kind,id,number:n,value:newSet.has(n)});
        }
      }
    }
    if(extras) for(const key of ['displayName','platforms','notificationPrefs']){
      if(JSON.stringify(a[key])!==JSON.stringify(b[key]))
        changes.push({kind:'extra',key,value:clone(b[key])});
    }
    return changes;
  }
  function applyChanges(original,changes){
    const out=normalize(original);
    for(const op of changes){
      if(op.kind==='fav'){
        const map=ids(out.favorites[op.type]);
        if(op.value===null) map.delete(op.id); else map.set(op.id,op.value);
        out.favorites[op.type]=[...map.values()];
      }else if(op.kind==='watched' || op.kind==='ratings'){
        if(op.value===null || op.value===false) delete out[op.kind][op.type][op.id];
        else out[op.kind][op.type][op.id]=op.value;
      }else if(op.kind==='watchedEpisodes' || op.kind==='watchedSeasons'){
        const values=new Set((out[op.kind][op.id]||[]).map(Number));
        if(op.value) values.add(op.number);else values.delete(op.number);
        if(values.size) out[op.kind][op.id]=[...values].sort((a,b)=>a-b);
        else delete out[op.kind][op.id];
      }else if(op.kind==='extra'){
        out[op.key]=op.value;
      }
    }
    return out;
  }
  function unionInitial(remoteRaw,privateRaw){
    const r=normalize(remoteRaw),p=normalize(privateRaw);
    for(const type of ['movie','tv']){
      // Il documento pubblico ha priorita' in caso di duplicati.
      r.favorites[type]=[...new Map([...ids(p.favorites[type]),...ids(r.favorites[type])]).values()];
      r.watched[type]={...p.watched[type],...r.watched[type]};
      r.ratings[type]={...p.ratings[type],...r.ratings[type]};
    }
    for(const kind of ['watchedSeasons','watchedEpisodes']){
      for(const key of Object.keys(p[kind])){
        r[kind][key]=[...new Set([...(r[kind][key]||[]),...(p[kind][key]||[])].map(Number))]
          .sort((a,b)=>a-b);
      }
    }
    return r;
  }
  class CineMoodPersonalSync {
    constructor(db,uid,options){
      this.db=db;
      this.uid=uid;
      this.ref=db.collection('profiles').doc(uid);
      this.options=options;
      this.last=null;
      this.queue=[];
      this.inflightOps=[];
      this.pendingKey='cinemood-personal-sync-pending-'+uid;
      this.busy=false;
      this.ready=false;
      this.unsubscribe=null;
      this.retryTimer=null;
    }
    savePending(){
      try{localStorage.setItem(this.pendingKey,JSON.stringify([...this.inflightOps,...this.queue]));}
      catch(e){this.options.status?.('Spazio locale non disponibile per la coda di sincronizzazione');}
    }
    begin(data){
      if(this.unsubscribe) this.unsubscribe();
      this.last=normalize(data);
      try{
        const stored=JSON.parse(localStorage.getItem(this.pendingKey)||'[]');
        if(Array.isArray(stored))this.queue.unshift(...stored);
      }catch(e){this.options.status?.('Coda di sincronizzazione locale non leggibile');}
      this.ready=true;
      this.unsubscribe=this.ref.onSnapshot(snap=>{
        if(!snap.exists || snap.metadata.hasPendingWrites || this.busy || this.queue.length)return;
        const remote=normalize(snap.data());
        if(JSON.stringify(remote)===JSON.stringify(this.last))return;
        this.last=clone(remote);
        this.options.apply(clone(remote));
      },err=>this.options.status?.('Errore sincronizzazione: '+err.code));
      if(this.queue.length)this.flush();
    }
    async connectPrivate(privateData){
      // La prima unione avviene una sola volta per questo UID, non a ogni accesso.
      const before=await this.ref.get({source:'server'});
      if(!before.exists)throw Error('Prima accedi a CineMood pubblico con questo account Google.');
      const previous=before.data();
      // Non sovrascrivere il backup pre-unione quando l'utente riapre l'app.
      if(previous.cinemoodPrivateLink?.version!==1){
        try{
          const backupKey='cinemood-link-backup-'+this.uid;
          if(!localStorage.getItem(backupKey)){
            localStorage.setItem(backupKey,JSON.stringify({
              createdAt:new Date().toISOString(),private:privateData,public:previous
            }));
          }
        }catch(e){throw Error('Backup locale non riuscito: collegamento annullato.');}
      }
      await this.db.runTransaction(async tx=>{
        const snap=await tx.get(this.ref);
        if(!snap.exists)throw Error('Profilo pubblico non trovato.');
        const data=snap.data();
        if(data.cinemoodPrivateLink?.version===1)return;
        const merged=unionInitial(data,privateData);
        const patch={cinemoodPrivateLink:{version:1,linkedAt:new Date().toISOString()}};
        for(const k of SHARED)patch[k]=merged[k];
        tx.set(this.ref,patch,{mergeFields:[...SHARED,'cinemoodPrivateLink']});
      });
      const current=await this.ref.get({source:'server'});
      this.options.apply(normalize(current.data()));
      this.begin(current.data());
    }
    persist(current){
      if(!this.ready)return false;
      const next=normalize(current);
      // Wishlist: a newly watched title must leave favorites atomically.
      // Never remove old favorites retroactively or re-add one on "unwatch".
      let moved=false;
      for(const type of ['movie','tv']){
        for(const [id,seen] of Object.entries(next.watched[type])){
          if(seen!==true || this.last?.watched?.[type]?.[id]===true)continue;
          const original=next.favorites[type];
          next.favorites[type]=original.filter(item=>String(item.id)!==String(id));
          if(next.favorites[type].length!==original.length)moved=true;
        }
      }
      if(moved)this.options.apply(clone(next));
      const ops=difference(this.last,next,!!this.options.extras);
      this.last=clone(next);
      if(ops.length){
        this.queue.push(...ops);
        this.savePending();
        this.flush();
      }
      return true;
    }
    async flush(){
      if(this.busy || !this.queue.length)return;
      this.busy=true;
      let failure=false;
      while(this.queue.length){
        const batch=this.queue.splice(0);
        this.inflightOps=batch;
        this.savePending();
        try{
          await this.db.runTransaction(async tx=>{
            const snap=await tx.get(this.ref);
            if(!snap.exists)throw Error('Profilo Firebase mancante');
            const updated=applyChanges(snap.data(),batch);
            const patch={};
            const touched=new Set();
            for(const op of batch)touched.add(op.kind==='extra'?op.key:
              op.kind==='fav'?'favorites':op.kind);
            for(const field of touched)patch[field]=updated[field];
            // A confirmed explicit "non visto" must not be undone by importing old Emby history.
            // Store only the touched watch IDs and an ordering timestamp, never a list of unseen titles.
            const watchOps=batch.filter(op=>op.kind==='watched');
            const favoriteOps=batch.filter(op=>op.kind==='fav');
            const now=new Date().toISOString();
            if(watchOps.length){
              const overrides={...(snap.data().cinemoodWatchOverrides||{})};
              for(const op of watchOps){
                if(!['movie','tv'].includes(op.type)||!/^[0-9]+$/.test(String(op.id)))continue;
                overrides[op.type+':'+op.id]={watched:op.value===true,updatedAt:now};
              }
              patch.cinemoodWatchOverrides=overrides;
              touched.add('cinemoodWatchOverrides');
            }
            if(favoriteOps.length){
              const overrides={...(snap.data().cinemoodFavoriteOverrides||{})};
              for(const op of favoriteOps){
                if(!['movie','tv'].includes(op.type)||!/^[0-9]+$/.test(String(op.id)))continue;
                overrides[op.type+':'+op.id]={favorite:op.value!==null,updatedAt:now};
              }
              patch.cinemoodFavoriteOverrides=overrides;
              touched.add('cinemoodFavoriteOverrides');
            }
            tx.set(this.ref,patch,{mergeFields:[...touched]});
          });
          this.inflightOps=[];
          this.savePending();
          this.options.status?.('Sincronizzato');
        }catch(e){
          this.inflightOps=[];
          this.queue.unshift(...batch);
          this.savePending();
          this.options.status?.('Sync in attesa: '+(e.code || 'connessione non disponibile'));
          failure=true;
          break;
        }
      }
      this.busy=false;
      if(failure){
        if(!this.retryTimer)this.retryTimer=setTimeout(()=>{
          this.retryTimer=null;this.flush();
        },15000);
        return;
      }
      try{
        const latest=await this.ref.get({source:'server'});
        if(!this.busy&&!this.queue.length&&latest.exists){
          const remote=normalize(latest.data());
          this.last=clone(remote);
          this.options.apply(clone(remote));
        }
      }catch(e){ /* Il listener riallinea lo stato alla riconnessione. */ }
    }
    close(){
      if(this.unsubscribe)this.unsubscribe();
      if(this.retryTimer)clearTimeout(this.retryTimer);
      this.ready=false;
    }
  }
  CineMoodPersonalSync.difference=difference;
  window.CineMoodPersonalSync=CineMoodPersonalSync;
})();
