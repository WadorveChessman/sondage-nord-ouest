/* ============================================================
   SONDAGE NORD-OUEST — Backend Supabase (PostgreSQL + Auth)
   Version finale : Clic sur le candidat = Modal de confirmation.
   ============================================================ */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(() => {
  'use strict';

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
    depute: 'Député', magistrat_communal: 'Magistrat communal',
    casec: 'CASEC', senateur: 'Sénateur'
  };
  const POSITION_CODES = {
    'Député': 'depute', 'Magistrat communal': 'magistrat_communal',
    'CASEC': 'casec', 'Sénateur': 'senateur'
  };

  let db = { cands: [], polls: [], resp: [], log: [] };
  let currentSession = null;
  let currentRole = null;

  const isAdmin = () => currentRole === 'admin';

  const myKey = () => {
    let k = localStorage.getItem('snw_key');
    if (!k) { k = uid() + uid(); localStorage.setItem('snw_key', k); }
    return k;
  };

  async function fetchMyRole() {
    if (!currentSession) { currentRole = null; return null; }
    const { data, error } = await supabase
      .from('profiles').select('role, is_active').eq('id', currentSession.user.id).maybeSingle();
    if (error || !data || data.is_active === false) { currentRole = null; return null; }
    currentRole = data.role;
    return currentRole;
  }

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
        id: c.id, first: c.first_name, last: c.last_name, party: c.party_name || '',
        post: POSITION_LABELS[c.position_type] || c.position_type, post_code: c.position_type,
        commune: c.commune_name || '', photo: c.photo_url || '', bio: c.biography || '',
        pub: c.publication_status === 'published', _raw: c
      }));

      db.polls = (pollsRes.data || []).map(p => ({
        id: p.id, title: p.title, post: POSITION_LABELS[p.position_type] || p.position_type,
        post_code: p.position_type, commune: p.commune_name || '', start: p.starts_at,
        end: p.ends_at, vis: p.results_visibility === 'live' ? 'live' : 'after',
        min: p.minimum_publication_count || 0, status: p.status,
        cands: byPoll[p.id] || [], _raw: p
      }));

      db.resp = (respRes.data || []).map(r => ({
        id: r.id, poll: r.poll_id, cand: r.candidate_id,
        voter_key: r.anonymous_key_hash || r.participant_user_id || '', at: r.created_at
      }));
    } catch (e) {
      console.error('[Supabase] loadData', e);
      app.innerHTML = `<p class="msg err">Erreur de connexion : ${esc(e.message)}</p>`;
    }
  }

  async function loadLogs() {
    const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (!error) db.log = (data || []).map(l => ({ a: l.action, d: new Date(l.created_at).toLocaleString('fr-FR') }));
  }

  async function pushLog(action) {
    await supabase.from('audit_logs').insert({ actor_user_id: currentSession?.user?.id || null, action, entity_type: 'admin' });
    await loadLogs();
  }

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
    return tally(p).t >= (+p.min || 0) && (p.vis === 'live' || ['terminé', 'fermé'].includes(status(p)));
  };

  const nm = c => c.first + ' ' + c.last;
  const terr = id => id || 'Nord-Ouest (département)';
  const fmt = d => d ? new Date(d).toLocaleString('fr-FR') : '—';

  const photo = c => c.photo ? `<img class="ph" src="${esc(c.photo)}" alt="">` : `<div class="ph">${esc((c.first[0] || '') + (c.last[0] || ''))}</div>`;

  const candCardModern = c => {
    const initials = ((c.first[0] || '') + (c.last[0] || '')).toUpperCase();
    const photoHtml = c.photo ? `<img class="cand-modern-avatar" src="${esc(c.photo)}" alt="">` : `<div class="cand-modern-avatar">${esc(initials)}</div>`;
    const postTag = c.post ? `<span class="tag blue">${esc(c.post)}</span>` : '';
    const communeTag = c.commune ? `<span class="tag">${esc(terr(c.commune))}</span>` : '<span class="tag">Département</span>';

    const activePoll = db.polls.find(p => p.status === 'published' && (p.cands || []).includes(c.id) && status(p) === 'actif');
    
    const action = activePoll
      ? `<a class="cand-modern-action" href="#/participer/${activePoll.id}?cand=${c.id}"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Choisir ce candidat</a>`
      : `<button class="cand-modern-action" disabled style="opacity:.5;cursor:not-allowed"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Aucun sondage actif</button>`;

    return `
      <article class="cand-modern">
        <div class="cand-modern-top">${photoHtml}<div class="cand-modern-info"><b>${esc(nm(c))}</b><small>${esc(c.party || 'Indépendant')}</small></div></div>
        <div class="cand-modern-body">
          <div class="cand-modern-meta">${postTag}${communeTag}</div>
          <p class="cand-modern-bio">${esc(c.bio || 'Aucune biographie fournie.')}</p>
          ${action}
        </div>
      </article>`;
  };

  const pollCard = p => {
    const t = tally(p);
    return `<div class="card"><b>${esc(p.title)}</b><p>${esc(p.post)} — ${esc(terr(p.commune))}<br><span class="tag">${status(p)}</span></p><p class="muted">${fmt(p.start)} → ${fmt(p.end)}</p><p class="muted"><b>${t.t}</b> participation${t.t > 1 ? 's' : ''}</p>${status(p) === 'actif' ? `<a class="btn" href="#/participer/${p.id}">Participer</a>` : ''}</div>`;
  };

  const pub = () => db.polls.filter(p => p.status !== 'draft');

  const bars = p => {
    const t = tally(p);
    if (!t.t) return `<div class="result-summary"><strong>0</strong> participation enregistrée</div><div class="result-empty">Aucune participation enregistrée pour le moment.</div>`;
    const summary = `<div class="result-summary"><strong>${t.t}</strong> participation${t.t > 1 ? 's' : ''} enregistrée${t.t > 1 ? 's' : ''}</div>`;
    if (!canShow(p)) return summary + `<div class="result-pending">Les résultats détaillés seront publiés après la clôture du sondage.</div>`;
    const sorted = t.rows.sort((a, b) => b.n - a.n);
    const max = sorted[0]?.n || 0;
    const rows = sorted.map((r, i) => {
      const leading = (r.n === max && max > 0) ? ' leading' : '';
      return `<li class="result-row${leading}"><span class="result-rank">${i + 1}</span><div class="result-body"><div class="result-top-line"><span class="result-name">${esc(nm(r.c))}</span><span class="result-figures"><span class="result-pct">${r.pct.toFixed(1)} %</span><span class="result-votes">${r.n} vote${r.n > 1 ? 's' : ''}</span></span></div><div class="result-bar"><i style="width:${r.pct}%"></i></div></div></li>`;
    }).join('');
    return summary + `<ul class="result-list">${rows}</ul>`;
  };

  const statusBadge = p => {
    const s = status(p);
    const map = { 'actif': 'active', 'fermé': 'closed', 'terminé': 'closed', 'brouillon': 'draft', 'programmé': 'scheduled', 'suspendu': 'suspended' };
    return `<span class="result-badge ${map[s] || 'draft'}">${s}</span>`;
  };

  const opts = (a, sel) => a.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');

  /* ============ PAGES PUBLIQUES ============ */
  const P = {};

  P['/'] = () => {
    const act = db.polls.filter(p => status(p) === 'actif');
    return `<section class="hero"><small>Plateforme citoyenne</small><h1>Votre voix compte pour le Nord-Ouest.</h1><p>Participez aux sondages d'opinion et découvrez les tendances de votre département. Un clic, une voix.</p><a class="btn" style="background:var(--accent);color:#fff" href="#/sondages">Participer maintenant</a> <a class="btn alt" href="#/resultats">Voir les résultats</a></section>
    <h2>La plateforme en chiffres</h2><div class="grid">${[
      ['Candidats', db.cands.filter(c => c.pub).length], ['Sondages actifs', act.length], ['Participations', db.resp.length], ['Communes', new Set(db.cands.map(c => c.commune).filter(Boolean)).size]
    ].map(([l, v]) => `<div class="card" style="text-align:center"><div class="stat">${v}</div><div class="muted" style="font-size:1rem;margin-top:.5rem">${l}</div></div>`).join('')}</div>
    <h2>Sondages en cours</h2><div class="grid">${act.map(pollCard).join('') || '<p class="msg info">Aucun sondage actif pour le moment.</p>'}</div>`;
  };

  P['/sondages'] = () => `<h1>Les sondages</h1><div class="grid">${pub().map(pollCard).join('') || '<p class="msg info">Aucun sondage publié.</p>'}</div>`;

  P['/candidats'] = () => {
    setTimeout(() => {
      const render = () => {
        const q = ($('#q')?.value || '').toLowerCase().trim();
        const post = $('#fp')?.value || '';
        const commune = $('#fc')?.value || '';
        const items = db.cands.filter(c => c.pub && (!q || nm(c).toLowerCase().includes(q)) && (!post || c.post === post) && (!commune || c.commune === commune));
        $('#cl').innerHTML = items.map(candCardModern).join('') || '<p class="msg info">Aucun candidat ne correspond à ces filtres.</p>';
        if ($('#candsCount')) $('#candsCount').textContent = items.length;
      };
      let t;
      $('#q').oninput = () => { clearTimeout(t); t = setTimeout(render, 200); };
      $('#fp').onchange = render;
      $('#fc').onchange = render;
      render();
    });
    return `
      <div class="cands-header"><h1>Candidats <span class="cands-count" id="candsCount">${db.cands.filter(c => c.pub).length}</span></h1><p>Découvrez tous les candidats du département du Nord-Ouest.</p></div>
      <div class="cands-filters">
        <div class="cands-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="q" placeholder="Rechercher un candidat..."></div>
        <select id="fp"><option value="">Tous les postes</option>${opts(POSTS)}</select>
        <select id="fc"><option value="">Toutes les communes</option>${opts(COMMUNES)}</select>
      </div>
      <div id="cl" class="cands-grid"></div>`;
  };

  P['/resultats'] = () => {
    const polls = pub();
    const sections = polls.map(p => `
      <section class="result-section">
        <div class="result-section-head"><div><h2>${esc(p.title)}</h2><p class="muted" style="margin:0.35rem 0 0;font-size:0.82rem">${esc(p.post)} · ${esc(terr(p.commune))}</p></div><div class="result-meta">${statusBadge(p)}</div></div>
        ${bars(p)}
      </section>`).join('');
    return `
      <div class="results-header"><h1>Résultats</h1><p>Consultez les résultats des sondages publiés.</p></div>
      <div class="results-intro"><strong>À propos des résultats.</strong> Ces pourcentages décrivent uniquement les préférences exprimées par les participants de la plateforme. Ils ne constituent pas un échantillon représentatif de la population et ne remplacent pas un résultat électoral officiel.</div>
      ${sections || '<div class="result-empty">Aucun sondage publié pour le moment.</div>'}
      <p class="results-footnote">Ces pourcentages décrivent les participants de la plateforme, pas la population.</p>`;
  };

  P['/methodologie'] = () => `
    <div class="page-header"><h1>Méthodologie</h1><p>Transparence et rigueur au cœur de notre démarche.</p></div>
    <div class="content-card">
      <h2>1. Objet de la plateforme</h2><p>SONDAGE NORD-OUEST est une plateforme citoyenne indépendante. Elle n'a aucun lien officiel avec le Conseil Électoral Provisoire (CEP) ni avec aucune institution étatique.</p>
      <h2>2. Collecte des données</h2><p>Aucune donnée personnelle n'est collectée. Un identifiant anonyme (clé de navigateur) est généré aléatoirement pour empêcher un même utilisateur de voter plusieurs fois, sans révéler son identité.</p>
      <h2>3. Calcul des résultats</h2><p>Les pourcentages sont calculés en divisant le nombre de voix par le nombre total de votes valides. Le total des pourcentages est toujours égal à 100 %.</p>
      <h2>4. Limites méthodologiques</h2><p>Les participants ne constituent pas un échantillon représentatif de la population générale. Les résultats reflètent uniquement les tendances d'opinion sur cette plateforme.</p>
    </div>`;

  P['/apropos'] = () => `
    <div class="page-header"><h1>À propos</h1><p>Découvrez la mission et l'équipe derrière Sondage Nord-Ouest.</p></div>
    <div class="content-card">
      <h2>Notre Mission</h2><p>Nous croyons que la démocratie participative commence par l'écoute. SONDAGE NORD-OUEST a été créé pour offrir aux citoyens un espace moderne, neutre et accessible pour exprimer leurs préférences.</p>
      <h2>Confidentialité & Contact</h2><p>Nous respectons votre vie privée. Aucune information personnelle n'est requise. Pour toute question, n'hésitez pas à nous contacter.</p>
      <div class="contact-card">
        <h3>Développé par</h3>
        <p><strong>ING Worvensky-Wadson PIERRE</strong></p>
        <p><a href="mailto:worvenskypierre40@gmail.com">worvenskypierre40@gmail.com</a></p>
        <p><a href="tel:+50940104317">+509 4010 4317</a></p>
      </div>
    </div>`;

  /* ============ PAGE PARTICIPER (Clic direct = Modal) ============ */
  P['/participer'] = id => {
    const p = db.polls.find(x => x.id === id);
    if (!p) return '<p class="msg err">Sondage introuvable.</p>';
    const s = status(p);
    if (s !== 'actif') return `<p class="msg err">Ce sondage est ${s} : participation impossible.</p>`;
    if (db.resp.some(r => r.poll === p.id && r.voter_key === myKey())) return '<p class="msg ok" style="font-size:1.1rem;text-align:center;padding:2rem">✅ Vous avez déjà participé à ce sondage. Merci !</p>';
    
    const urlParams = new URLSearchParams(location.hash.split('?')[1] || '');
    const preselectedId = urlParams.get('cand');

    // Fonction pour afficher le modal de confirmation
    function openConfirmModal(candidate) {
      const back = document.createElement('div');
      back.className = 'adm-modal-backdrop';
      back.innerHTML = `
        <div class="adm-modal" style="max-width:420px; text-align:center;">
          <div class="adm-modal-head" style="border-bottom:none; padding-bottom:0; justify-content:center; position:relative;">
            <h2 style="width:100%; text-align:center;">Confirmer votre choix</h2>
            <button class="adm-modal-close" style="position:absolute; right:1.5rem; top:1rem;">
              <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="adm-modal-body" style="padding-top:1rem;">
            <div class="pick-avatar" style="width:80px;height:80px;margin:0 auto 1rem;font-size:1.5rem;">
              ${candidate.photo ? `<img src="${esc(candidate.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : ((candidate.first[0] || '') + (candidate.last[0] || '')).toUpperCase()}
            </div>
            <h3 style="font-size:1.2rem;margin-bottom:0.25rem;">${esc(nm(candidate))}</h3>
            <p style="color:var(--tx-soft);margin-bottom:1.5rem;">${esc(candidate.party || 'Indépendant')}</p>
            <p style="font-size:0.9rem;color:var(--tx-mute);margin-bottom:1.5rem;">Votre choix sera enregistré définitivement.</p>
          </div>
          <div class="adm-modal-foot" style="justify-content:center; gap:1rem; border-top:none;">
            <button class="btn alt" id="modalCancel">Annuler</button>
            <button class="btn" id="modalConfirm">Confirmer</button>
          </div>
        </div>`;
      document.body.appendChild(back);
      
      const close = () => back.remove();
      back.querySelector('.adm-modal-close').onclick = close;
      back.querySelector('#modalCancel').onclick = close;
      
      back.querySelector('#modalConfirm').onclick = async () => {
        const btn = back.querySelector('#modalConfirm');
        btn.disabled = true;
        btn.textContent = 'Enregistrement…';
        
        const r = await vote(p.id, candidate.id);
        
        if (r.ok) {
          close();
          app.innerHTML = `
            <div class="success-card">
              <div class="success-icon">✓</div>
              <h1>Participation enregistrée !</h1>
              <p>Merci d'avoir exprimé votre choix pour ce sondage.</p>
              <a href="#/resultats" class="btn">Voir les résultats</a>
            </div>`;
        } else {
          btn.disabled = false;
          btn.textContent = 'Confirmer';
          alert(r.m);
        }
      };
    }

    setTimeout(() => {
      // Si un candidat est passé dans l'URL, on ouvre le modal directement
      if (preselectedId) {
        const candidate = db.cands.find(c => c.id === preselectedId);
        if (candidate) openConfirmModal(candidate);
      }

      // Attacher l'événement de clic sur la liste
      document.querySelectorAll('.pick-row').forEach(el => el.onclick = () => {
        const c = db.cands.find(x => x.id === el.dataset.id);
        if (c) openConfirmModal(c);
      });
    });

    const cs = db.cands.filter(c => (p.cands || []).includes(c.id) && c.pub);
    
    return `
      <div class="poll-header">
        <h1>${esc(p.title)}</h1>
        <p>${esc(p.post)} — ${esc(terr(p.commune))}</p>
      </div>
      
      <div class="search-bar">
        <input id="searchCandidate" placeholder="Rechercher un candidat par son nom...">
      </div>

      <div id="candidateList" class="candidate-list">
        ${cs.map(c => {
          const initials = ((c.first[0] || '') + (c.last[0] || '')).toUpperCase();
          const ph = c.photo ? `<img src="${esc(c.photo)}" alt="">` : initials;
          return `
            <div class="pick-row" data-id="${c.id}">
              <div class="pick-avatar">${ph}</div>
              <div class="pick-info">
                <b>${esc(nm(c))}</b>
                <small>${esc(c.party || 'Indépendant')}</small>
              </div>
              <button class="btn" style="padding:0.4rem 0.8rem; font-size:0.8rem;">Choisir</button>
            </div>`;
        }).join('') || '<p class="muted" style="text-align:center;padding:1rem">Aucun candidat trouvé.</p>'}
      </div>`;
  };

  async function vote(pid, cid) {
    const p = db.polls.find(x => x.id === pid);
    if (!p || status(p) !== 'actif') return { ok: false, m: 'Sondage fermé ou non commencé.' };
    const c = db.cands.find(x => x.id === cid);
    if (!c || !c.pub || !(p.cands || []).includes(cid)) return { ok: false, m: 'Candidat non autorisé.' };

    const { error } = await supabase.rpc('cast_vote', { p_poll: pid, p_cand: cid, p_key: myKey() });
    if (error) {
      if (error.message && error.message.includes('déjà enregistrée')) return { ok: false, m: 'Participation déjà enregistrée.' };
      return { ok: false, m: 'Erreur : ' + error.message };
    }
    await loadData();
    return { ok: true, m: 'Merci ! Votre participation a été enregistrée.' };
  }

  /* ============ ADMINISTRATION ============ */
  // ... [Le code admin reste identique à la version précédente, je le raccourcis ici pour la lisibilité, 
  // mais dans votre fichier final, gardez tout le code admin A.login, A.main, admActionBound, etc.]
  
  // (Je vous laisse copier-coller la partie admin que vous avez déjà, elle n'a pas changé)

  /* ============ ROUTEUR ============ */
  async function route() {
    const h = (location.hash || '#/').slice(1);
    const parts = h.split('/');
    const r = parts[1] || '', arg = parts[2]?.split('?')[0], k = '/' + r;
    app.innerHTML = k === '/admin' ? A.main() : (P[k] || (() => '<h1>404</h1><p>Page introuvable.</p>'))(arg);
    document.querySelectorAll('#nav a:not(.btn)').forEach(a => { a.classList.toggle('on', a.getAttribute('href') === '#' + k); });
    const nav = $('#nav'); if (nav) nav.classList.remove('open');
    scrollTo(0, 0);
  }

  const burger = $('#burger'); if (burger) burger.onclick = () => $('#nav').classList.toggle('open');
  document.addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); if (location.hash !== '#/admin') location.hash = '#/admin'; } });
  const logoLink = document.getElementById('logoLink'); if (logoLink) logoLink.addEventListener('dblclick', e => { e.preventDefault(); location.hash = '#/admin'; });

  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      currentSession = session;
      if (currentSession) await fetchMyRole();
      window.addEventListener('hashchange', route);
      await loadData();
      if (isAdmin()) await loadLogs();
    } catch (e) { console.error('[Démarrage]', e); }
    route();
  })();
})();
