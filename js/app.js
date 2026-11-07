/* ============================================================
   SONDAGE NORD-OUEST — Backend Supabase (PostgreSQL + Auth)
   Version complète : party_name + dashboard enrichi + suppr.
   ============================================================ */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(() => {
  'use strict';

  /* ============ UTILITAIRES ============ */
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const POSTS = ['Député', 'Magistrat communal', 'CASEC', 'Sénateur'];
  const COMMUNES = [
    'Port-de-Paix', 'Bassin-Bleu', 'Chansolme', 'Île de la Tortue',
    'Saint-Louis-du-Nord', 'Anse-à-Foleur', 'Môle-Saint-Nicolas',
    'Bombardopolis', 'Baie-de-Henne', 'Jean-Rabel'
  ];

  const POSITION_LABELS = {
    depute: 'Député',
    magistrat_communal: 'Magistrat communal',
    casec: 'CASEC',
    senateur: 'Sénateur'
  };
  const POSITION_CODES = {
    'Député': 'depute',
    'Magistrat communal': 'magistrat_communal',
    'CASEC': 'casec',
    'Sénateur': 'senateur'
  };

  /* ============ ÉTAT GLOBAL ============ */
  let db = { cands: [], polls: [], resp: [], log: [] };
  let currentSession = null;
  let currentRole = null;

  const isAdmin = () => currentRole === 'admin';

  /* ============ IDENTITÉ UTILISATEUR ============ */
  const myKey = () => {
    let k = localStorage.getItem('snw_key');
    if (!k) { k = uid() + uid(); localStorage.setItem('snw_key', k); }
    return k;
  };

  /* ============ RÔLE ============ */
  async function fetchMyRole() {
    if (!currentSession) { currentRole = null; return null; }
    const { data, error } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', currentSession.user.id)
      .maybeSingle();
    if (error || !data || data.is_active === false) {
      currentRole = null;
      return null;
    }
    currentRole = data.role;
    return currentRole;
  }

  /* ============ CHARGEMENT DES DONNÉES ============ */
  async function loadData() {
    try {
      const [candsRes, pollsRes, respRes, pcsRes] = await Promise.all([
        supabase.from('candidates').select('*').order('created_at'),
        supabase.from('polls').select('*').order('created_at', { ascending: false }),
        supabase.from('poll_responses').select('*'),
        supabase.from('poll_candidates').select('*')
      ]);

      if (candsRes.error) throw candsRes.error;
      if (pollsRes.error) throw pollsRes.error;
      if (respRes.error) throw respRes.error;
      if (pcsRes.error) throw pcsRes.error;

      const byPoll = {};
      (pcsRes.data || []).forEach(pc => {
        (byPoll[pc.poll_id] = byPoll[pc.poll_id] || []).push(pc.candidate_id);
      });

      db.cands = (candsRes.data || []).map(c => ({
        id: c.id,
        first: c.first_name,
        last: c.last_name,
        party: c.party_name || '',
        post: POSITION_LABELS[c.position_type] || c.position_type,
        post_code: c.position_type,
        commune: c.commune_id || '',
        photo: c.photo_url || '',
        bio: c.biography || '',
        pub: c.publication_status === 'published',
        _raw: c
      }));

      db.polls = (pollsRes.data || []).map(p => ({
        id: p.id,
        title: p.title,
        post: POSITION_LABELS[p.position_type] || p.position_type,
        post_code: p.position_type,
        commune: p.commune_id || '',
        start: p.starts_at,
        end: p.ends_at,
        vis: p.results_visibility === 'live' ? 'live' : 'after',
        min: p.minimum_publication_count || 0,
        status: p.status,
        cands: byPoll[p.id] || [],
        _raw: p
      }));

      db.resp = (respRes.data || []).map(r => ({
        id: r.id,
        poll: r.poll_id,
        cand: r.candidate_id,
        voter_key: r.anonymous_key_hash || r.participant_user_id || '',
        at: r.created_at
      }));
    } catch (e) {
      console.error('[Supabase] loadData', e);
      app.innerHTML = `<p class="msg err">Erreur de connexion à la base de données : ${esc(e.message)}</p>`;
      throw e;
    }
  }

  async function loadLogs() {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) {
      db.log = (data || []).map(l => ({
        a: l.action,
        d: new Date(l.created_at).toLocaleString('fr-FR')
      }));
    }
  }

  async function pushLog(action) {
    await supabase.from('audit_logs').insert({
      actor_user_id: currentSession?.user?.id || null,
      action,
      entity_type: 'admin'
    });
    await loadLogs();
  }

  /* ============ LOGIQUE MÉTIER ============ */
  const status = p => {
    if (p.status === 'draft') return 'brouillon';
    if (p.status === 'closed') return 'fermé';
    if (p.status === 'suspended') return 'suspendu';
    if (p.status === 'archived') return 'archivé';
    const n = Date.now();
    return n < new Date(p.start) ? 'programmé' : n > new Date(p.end) ? 'terminé' : 'actif';
  };

  const tally = p => {
    const r = db.resp.filter(x => x.poll === p.id), t = r.length;
    return {
      t,
      rows: db.cands.filter(c => (p.cands || []).includes(c.id)).map(c => {
        const n = r.filter(x => x.cand === c.id).length;
        return { c, n, pct: t ? n / t * 100 : 0 };
      })
    };
  };

  const canShow = p => {
    if (p.status === 'draft') return false;
    return tally(p).t >= (+p.min || 0)
      && (p.vis === 'live' || ['terminé', 'fermé'].includes(status(p)));
  };

  const nm = c => c.first + ' ' + c.last;
  const terr = id => id || 'Nord-Ouest (département)';
  const fmt = d => d ? new Date(d).toLocaleString('fr-FR') : '—';

  const photo = c => c.photo
    ? `<img class="ph" src="${esc(c.photo)}" alt="">`
    : `<div class="ph">${esc((c.first[0] || '') + (c.last[0] || ''))}</div>`;

  const candCard = c => `<div class="card"><div style="display:flex;gap:.8rem">${photo(c)}<div><b>${esc(nm(c))}</b><br><span class="tag">${esc(c.party || 'Indépendant')}</span></div></div><p>${esc(c.post)} — ${esc(terr(c.commune))}</p><p class="muted">${esc((c.bio || '').slice(0, 120))}</p></div>`;

  const candCardModern = c => {
    const initials = ((c.first[0] || '') + (c.last[0] || '')).toUpperCase();
    const photoHtml = c.photo
      ? `<img class="cand-modern-avatar" src="${esc(c.photo)}" alt="">`
      : `<div class="cand-modern-avatar">${esc(initials)}</div>`;
    const postTag = c.post ? `<span class="tag blue">${esc(c.post)}</span>` : '';
    const communeTag = c.commune ? `<span class="tag">${esc(terr(c.commune))}</span>` : '<span class="tag">Département</span>';
    return `
      <article class="cand-modern">
        <div class="cand-modern-top">
          ${photoHtml}
          <div class="cand-modern-info">
            <b>${esc(nm(c))}</b>
            <small>${esc(c.party || 'Indépendant')}</small>
          </div>
        </div>
        <div class="cand-modern-body">
          <div class="cand-modern-meta">
            ${postTag}
            ${communeTag}
          </div>
          <p class="cand-modern-bio">${esc(c.bio || 'Aucune biographie fournie.')}</p>
          <a class="cand-modern-action" href="#/sondages">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            Choisir ce candidat
          </a>
        </div>
      </article>`;
  };

  const pollCard = p => {
    const t = tally(p);
    return `<div class="card"><b>${esc(p.title)}</b><p>${esc(p.post)} — ${esc(terr(p.commune))}<br><span class="tag">${status(p)}</span></p><p class="muted">${fmt(p.start)} → ${fmt(p.end)}</p><p class="muted"><b>${t.t}</b> participation${t.t > 1 ? 's' : ''} enregistrée${t.t > 1 ? 's' : ''}</p>${status(p) === 'actif' ? `<a class="btn" href="#/participer/${p.id}">Participer</a>` : ''}</div>`;
  };

  const pub = () => db.polls.filter(p => p.status !== 'draft');

  const bars = p => {
    const t = tally(p);
    if (!t.t) return '<p class="msg info">Aucune participation enregistrée pour le moment.</p>';
    let html = `<p><b>${t.t}</b> participation(s) enregistrée(s)</p>`;
    if (!canShow(p)) {
      html += `<p class="msg info">Les résultats détaillés seront publiés après la clôture du sondage.</p>`;
      return html;
    }
    html += t.rows.sort((a, b) => b.n - a.n).map(r =>
      `<p>${esc(nm(r.c))} — <b>${r.pct.toFixed(1)} %</b> (${r.n} vote${r.n > 1 ? 's' : ''})<div class="bar"><i style="width:${r.pct}%"></i></div></p>`
    ).join('');
    return html;
  };

  const opts = (a, sel) => a.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');

  /* ============ PAGES PUBLIQUES ============ */
  const P = {};

  P['/'] = () => {
    const act = db.polls.filter(p => status(p) === 'actif');
    return `<section class="hero"><small>L'opinion citoyenne au cœur de la démocratie</small><h1>Qui souhaitez-vous voir représenter votre commune ?</h1><p>Participez aux sondages du Nord-Ouest. Un clic, une voix.</p><a class="btn" style="background:var(--warn)" href="#/sondages">Participer maintenant</a> <a class="btn alt" href="#/resultats">Consulter les résultats</a></section>
    <h2>En chiffres</h2><div class="grid">${[
      ['Candidats', db.cands.filter(c => c.pub).length],
      ['Sondages actifs', act.length],
      ['Participations', db.resp.length],
      ['Communes couvertes', new Set(db.polls.map(p => p.commune).filter(Boolean)).size]
    ].map(([l, v]) => `<div class="card"><div class="stat">${v}</div>${l}</div>`).join('')}</div>
    <h2>Sondages en cours</h2><div class="grid">${act.map(pollCard).join('') || '<p class="msg info">Aucun sondage actif.</p>'}</div>
    <h2>Candidats à découvrir</h2><div class="grid">${db.cands.filter(c => c.pub).slice(0, 6).map(candCard).join('') || '<p class="msg info">Aucun candidat publié pour le moment.</p>'}</div>`;
  };

  P['/sondages'] = () => `<h1>Les sondages</h1><div class="grid">${pub().map(pollCard).join('') || '<p class="msg info">Aucun sondage publié.</p>'}</div>`;

  P['/candidats'] = () => {
    setTimeout(() => {
      const f = () => {
        const q = $('#q').value.toLowerCase();
        const items = db.cands.filter(c => c.pub && nm(c).toLowerCase().includes(q));
        $('#cl').innerHTML = items.map(candCardModern).join('')
          || '<p class="msg info">Aucun candidat ne correspond à votre recherche.</p>';
        const count = $('#candsCount');
        if (count) count.textContent = items.length;
      };
      let t;
      $('#q').oninput = () => { clearTimeout(t); t = setTimeout(f, 200); };
      f();
    });
    return `
      <div class="cands-header">
        <h1>Sondage – Candidats au Sénat <span class="cands-count" id="candsCount">${db.cands.filter(c => c.pub).length}</span></h1>
        <p>Département du Nord-Ouest · Cliquez sur « Choisir » pour participer au sondage de votre commune.</p>
      </div>
      <div class="cands-search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="q" placeholder="Rechercher un candidat par son nom…">
      </div>
      <div id="cl" class="cands-grid"></div>
      <p class="cands-hint">Faites défiler la liste pour découvrir tous les candidats. Une seule préférence par participation.</p>`;
  };

  P['/resultats'] = () => `<h1>Résultats</h1>${pub().map(p => `<div class="card"><b>${esc(p.title)}</b> <span class="tag">${status(p)}</span>${bars(p)}</div>`).join('') || '<p class="msg info">Aucun sondage.</p>'}<p class="muted">Ces pourcentages décrivent les participants de la plateforme, pas la population.</p>`;

  P['/methodologie'] = () => `<h1>Méthodologie</h1><div class="card"><p>Plateforme de sondages d'opinion <b>non officielle</b> : aucun lien avec le CEP.</p><p>Les participants ne sont pas un échantillon représentatif.</p></div>`;

  P['/apropos'] = () => `<h1>À propos, confidentialité, contact</h1><div class="card"><p>SONDAGE NORD-OUEST — « L'opinion citoyenne au cœur de la démocratie ».</p><p>Aucune donnée personnelle n'est demandée.</p></div>`;

  P['/participer'] = id => {
    const p = db.polls.find(x => x.id === id);
    if (!p) return '<p class="msg err">Sondage introuvable.</p>';
    const s = status(p);
    if (s !== 'actif') return `<p class="msg err">Ce sondage est ${s} : participation impossible.</p>`;
    if (db.resp.some(r => r.poll === p.id && r.voter_key === myKey()))
      return '<p class="msg ok">Vous avez déjà participé à ce sondage. Merci !</p>';
    const cs = db.cands.filter(c => (p.cands || []).includes(c.id) && c.pub);
    setTimeout(() => {
      let sel = null;
      const btn = $('#ok');
      document.querySelectorAll('.pick').forEach(el => el.onclick = () => {
        sel = el.dataset.id;
        document.querySelectorAll('.pick').forEach(x => x.classList.toggle('sel', x === el));
        const c = cs.find(x => x.id === sel);
        $('#rec').innerHTML = `Votre choix : <b>${esc(nm(c))}</b> — ${esc(p.post)}, ${esc(terr(p.commune))}`;
        btn.disabled = false;
      });
      btn.onclick = async () => {
        btn.disabled = true;
        $('#res').innerHTML = '<p class="msg info">Enregistrement…</p>';
        const r = await vote(p.id, sel);
        $('#res').innerHTML = `<p class="msg ${r.ok ? 'ok' : 'err'}">${esc(r.m)}</p>`;
        if (!r.ok) btn.disabled = false;
      };
    });
    return `<h1>${esc(p.title)}</h1><p>${esc(p.post)} — ${esc(terr(p.commune))}</p><div class="grid">${cs.map(c => `<div class="pick" data-id="${c.id}">${candCard(c)}</div>`).join('') || '<p class="msg info">Aucun candidat publié dans ce sondage.</p>'}</div><p id="rec" class="msg info">Sélectionnez un candidat.</p><p class="muted">Confirmation explicite : ce choix sera enregistré définitivement.</p><button id="ok" class="btn" disabled>Confirmer ma participation</button><div id="res"></div>`;
  };

  /* ============ VOTE via RPC ============ */
  async function vote(pid, cid) {
    const p = db.polls.find(x => x.id === pid);
    if (!p || status(p) !== 'actif') return { ok: false, m: 'Sondage fermé ou non commencé.' };
    const c = db.cands.find(x => x.id === cid);
    if (!c || !c.pub || !(p.cands || []).includes(cid)) return { ok: false, m: 'Candidat non autorisé.' };

    const { error } = await supabase.rpc('cast_vote', {
      p_poll: pid,
      p_cand: cid,
      p_key: myKey()
    });

    if (error) {
      if (error.message && error.message.includes('déjà enregistrée'))
        return { ok: false, m: 'Participation déjà enregistrée.' };
      return { ok: false, m: 'Erreur : ' + error.message };
    }
    await loadData();
    return { ok: true, m: 'Merci ! Votre participation a été enregistrée.' };
  }

  /* ============================================================
     ADMINISTRATION
     ============================================================ */
  const A = {};
  const ADM_LOCK_KEY = 'snw_lock';
  const ADM_LOCK_MAX = 5;
  const ADM_LOCK_MS = 5 * 60 * 1000;

  const admIsLocked = () => {
    try {
      const o = JSON.parse(localStorage.getItem(ADM_LOCK_KEY) || '{}');
      if (o.until && Date.now() < o.until) return o;
      return null;
    } catch { return null; }
  };

  const admRecordFail = () => {
    try {
      const o = JSON.parse(localStorage.getItem(ADM_LOCK_KEY) || '{}');
      const tries = (o.tries || 0) + 1;
      if (tries >= ADM_LOCK_MAX) {
        localStorage.setItem(ADM_LOCK_KEY, JSON.stringify({ tries: 0, until: Date.now() + ADM_LOCK_MS }));
      } else {
        localStorage.setItem(ADM_LOCK_KEY, JSON.stringify({ tries, until: 0 }));
      }
    } catch {}
  };

  const admClearFail = () => localStorage.removeItem(ADM_LOCK_KEY);

  const admToast = (msg, kind = 'info') => {
    let wrap = document.querySelector('.adm-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'adm-toast-wrap';
      document.body.appendChild(wrap);
    }
    const icons = {
      ok: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
      err: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warn: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    const el = document.createElement('div');
    el.className = 'adm-toast ' + kind;
    el.innerHTML = (icons[kind] || icons.info) + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(30px)';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  };

  const admModal = (title, bodyHtml, footHtml = '') => {
    const back = document.createElement('div');
    back.className = 'adm-modal-backdrop';
    back.innerHTML = `
      <div class="adm-modal" role="dialog" aria-modal="true">
        <div class="adm-modal-head">
          <h2>${esc(title)}</h2>
          <button class="adm-modal-close" aria-label="Fermer">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="adm-modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="adm-modal-foot">${footHtml}</div>` : ''}
      </div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.querySelector('.adm-modal-close').onclick = close;
    back.onclick = e => { if (e.target === back) close(); };
    const escKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escKey); } };
    document.addEventListener('keydown', escKey);
    return { el: back, close };
  };

  const compressImage = (file) => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Format non supporté.'));
    if (file.size > 2 * 1024 * 1024) return reject(new Error('Image trop lourde (max 2 Mo).'));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 300;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Image invalide.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Lecture impossible.'));
    reader.readAsDataURL(file);
  });

  /* ---------- Écran de connexion ---------- */
  A.login = () => {
    setTimeout(() => {
      const f = $('#lf');
      if (!f) return;
      f.onsubmit = async e => {
        e.preventDefault();
        const email = $('#em').value.trim();
        const pw = $('#pw').value;
        const lm = $('#lm');

        const lock = admIsLocked();
        if (lock) {
          const sec = Math.ceil((lock.until - Date.now()) / 1000);
          lm.className = 'adm-login-msg';
          lm.textContent = `Trop de tentatives. Réessayez dans ${sec}s.`;
          return;
        }
        if (!email || pw.length < 6) {
          lm.className = 'adm-login-msg';
          lm.textContent = 'Email et mot de passe (6 caractères min.) requis.';
          return;
        }
        lm.className = 'adm-login-msg';
        lm.textContent = 'Vérification…';

        const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) {
          admRecordFail();
          lm.className = 'adm-login-msg';
          lm.textContent = 'Identifiants invalides.';
          return;
        }

        currentSession = data.session;
        const role = await fetchMyRole();
        if (role !== 'admin') {
          await supabase.auth.signOut();
          currentSession = null;
          currentRole = null;
          lm.className = 'adm-login-msg';
          lm.textContent = 'Ce compte n\'a pas les droits administrateur.';
          return;
        }

        admClearFail();
        lm.className = 'adm-login-msg ok';
        lm.textContent = 'Connexion réussie. Redirection…';
        await loadData();
        await loadLogs();
        setTimeout(route, 400);
      };
    });

    const lock = admIsLocked();
    const lockMsg = lock
      ? `<p class="adm-login-msg">Trop de tentatives. Réessayez dans ${Math.ceil((lock.until - Date.now()) / 1000)}s.</p>`
      : '';

    return `
    <div class="adm-login-screen">
      <div class="adm-login-card">
        <div class="adm-login-icon">
          <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h1>Espace réservé</h1>
        <p class="adm-sub">Authentification requise pour continuer.</p>
        <form id="lf" autocomplete="off">
          <input id="em" type="email" placeholder="Email administrateur" autocomplete="username" required>
          <input id="pw" type="password" placeholder="Mot de passe" autocomplete="current-password" required>
          <button class="btn" type="submit">Se connecter</button>
        </form>
        ${lockMsg}
        <p id="lm" class="adm-login-msg"></p>
        <a class="adm-back" href="#/">← Retour au site</a>
      </div>
    </div>`;
  };

  /* ---------- Dashboard admin ---------- */
  let admTab = 'cands';
  let admActionBound = false;

  A.main = () => {
    if (!isAdmin()) return A.login();

    const csv = p => 'Candidat,Preferences,Pourcentage\n' +
      tally(p).rows.map(r => `"${nm(r.c)}",${r.n},${r.pct.toFixed(1)}`).join('\n');

    const stats = {
      cands: db.cands.filter(c => c.pub).length,
      candsAll: db.cands.length,
      actifs: db.polls.filter(p => status(p) === 'actif').length,
      resp: db.resp.length,
      polls: db.polls.length
    };

    const statusPill = p => {
      const s = status(p);
      const map = { 'brouillon': 'draft', 'actif': 'active', 'terminé': 'closed', 'fermé': 'closed', 'programmé': 'scheduled', 'suspendu': 'scheduled', 'archivé': 'draft' };
      return `<span class="adm-status-pill ${map[s] || 'draft'}">${s}</span>`;
    };

    setTimeout(() => {
      document.querySelectorAll('.adm-tabs button').forEach(b => {
        b.onclick = () => {
          admTab = b.dataset.tab;
          document.querySelectorAll('.adm-tabs button').forEach(x => x.classList.toggle('on', x === b));
          document.querySelectorAll('.adm-panel').forEach(p => p.classList.toggle('on', p.dataset.panel === admTab));
        };
      });
      const activeTab = document.querySelector(`.adm-tabs button[data-tab="${admTab}"]`);
      if (activeTab) activeTab.click();

      // ---- Modal nouveau candidat ----
      const btnAddCand = $('#btnAddCand');
      if (btnAddCand) btnAddCand.onclick = () => {
        let curPhoto = '';
        const m = admModal('Nouveau candidat', `
          <form id="cf" class="adm-form">
            <div class="adm-photo-uploader" id="phUp">
              <div class="adm-photo-preview" id="phPrev">?</div>
              <div class="adm-photo-info">
                <p>Photo du candidat (optionnel)<br><small>JPG, PNG ou WebP · max 2 Mo · redimensionnement auto</small></p>
                <div class="adm-photo-actions">
                  <label>
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Importer
                    <input type="file" id="phFile" accept="image/*">
                  </label>
                  <button type="button" id="phUrl">URL…</button>
                  <button type="button" id="phClr">Effacer</button>
                </div>
              </div>
            </div>
            <div class="adm-form-grid">
              <div class="adm-form-field"><label>Prénom *</label><input name="first" required></div>
              <div class="adm-form-field"><label>Nom *</label><input name="last" required></div>
              <div class="adm-form-field"><label>Parti</label><input name="party" placeholder="Vide = indépendant"></div>
              <div class="adm-form-field"><label>Poste</label><select name="post">${opts(POSTS)}</select></div>
              <div class="adm-form-field full"><label>Commune</label><select name="commune"><option value="">Département entier</option>${opts(COMMUNES)}</select></div>
              <div class="adm-form-field full"><label>Biographie</label><textarea name="bio" rows="3" placeholder="Présentation courte"></textarea></div>
              <div class="adm-form-field full" style="flex-direction:row;align-items:center;gap:.5rem">
                <input type="checkbox" name="pub" id="pubBox" style="width:auto;margin:0">
                <label for="pubBox" style="margin:0;text-transform:none;letter-spacing:0;font-weight:500">Publier immédiatement</label>
              </div>
            </div>
          </form>`,
          `<button class="btn alt" id="cfCancel">Annuler</button>
           <button class="btn" id="cfSave">Enregistrer</button>`);

        const form = m.el.querySelector('#cf');
        const refreshPrev = () => {
          const el = m.el.querySelector('#phPrev');
          if (!el) return;
          if (curPhoto) el.outerHTML = `<img class="adm-photo-preview" id="phPrev" src="${esc(curPhoto)}" alt="">`;
          else {
            const p = (form.first.value[0] || '?') + (form.last.value[0] || '?');
            el.outerHTML = `<div class="adm-photo-preview" id="phPrev">${esc(p.toUpperCase())}</div>`;
          }
        };
        form.first.oninput = form.last.oninput = refreshPrev;
        m.el.querySelector('#phFile').onchange = async e => {
          const f = e.target.files[0]; if (!f) return;
          try { curPhoto = await compressImage(f); refreshPrev(); admToast('Photo importée.', 'ok'); }
          catch (err) { admToast(err.message, 'err'); }
        };
        m.el.querySelector('#phUrl').onclick = () => {
          const u = prompt('URL de la photo :');
          if (u) { curPhoto = u.trim(); refreshPrev(); }
        };
        m.el.querySelector('#phClr').onclick = () => { curPhoto = ''; refreshPrev(); };
        m.el.querySelector('#cfCancel').onclick = m.close;

        m.el.querySelector('#cfSave').onclick = async () => {
          const f = Object.fromEntries(new FormData(form));
          if (!f.first.trim() || !f.last.trim()) { admToast('Prénom et nom obligatoires.', 'err'); return; }
          const payload = {
            first_name: f.first.trim(),
            last_name: f.last.trim(),
            party_name: f.party.trim() || null,
            position_type: POSITION_CODES[f.post],
            commune_id: null,
            photo_url: curPhoto || null,
            biography: f.bio || null,
            publication_status: f.pub ? 'published' : 'draft'
          };
          const { error } = await supabase.from('candidates').insert(payload);
          if (error) { admToast('Échec : ' + error.message, 'err'); return; }
          await pushLog('Candidat créé : ' + f.first + ' ' + f.last);
          await loadData();
          m.close();
          admToast('Candidat enregistré.', 'ok');
          route();
        };
      };

      // ---- Modal nouveau sondage ----
      const btnAddPoll = $('#btnAddPoll');
      if (btnAddPoll) btnAddPoll.onclick = () => {
        const m = admModal('Nouveau sondage', `
          <form id="pf" class="adm-form">
            <div class="adm-form-field full"><label>Titre *</label><input name="title" required placeholder="Ex. : Sénateur — Port-de-Paix 2026"></div>
            <div class="adm-form-grid cols-3">
              <div class="adm-form-field"><label>Poste</label><select name="post">${opts(POSTS)}</select></div>
              <div class="adm-form-field"><label>Commune</label><select name="commune"><option value="">Département entier</option>${opts(COMMUNES)}</select></div>
              <div class="adm-form-field"><label>Statut</label><select name="status"><option value="draft">Brouillon</option><option value="published">Publié</option></select></div>
              <div class="adm-form-field"><label>Début *</label><input type="datetime-local" name="start" required></div>
              <div class="adm-form-field"><label>Fin *</label><input type="datetime-local" name="end" required></div>
              <div class="adm-form-field"><label>Visibilité</label><select name="vis"><option value="after">Après clôture</option><option value="live">Temps réel</option></select></div>
              <div class="adm-form-field"><label>Seuil minimal</label><input type="number" name="min" min="0" value="0"></div>
            </div>
            <div class="adm-form-field full" style="margin-top:.75rem">
              <label>Candidats admissibles</label>
              <div class="adm-checks">
                ${db.cands.map(c => `<label class="adm-check"><input type="checkbox" name="cs" value="${c.id}"><span>${esc(nm(c))} <small>· ${esc(c.post)}, ${esc(terr(c.commune))}</small></span></label>`).join('') || '<p class="muted">Ajoutez d\'abord des candidats.</p>'}
              </div>
            </div>
          </form>`,
          `<button class="btn alt" id="pfCancel">Annuler</button>
           <button class="btn" id="pfSave">Créer</button>`);

        m.el.querySelector('#pfCancel').onclick = m.close;
        m.el.querySelector('#pfSave').onclick = async () => {
          const form = m.el.querySelector('#pf');
          const f = new FormData(form), g = k => f.get(k);
          if (!g('title').trim()) { admToast('Titre obligatoire.', 'err'); return; }
          if (new Date(g('end')) <= new Date(g('start'))) { admToast('La fin doit suivre le début.', 'err'); return; }
          const selectedCands = f.getAll('cs');
          if (!selectedCands.length) { admToast('Sélectionnez au moins un candidat.', 'err'); return; }

          const pollPayload = {
            title: g('title').trim(),
            position_type: POSITION_CODES[g('post')],
            commune_id: null,
            participation_mode: 'public',
            status: g('status') === 'draft' ? 'draft' : 'published',
            starts_at: g('start'),
            ends_at: g('end'),
            results_visibility: g('vis') === 'live' ? 'live' : 'after_close',
            minimum_publication_count: +g('min') || 0
          };
          const { data: pollData, error: pollErr } = await supabase
            .from('polls').insert(pollPayload).select().single();
          if (pollErr) { admToast('Échec : ' + pollErr.message, 'err'); return; }

          const links = selectedCands.map(cid => ({ poll_id: pollData.id, candidate_id: cid }));
          const { error: linkErr } = await supabase.from('poll_candidates').insert(links);
          if (linkErr) { admToast('Lien candidats : ' + linkErr.message, 'err'); return; }

          await pushLog('Sondage créé : ' + pollPayload.title);
          await loadData();
          m.close();
          admToast('Sondage créé.', 'ok');
          route();
        };
      };

      // ---- Recherches ----
      const cq = $('#cq'), pq = $('#pq');
      if (cq) cq.oninput = () => {
        const v = cq.value.toLowerCase();
        document.querySelectorAll('#candsTable tbody tr[data-name]').forEach(tr => {
          tr.style.display = tr.dataset.name.includes(v) ? '' : 'none';
        });
      };
      if (pq) pq.oninput = () => {
        const v = pq.value.toLowerCase();
        document.querySelectorAll('#pollsList .poll-card-admin[data-name]').forEach(el => {
          el.style.display = el.dataset.name.includes(v) ? '' : 'none';
        });
      };
    });

    /* --- Actions admin --- */
    if (!admActionBound) {
      app.addEventListener('click', async e => {
        if (location.hash !== '#/admin') return;
        if (!isAdmin()) return;
        const btn = e.target.closest('[data-a]');
        if (!btn) return;
        const d = btn.dataset;

        if (d.a === 'copylink') {
          const link = `${location.origin}${location.pathname}#/participer/${d.id}`;
          try {
            await navigator.clipboard.writeText(link);
            admToast('Lien copié dans le presse-papiers.', 'ok');
          } catch {
            prompt('Copiez ce lien :', link);
          }
          return;
        }
        if (d.a === 'wa') {
          const p = db.polls.find(x => x.id === d.id);
          if (!p) return;
          const link = `${location.origin}${location.pathname}#/participer/${d.id}`;
          const text = `Participez au sondage « ${p.title} » – Nord-Ouest Haïti : ${link}`;
          const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
          window.open(url, '_blank');
          return;
        }
        if (d.a === 'results') {
          location.hash = '#/resultats';
          return;
        }
        if (d.a === 'delpoll') {
          const p = db.polls.find(x => x.id === d.id);
          if (!p) return;
          const t = tally(p).t;
          if (!confirm(`⚠ Supprimer le sondage « ${p.title} » ?\n\nCette action effacera aussi les ${t} participation(s) associées.\nAction IRRÉVERSIBLE.`)) return;
          const { error: rErr } = await supabase.from('poll_responses').delete().eq('poll_id', p.id);
          if (rErr) { admToast('Échec suppression réponses : ' + rErr.message, 'err'); return; }
          const { error: pcErr } = await supabase.from('poll_candidates').delete().eq('poll_id', p.id);
          if (pcErr) { admToast('Échec suppression liens : ' + pcErr.message, 'err'); return; }
          const { error: pErr } = await supabase.from('polls').delete().eq('id', p.id);
          if (pErr) { admToast('Échec suppression sondage : ' + pErr.message, 'err'); return; }
          await pushLog('Sondage supprimé : ' + p.title);
          await loadData();
          admToast('Sondage supprimé.', 'ok');
          route();
          return;
        }
        if (d.a === 'out') {
          await supabase.auth.signOut();
          currentSession = null;
          currentRole = null;
          await pushLog('Déconnexion admin');
          location.hash = '#/';
          route();
          return;
        }
        if (d.a === 'pub') {
          const c = db.cands.find(x => x.id === d.id);
          if (!c) return;
          const newStatus = c.pub ? 'draft' : 'published';
          const { error } = await supabase.from('candidates')
            .update({ publication_status: newStatus }).eq('id', c.id);
          if (error) { admToast('Échec : ' + error.message, 'err'); return; }
          await pushLog('Publication candidat : ' + nm(c));
          await loadData();
          admToast(c.pub ? 'Candidat dépublié.' : 'Candidat publié.', 'ok');
          route();
          return;
        }
        if (d.a === 'del') {
          if (!confirm('Supprimer définitivement ce candidat ?')) return;
          if (db.polls.some(p => (p.cands || []).includes(d.id))) {
            admToast('Candidat lié à un sondage : dépubliez-le plutôt.', 'warn');
            return;
          }
          const { error } = await supabase.from('candidates').delete().eq('id', d.id);
          if (error) { admToast('Échec : ' + error.message, 'err'); return; }
          await pushLog('Candidat supprimé');
          await loadData();
          admToast('Candidat supprimé.', 'ok');
          route();
          return;
        }
        if (d.a === 'st') {
          const { error } = await supabase.from('polls').update({ status: d.v }).eq('id', d.id);
          if (error) { admToast('Échec : ' + error.message, 'err'); return; }
          await pushLog('Sondage → ' + d.v);
          await loadData();
          admToast('Statut mis à jour.', 'ok');
          route();
          return;
        }
        if (d.a === 'csv') {
          const p = db.polls.find(x => x.id === d.id);
          if (!p) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv(p)], { type: 'text/csv' }));
          a.download = 'resultats-' + p.id + '.csv';
          a.click();
          admToast('Export CSV téléchargé.', 'ok');
          return;
        }
        if (d.a === 'print') { print(); return; }
        if (d.a === 'reset') {
          if (!confirm('⚠ ATTENTION : effacer TOUTES les données (candidats, sondages, participations) ?')) return;
          if (!confirm('Dernière confirmation : action IRRÉVERSIBLE.')) return;
          await supabase.from('poll_responses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('poll_candidates').delete().neq('poll_id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('polls').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('candidates').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await loadData();
          admToast('Base réinitialisée.', 'ok');
          route();
          return;
        }
      });
      admActionBound = true;
    }

    return `
    <div class="adm-header">
      <h1>
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        Tableau de bord
      </h1>
      <div class="adm-header-actions">
        <button class="btn alt" data-a="print" title="Imprimer">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Imprimer
        </button>
        <button class="btn red" data-a="out" title="Déconnexion">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Déconnexion
        </button>
      </div>
    </div>

    <div class="adm-stats">
      <div class="adm-stat">
        <div class="adm-stat-icon"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <div class="adm-stat-value">${stats.cands}</div>
        <div class="adm-stat-label">Candidats publiés</div>
      </div>
      <div class="adm-stat warn">
        <div class="adm-stat-icon"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
        <div class="adm-stat-value">${stats.actifs}</div>
        <div class="adm-stat-label">Sondages actifs</div>
      </div>
      <div class="adm-stat ok">
        <div class="adm-stat-icon"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
        <div class="adm-stat-value">${stats.resp}</div>
        <div class="adm-stat-label">Participations</div>
      </div>
      <div class="adm-stat">
        <div class="adm-stat-icon"><svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
        <div class="adm-stat-value">${stats.polls}</div>
        <div class="adm-stat-label">Sondages créés</div>
      </div>
    </div>

    <div class="adm-tabs">
      <button data-tab="cands">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        Candidats <span class="adm-badge">${stats.candsAll}</span>
      </button>
      <button data-tab="polls">
        <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Sondages <span class="adm-badge">${stats.polls}</span>
      </button>
      <button data-tab="log">
        <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Journal
      </button>
    </div>

    <section class="adm-panel" data-panel="cands">
      <div class="adm-section-head">
        <h2>Candidats (${db.cands.length})</h2>
        <div class="adm-toolbar">
          <div class="adm-search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="cq" placeholder="Rechercher un candidat…">
          </div>
          <button class="btn" id="btnAddCand">
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nouveau candidat
          </button>
        </div>
      </div>

      <div class="adm-table-wrap">
        <table class="adm-table" id="candsTable">
          <thead><tr><th>Candidat</th><th>Poste</th><th>Territoire</th><th>Statut</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${db.cands.map(c => `
              <tr data-name="${esc((nm(c) + ' ' + c.post + ' ' + (c.commune || '')).toLowerCase())}">
                <td>
                  <div class="adm-cell-user">
                    ${c.photo ? `<img class="adm-mini-ph" src="${esc(c.photo)}" alt="">` : `<div class="adm-mini-ph">${esc(((c.first[0] || '') + (c.last[0] || '')).toUpperCase())}</div>`}
                    <div>
                      <b>${esc(nm(c))}</b><br>
                      <small style="color:var(--tx-mute)">${esc(c.party || 'Indépendant')}</small>
                    </div>
                  </div>
                </td>
                <td>${esc(c.post)}</td>
                <td>${esc(terr(c.commune))}</td>
                <td>${c.pub ? '<span class="adm-status-pill active">Publié</span>' : '<span class="adm-status-pill draft">Brouillon</span>'}</td>
                <td style="text-align:right">
                  <div class="adm-actions">
                    <button class="adm-btn-icon" data-a="pub" data-id="${c.id}" title="${c.pub ? 'Dépublier' : 'Publier'}">
                      <svg viewBox="0 0 24 24">${c.pub ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>' : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'}</svg>
                    </button>
                    <button class="adm-btn-icon danger" data-a="del" data-id="${c.id}" title="Supprimer">
                      <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </div>
                </td>
              </tr>`).join('') || `<tr><td colspan="5" class="adm-empty">Aucun candidat. Cliquez sur « Nouveau candidat ».</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="adm-panel" data-panel="polls">
      <div class="adm-section-head">
        <h2>Gestion des sondages (${db.polls.length})</h2>
        <div class="adm-toolbar">
          <div class="adm-search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="pq" placeholder="Rechercher un sondage…">
          </div>
          <button class="btn" id="btnAddPoll">
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nouveau sondage
          </button>
        </div>
      </div>

      <div id="pollsList">
        ${db.polls.map(p => {
          const t = tally(p);
          const s = status(p);
          const map = { 'brouillon': 'draft', 'actif': 'active', 'terminé': 'closed', 'fermé': 'closed', 'programmé': 'scheduled', 'suspendu': 'scheduled' };
          const pill = `<span class="adm-status-pill ${map[s] || 'draft'}">${s}</span>`;
          const daysLeft = Math.max(0, Math.ceil((new Date(p.end) - Date.now()) / (1000 * 60 * 60 * 24)));
          return `
            <div class="poll-card-admin" data-name="${esc(p.title.toLowerCase())}">
              <div class="poll-card-admin-head">
                <div class="poll-card-admin-title">
                  <b>${esc(p.title)}</b>
                  <small>${esc(p.post)} · ${esc(terr(p.commune))} · ${(p.cands || []).length} candidat${(p.cands || []).length > 1 ? 's' : ''} · ${daysLeft} jour${daysLeft > 1 ? 's' : ''} restant${daysLeft > 1 ? 's' : ''}</small>
                </div>
                <div>${pill}</div>
              </div>
              <div class="poll-card-admin-actions">
                ${p.status === 'draft' ? `<button class="poll-admin-btn primary" data-a="st" data-v="published" data-id="${p.id}"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Publier</button>` : ''}
                ${p.status === 'published' ? `<button class="poll-admin-btn" data-a="st" data-v="suspended" data-id="${p.id}"><svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Suspendre</button>` : ''}
                ${p.status === 'suspended' ? `<button class="poll-admin-btn primary" data-a="st" data-v="published" data-id="${p.id}"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Reprendre</button>` : ''}
                ${p.status === 'published' ? `<button class="poll-admin-btn" data-a="st" data-v="closed" data-id="${p.id}"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Clôturer</button>` : ''}
                <button class="poll-admin-btn" data-a="copylink" data-id="${p.id}"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier lien</button>
                <button class="poll-admin-btn" data-a="wa" data-id="${p.id}"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> WhatsApp</button>
                <button class="poll-admin-btn" data-a="results" data-id="${p.id}"><svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Résultats</button>
                <button class="poll-admin-btn" data-a="csv" data-id="${p.id}"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exporter CSV</button>
                <button class="poll-admin-btn danger" data-a="delpoll" data-id="${p.id}"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> Supprimer</button>
              </div>
              <div class="poll-admin-stats">
                <span><b>${t.t}</b> participation${t.t > 1 ? 's' : ''}</span>
                <span><b>${(p.cands || []).length}</b> candidat${(p.cands || []).length > 1 ? 's' : ''}</span>
                <span>Créé le ${fmt(p.start)}</span>
              </div>
            </div>`;
        }).join('') || '<div class="adm-empty">Aucun sondage. Cliquez sur « Nouveau sondage ».</div>'}
      </div>
    </section>

    <section class="adm-panel" data-panel="log">
      <div class="adm-section-head">
        <h2>Journal d'activité</h2>
        <button class="btn red" data-a="reset" title="Réinitialiser toutes les données">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          Réinitialiser
        </button>
      </div>
      <div class="adm-log-list">
        ${db.log.slice(0, 50).map(l => `<div class="adm-log-item"><time>${esc(l.d)}</time><span>${esc(l.a)}</span></div>`).join('') || '<div class="adm-empty">Journal vide.</div>'}
      </div>
    </section>`;
  };

  /* ============ ROUTEUR ============ */
  async function route() {
    const h = (location.hash || '#/').slice(1);
    const parts = h.split('/');
    const r = parts[1] || '';
    const arg = parts[2];
    const k = '/' + r;

    app.innerHTML = k === '/admin'
      ? A.main()
      : (P[k] || (() => '<h1>404</h1><p>Page introuvable.</p>'))(arg);

    document.querySelectorAll('#nav a:not(.btn)').forEach(a => {
      a.classList.toggle('on', a.getAttribute('href') === '#' + k);
    });
    const nav = $('#nav');
    if (nav) nav.classList.remove('open');
    scrollTo(0, 0);
  }

  /* ============ INITIALISATION ============ */
  const burger = $('#burger');
  if (burger) burger.onclick = () => $('#nav').classList.toggle('open');

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (location.hash !== '#/admin') location.hash = '#/admin';
    }
  });

  const logoLink = document.getElementById('logoLink');
  if (logoLink) {
    logoLink.addEventListener('dblclick', e => {
      e.preventDefault();
      location.hash = '#/admin';
    });
  }

  /* ============ DÉMARRAGE ============ */
  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      currentSession = session;
      if (currentSession) await fetchMyRole();

      window.addEventListener('hashchange', route);
      await loadData();
      if (isAdmin()) await loadLogs();
    } catch (e) {
      console.error('[Démarrage]', e);
    }
    route();
  })();

})();
