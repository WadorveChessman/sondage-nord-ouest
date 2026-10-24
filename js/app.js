/* SONDAGE NORD-OUEST — mode local (localStorage). Aucune dépendance, aucun build. */
(()=>{
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const POSTS=['Député','Magistrat communal','CASEC','Sénateur'];
/* À vérifier avant production. */
const COMMUNES=['Port-de-Paix','Bassin-Bleu','Chansolme','Île de la Tortue','Saint-Louis-du-Nord','Anse-à-Foleur','Môle-Saint-Nicolas','Bombardopolis','Baie-de-Henne','Jean-Rabel'];
let db=JSON.parse(localStorage.getItem('snw')||'null')||{cands:[],polls:[],resp:[],admin:null,log:[]};
const save=()=>localStorage.setItem('snw',JSON.stringify(db));
const myKey=()=>{let k=localStorage.getItem('snw_key');if(!k){k=uid()+uid();localStorage.setItem('snw_key',k)}return k};
const isAdmin=()=>sessionStorage.getItem('snw_admin')==='1';
const sha=async t=>{const s='snw'+t;if(!(window.crypto&&crypto.subtle))return btoa(unescape(encodeURIComponent(s)));return[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('')};
const log=a=>{db.log.unshift({a,d:new Date().toLocaleString('fr-FR')});db.log=db.log.slice(0,100)};
const status=p=>{if(p.status==='draft')return'brouillon';if(p.status==='closed')return'fermé';const n=Date.now();return n<new Date(p.start)?'programmé':n>new Date(p.end)?'terminé':'actif'};
const tally=p=>{const r=db.resp.filter(x=>x.poll===p.id),t=r.length;return{t,rows:db.cands.filter(c=>p.cands.includes(c.id)).map(c=>{const n=r.filter(x=>x.cand===c.id).length;return{c,n,pct:t?n/t*100:0}})}};
const canShow=p=>p.status!=='draft'&&tally(p).t>=(+p.min||0)&&(p.vis==='live'||['terminé','fermé'].includes(status(p)));
const nm=c=>c.first+' '+c.last,terr=id=>id||'Nord-Ouest (département)';
const fmt=d=>d?new Date(d).toLocaleString('fr-FR'):'—';
const photo=c=>c.photo?`<img class="ph" src="${esc(c.photo)}" alt="">`:`<div class="ph">${esc((c.first[0]||'')+(c.last[0]||''))}</div>`;
const candCard=c=>`<div class="card"><div style="display:flex;gap:.8rem">${photo(c)}<div><b>${esc(nm(c))}</b><br><span class="tag">${esc(c.party||'Indépendant')}</span></div></div><p>${esc(c.post)} — ${esc(terr(c.commune))}</p><p class="muted">${esc((c.bio||'').slice(0,120))}</p></div>`;
const pollCard=p=>`<div class="card"><b>${esc(p.title)}</b><p>${esc(p.post)} — ${esc(terr(p.commune))}<br><span class="tag">${status(p)}</span></p><p class="muted">${fmt(p.start)} → ${fmt(p.end)}</p>${status(p)==='actif'?`<a class="btn" href="#/participer/${p.id}">Participer</a>`:''}</div>`;
const pub=()=>db.polls.filter(p=>p.status!=='draft');
const bars=p=>{const t=tally(p);if(!canShow(p))return`<p class="msg info">Résultats non publiables pour le moment (règles de publication ou seuil minimal de ${+p.min||0} participations).</p>`;
 if(!t.t)return'<p class="msg info">Aucune participation enregistrée.</p>';
 return`<p>${t.t} participation(s) valide(s)</p>`+t.rows.sort((a,b)=>b.n-a.n).map(r=>`<p>${esc(nm(r.c))} — <b>${r.pct.toFixed(1)} %</b> (${r.n})<div class="bar"><i style="width:${r.pct}%"></i></div></p>`).join('')};
const opts=(a,sel)=>a.map(x=>`<option ${x===sel?'selected':''}>${esc(x)}</option>`).join('');

const P={};
P['/']=()=>{const act=db.polls.filter(p=>status(p)==='actif');
 return`<section class="hero"><small>L'opinion citoyenne au cœur de la démocratie</small><h1>Qui souhaitez-vous voir représenter votre commune ?</h1><p>Exprimez votre préférence dans les sondages d'opinion du Nord-Ouest d'Haïti.</p><a class="btn" style="background:var(--warn)" href="#/sondages">Participer maintenant</a> <a class="btn alt" href="#/resultats">Consulter les résultats</a></section>
 <h2>En chiffres</h2><div class="grid">${[['Candidats publiés',db.cands.filter(c=>c.pub).length],['Sondages actifs',act.length],['Participations',db.resp.length],['Communes couvertes',new Set(db.polls.map(p=>p.commune).filter(Boolean)).size]].map(([l,v])=>`<div class="card"><div class="stat">${v}</div>${l}</div>`).join('')}</div>
 <h2>Sondages en cours</h2><div class="grid">${act.map(pollCard).join('')||'<p class="msg info">Aucun sondage actif. L\'administrateur doit en publier un.</p>'}</div>
 <h2>Candidats à découvrir</h2><div class="grid">${db.cands.filter(c=>c.pub).slice(0,6).map(candCard).join('')||'<p class="msg info">Aucun candidat publié pour le moment.</p>'}</div>`};
P['/sondages']=()=>`<h1>Les sondages</h1><div class="grid">${pub().map(pollCard).join('')||'<p class="msg info">Aucun sondage publié.</p>'}</div>`;
P['/candidats']=()=>{setTimeout(()=>{const f=()=>{const q=$('#q').value.toLowerCase(),po=$('#fp').value,co=$('#fc').value;
 $('#cl').innerHTML=db.cands.filter(c=>c.pub&&nm(c).toLowerCase().includes(q)&&(!po||c.post===po)&&(!co||c.commune===co)).map(candCard).join('')||'<p class="msg info">Aucun candidat ne correspond à ces filtres.</p>'};
 let t;$('#q').oninput=()=>{clearTimeout(t);t=setTimeout(f,250)};$('#fp').onchange=$('#fc').onchange=f;f()});
 return`<h1>Les candidats</h1><div class="filters"><input id="q" placeholder="Rechercher un nom"><select id="fp"><option value="">Tous les postes</option>${opts(POSTS)}</select><select id="fc"><option value="">Toutes les communes</option>${opts(COMMUNES)}</select></div><div id="cl" class="grid"></div>`};
P['/resultats']=()=>`<h1>Résultats</h1>${pub().map(p=>`<div class="card"><b>${esc(p.title)}</b> <span class="tag">${status(p)}</span>${bars(p)}</div>`).join('')||'<p class="msg info">Aucun sondage.</p>'}<p class="muted">Ces pourcentages décrivent les participants de la plateforme, pas la population.</p>`;
P['/methodologie']=()=>`<h1>Méthodologie</h1><div class="card"><p>Plateforme de sondages d'opinion <b>non officielle</b> : aucun lien avec le CEP.</p><p>Pourcentage = préférences valides du candidat ÷ total des préférences valides × 100 (0 si aucune participation).</p><p>Les participants ne sont pas un échantillon représentatif. En mode local, une participation par navigateur et par sondage est autorisée ; cela ne garantit pas une personne unique (on peut vider les données du navigateur).</p></div>`;
P['/apropos']=()=>`<h1>À propos, confidentialité, contact</h1><div class="card"><p>SONDAGE NORD-OUEST — « L'opinion citoyenne au cœur de la démocratie ».</p><p>Aucune donnée personnelle n'est demandée. Une clé aléatoire est conservée dans votre navigateur pour limiter les participations répétées.</p><p>Contact : à renseigner par l'administrateur.</p></div>`;
P['/participer']=id=>{const p=db.polls.find(x=>x.id===id);if(!p)return'<p class="msg err">Sondage introuvable.</p>';
 const s=status(p);if(s!=='actif')return`<p class="msg err">Ce sondage est ${s} : participation impossible.</p>`;
 if(db.resp.some(r=>r.poll===p.id&&r.key===myKey()))return'<p class="msg ok">Vous avez déjà participé à ce sondage. Merci !</p>';
 const cs=db.cands.filter(c=>p.cands.includes(c.id)&&c.pub);
 setTimeout(()=>{let sel=null;const btn=$('#ok');
  document.querySelectorAll('.pick').forEach(el=>el.onclick=()=>{sel=el.dataset.id;document.querySelectorAll('.pick').forEach(x=>x.classList.toggle('sel',x===el));const c=cs.find(x=>x.id===sel);$('#rec').innerHTML=`Votre choix : <b>${esc(nm(c))}</b> — ${esc(p.post)}, ${esc(terr(p.commune))}`;btn.disabled=false});
  btn.onclick=()=>{btn.disabled=true;const r=vote(p.id,sel);$('#res').innerHTML=`<p class="msg ${r.ok?'ok':'err'}">${esc(r.m)}</p>`;if(!r.ok)btn.disabled=false}});
 return`<h1>${esc(p.title)}</h1><p>${esc(p.post)} — ${esc(terr(p.commune))}</p><div class="grid">${cs.map(c=>`<div class="pick" data-id="${c.id}">${candCard(c)}</div>`).join('')||'<p class="msg info">Aucun candidat publié dans ce sondage.</p>'}</div><p id="rec" class="msg info">Sélectionnez un candidat.</p><p class="muted">Confirmation explicite : ce choix sera enregistré définitivement.</p><button id="ok" class="btn" disabled>Confirmer ma participation</button><div id="res"></div>`};
function vote(pid,cid){const p=db.polls.find(x=>x.id===pid);
 if(!p||status(p)!=='actif')return{ok:false,m:'Sondage fermé ou non commencé.'};
 const c=db.cands.find(x=>x.id===cid);if(!c||!c.pub||!p.cands.includes(cid))return{ok:false,m:'Candidat non autorisé pour ce sondage.'};
 if(db.resp.some(r=>r.poll===pid&&r.key===myKey()))return{ok:false,m:'Participation déjà enregistrée.'};
 db.resp.push({id:uid(),poll:pid,cand:cid,key:myKey(),at:Date.now()});save();return{ok:true,m:'Merci ! Votre participation a été enregistrée.'}}

const A={};
A.login=()=>{setTimeout(()=>$('#lf').onsubmit=async e=>{e.preventDefault();const v=$('#pw').value;
  if(v.length<8)return $('#lm').textContent='8 caractères minimum.';
  if(!db.admin){db.admin=await sha(v);log('Création du compte admin');save();sessionStorage.setItem('snw_admin','1');route()}
  else if(await sha(v)===db.admin){sessionStorage.setItem('snw_admin','1');log('Connexion admin');save();route()}
  else $('#lm').textContent='Mot de passe incorrect.'});
 return`<div class="card" style="max-width:380px;margin:auto"><h1>Administration</h1><p class="muted">${db.admin?'Connexion':'Première utilisation : choisissez votre mot de passe administrateur (stocké haché dans ce navigateur).'}</p><form id="lf"><input id="pw" type="password" autocomplete="${db.admin?'current-password':'new-password'}" placeholder="Mot de passe"><button class="btn">${db.admin?'Se connecter':'Créer le compte'}</button></form><p id="lm" class="msg err"></p></div>`};
A.main=()=>{if(!isAdmin())return A.login();
 const csv=p=>'Candidat,Preferences,Pourcentage\n'+tally(p).rows.map(r=>`"${nm(r.c)}",${r.n},${r.pct.toFixed(1)}`).join('\n');
 setTimeout(()=>{
  $('#cf').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));
   const c={id:uid(),first:f.first.trim(),last:f.last.trim(),party:f.party.trim(),post:f.post,commune:f.commune,photo:f.photo.trim(),bio:f.bio,pub:!!f.pub};
   if(!c.first||!c.last)return;db.cands.push(c);log('Candidat créé : '+nm(c));save();route()};
  $('#pf').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),g=k=>f.get(k);
   if(new Date(g('end'))<=new Date(g('start')))return alert('La date de fin doit suivre la date de début.');
   const p={id:uid(),title:g('title').trim(),post:g('post'),commune:g('commune'),start:g('start'),end:g('end'),vis:g('vis'),min:+g('min')||0,status:g('status'),cands:f.getAll('cs')};
   const bad=db.cands.filter(c=>p.cands.includes(c.id)&&(c.post!==p.post||(p.commune&&c.commune!==p.commune)));
   if(bad.length)return alert('Candidats incompatibles avec le poste/territoire : '+bad.map(nm).join(', '));
   db.polls.push(p);log('Sondage créé : '+p.title);save();route()};
  app.onclick=e=>{const d=e.target.dataset;if(!d.a)return;
   if(d.a==='out'){sessionStorage.removeItem('snw_admin');location.hash='#/';route()}
   if(d.a==='pub'){const c=db.cands.find(x=>x.id===d.id);c.pub=!c.pub;log('Publication candidat');save();route()}
   if(d.a==='del'&&confirm('Supprimer ce candidat ?')){if(db.polls.some(p=>p.cands.includes(d.id)))return alert('Candidat lié à un sondage : dépubliez-le plutôt.');db.cands=db.cands.filter(x=>x.id!==d.id);save();route()}
   if(d.a==='st'){const p=db.polls.find(x=>x.id===d.id);p.status=d.v;log('Sondage '+d.v+' : '+p.title);save();route()}
   if(d.a==='csv'){const p=db.polls.find(x=>x.id===d.id),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv(p)],{type:'text/csv'}));a.download='resultats-'+p.id+'.csv';a.click()}
   if(d.a==='print')print()}});
 return`<h1>Tableau de bord</h1><button class="btn alt" data-a="print">Imprimer</button> <button class="btn alt" data-a="out">Déconnexion</button>
 <div class="grid"><div class="card"><div class="stat">${db.cands.filter(c=>c.pub).length}</div>Candidats publiés</div><div class="card"><div class="stat">${db.polls.filter(p=>status(p)==='actif').length}</div>Sondages actifs</div><div class="card"><div class="stat">${db.resp.length}</div>Participations</div></div>
 <h2>Candidats</h2><div class="card tw"><table><tr><th>Nom</th><th>Poste</th><th>Territoire</th><th></th></tr>${db.cands.map(c=>`<tr><td>${esc(nm(c))}</td><td>${esc(c.post)}</td><td>${esc(terr(c.commune))}</td><td><button class="btn alt" data-a="pub" data-id="${c.id}">${c.pub?'Dépublier':'Publier'}</button> <button class="btn red" data-a="del" data-id="${c.id}">Suppr.</button></td></tr>`).join('')||'<tr><td colspan=4>Aucun candidat.</td></tr>'}</table></div>
 <form id="cf" class="card"><h3>Ajouter un candidat</h3><div class="filters"><input name="first" placeholder="Prénom" required><input name="last" placeholder="Nom" required><input name="party" placeholder="Parti (vide = indépendant)"></div><div class="filters"><select name="post">${opts(POSTS)}</select><select name="commune"><option value="">Département entier</option>${opts(COMMUNES)}</select><input name="photo" placeholder="URL de la photo (facultatif)"></div><textarea name="bio" placeholder="Biographie"></textarea><label><input type="checkbox" name="pub" style="width:auto"> Publier</label> <button class="btn">Enregistrer</button></form>
 <h2>Sondages</h2><div class="card tw"><table><tr><th>Titre</th><th>Statut</th><th>Participations</th><th></th></tr>${db.polls.map(p=>`<tr><td>${esc(p.title)}</td><td>${status(p)}</td><td>${tally(p).t}</td><td>${p.status==='draft'?`<button class="btn alt" data-a="st" data-v="published" data-id="${p.id}">Publier</button>`:''}${p.status==='published'?`<button class="btn alt" data-a="st" data-v="closed" data-id="${p.id}">Fermer</button>`:''} <button class="btn alt" data-a="csv" data-id="${p.id}">CSV</button></td></tr>`).join('')||'<tr><td colspan=4>Aucun sondage.</td></tr>'}</table></div>
 <form id="pf" class="card"><h3>Créer un sondage</h3><input name="title" placeholder="Titre" required><div class="filters"><select name="post">${opts(POSTS)}</select><select name="commune"><option value="">Département entier</option>${opts(COMMUNES)}</select><select name="status"><option value="draft">Brouillon</option><option value="published">Publié</option></select></div><div class="filters"><label>Début<input type="datetime-local" name="start" required></label><label>Fin<input type="datetime-local" name="end" required></label><label>Résultats<select name="vis"><option value="after">Après la clôture</option><option value="live">En temps réel</option></select></label><label>Seuil minimal<input type="number" name="min" min="0" value="0"></label></div><p>Candidats admissibles :</p>${db.cands.map(c=>`<label><input type="checkbox" name="cs" value="${c.id}" style="width:auto"> ${esc(nm(c))} (${esc(c.post)}, ${esc(terr(c.commune))})</label><br>`).join('')||'<p class="muted">Ajoutez d\'abord des candidats.</p>'}<br><button class="btn">Créer</button></form>
 <h2>Journal</h2><div class="card">${db.log.slice(0,10).map(l=>`<div>${esc(l.d)} — ${esc(l.a)}</div>`).join('')||'Vide'}</div>`};

function route(){const h=(location.hash||'#/').slice(1),[,r,arg]=h.split('/'),k='/'+(r||'');
 app.onclick=null;
 app.innerHTML=k==='/admin'?A.main():(P[k]||(()=>'<h1>404</h1><p>Page introuvable.</p>'))(arg);
 document.querySelectorAll('#nav a:not(.btn)').forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#'+k));
 $('#nav').classList.remove('open');scrollTo(0,0)}
$('#burger').onclick=()=>$('#nav').classList.toggle('open');
addEventListener('hashchange',route);route();
})();
