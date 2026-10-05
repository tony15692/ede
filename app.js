import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uzyawtzbdcfqdfquexga.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oZfQZQsptiMY3J_EHnJrGg_sFCf5js2';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

window.TIA_DB = { posts: [], profile: null, user: null, ready: false };

const esc2 = x => (x ?? '').toString().replace(/[&<>'"]/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
}[c]));
const date2 = d => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d));
const slugify = x => x.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const thumbClass = category => ({Identity:'face',History:'tree',Reflections:'face',Culture:'books',Society:'tree',Essays:'books'}[category] || 'books');
const postView = p => ({
  id:p.id, slug:p.slug, title:p.title, date:p.published_at || p.created_at, category:p.category,
  thumb:thumbClass(p.category), excerpt:p.excerpt || '', cover_url:p.cover_url || '',
  body:(p.content || '').split(/\n\s*\n/).filter(Boolean), status:p.status, author_id:p.author_id
});

async function sessionState() {
  const {data:{user}} = await supabase.auth.getUser();
  window.TIA_DB.user = user;
  if (!user) { window.TIA_DB.profile = null; return; }
  const {data:profile} = await supabase.from('profiles').select('id,display_name,role').eq('id',user.id).maybeSingle();
  window.TIA_DB.profile = profile || null;
}

async function loadPosts() {
  const editor = ['admin','editor'].includes(window.TIA_DB.profile?.role);
  let q = supabase.from('posts').select('*').order(editor ? 'updated_at' : 'published_at',{ascending:false});
  if (!editor) q = q.eq('status','published');
  const {data,error} = await q;
  if (error) console.error(error);
  window.TIA_DB.posts = (data || []).map(postView);
  window.TIA_DB.ready = true;
}

function currentPosts(){ return window.TIA_DB.posts || []; }
function coverStyle(p, extra=''){
  const base = p.cover_url ? `background-image:linear-gradient(150deg,rgba(0,0,0,.12),rgba(0,0,0,.68)),url("${esc2(p.cover_url)}");background-size:cover;background-position:center;` : '';
  return ` style="${base}${extra}"`;
}
function card2(p){
  return `<a class="post" href="#post/${esc2(p.id)}"><div class="thumb ${esc2(p.thumb)}"${coverStyle(p)}></div><div class="body"><div class="cat">${esc2(p.category)}</div><h3>${esc2(p.title)}</h3><div class="date">${date2(p.date)}</div><p>${esc2(p.excerpt)}</p></div></a>`;
}

window.home = function(){
  const latest = currentPosts().filter(p=>p.status==='published').slice(0,4);
  return `<main><div class="wrap hero"><div class="hero-inner"><div class="eyebrow">THE JOURNAL OF MEMORY</div><h1>The<br><span>Inherited<br>Amnesia</span></h1><div class="kicker">Memory. History. Identity.</div><p>Reclaiming what we were never meant to forget.</p><a class="btn" href="#archive">ENTER THE ARCHIVE →</a></div></div><div class="wrap actions grid3"><a class="action" href="#archive"><div class="icon">◫</div><div><h3>ARCHIVE</h3><p>Explore our past memories and essays.</p><span>VIEW ARCHIVE →</span></div></a><a class="action red" href="#submission"><div class="icon">✎</div><div><h3>SUBMISSION</h3><p>Share your story, idea and perspective.</p><span>SUBMIT NOW →</span></div></a><a class="action" href="#subscribe"><div class="icon">✉</div><div><h3>SUBSCRIBE</h3><p>Stay updated with our magazine and news.</p><span>SUBSCRIBE →</span></div></a></div><section class="wrap section"><div class="heading"><span>◀</span><h2>LATEST FROM THE JOURNAL</h2><span>▶</span></div><div class="posts">${latest.length ? latest.map(card2).join('') : '<div class="panel">The archive is being prepared.</div>'}</div><div class="center"><a class="btn alt" href="#archive">VIEW ALL POSTS</a></div></section><section class="wrap manifesto"><div class="eyebrow">WHY WE WRITE</div><h2>The archive is not a museum.<br>It is a living argument.</h2><p>We gather histories, memories and unfinished questions from places where silence has been mistaken for absence.</p></section></main>`;
};

window.archive = function(){
  return `<main class="wrap page"><div class="crumb">HOME　›　ARCHIVE</div><div class="title"><div class="heading"><span>◀</span><h1>ARCHIVE</h1><span>▶</span></div><p>Stories, essays and reflections from the journal.</p></div><div class="toolbar"><select id="cat2"><option value="all">All Categories</option><option>Identity</option><option>History</option><option>Reflections</option><option>Culture</option><option>Society</option><option>Essays</option></select><select id="year2"><option value="all">All Dates</option><option>2024</option><option>2025</option><option>2026</option></select><select id="sort2"><option value="new">Sort by Latest</option><option value="old">Sort by Oldest</option></select><div class="search"><input id="q2" placeholder="Search articles"><button id="search2">⌕</button></div></div><div class="archive-layout"><div id="alist2" class="archive-list"></div><aside class="side"><h3>CATEGORIES</h3><div id="counts2"></div><h3>POPULAR TAGS</h3><p><span>memory</span><span>identity</span></p><p><span>history</span><span>culture</span></p><p><span>heritage</span><span>africa</span></p></aside></div></main>`;
};
window.drawArchive = function(){
  const a=[...currentPosts().filter(p=>p.status==='published')],c=document.getElementById('cat2')?.value||'all',y=document.getElementById('year2')?.value||'all',q=(document.getElementById('q2')?.value||'').toLowerCase(),s=document.getElementById('sort2')?.value||'new';
  let b=a;
  if(c!=='all') b=b.filter(p=>p.category===c);
  if(y!=='all') b=b.filter(p=>new Date(p.date).getFullYear().toString()===y);
  if(q) b=b.filter(p=>(p.title+' '+p.excerpt+' '+p.category+' '+p.body.join(' ')).toLowerCase().includes(q));
  b.sort((x,z)=>s==='new'?new Date(z.date)-new Date(x.date):new Date(x.date)-new Date(z.date));
  const list=document.getElementById('alist2'); if(!list)return;
  list.innerHTML=b.map(p=>`<a class="archive-item" href="#post/${esc2(p.id)}"><div class="thumb ${esc2(p.thumb)}"${coverStyle(p)}></div><div><div class="cat">${esc2(p.category)}</div><h3>${esc2(p.title)}</h3><div class="date">${date2(p.date)}</div><p>${esc2(p.excerpt)}</p></div></a>`).join('')||'<div style="padding:22px;color:#888">No matching articles.</div>';
  const counts={}; a.forEach(p=>counts[p.category]=(counts[p.category]||0)+1);
  document.getElementById('counts2').innerHTML=Object.entries(counts).map(([k,v])=>`<p><span>${esc2(k)}</span><span>${v}</span></p>`).join('');
  ['cat2','year2','sort2'].forEach(id=>document.getElementById(id)?.addEventListener('change',window.drawArchive));
  document.getElementById('q2')?.addEventListener('input',window.drawArchive);
  document.getElementById('search2')?.addEventListener('click',window.drawArchive);
};

window.article = function(id){
  const p=currentPosts().find(x=>x.id===id);
  if(!p) return `<main class="wrap page"><div class="title"><h1>Article not found</h1></div></main>`;
  const paragraphs=p.body;
  return `<main class="wrap page"><div class="crumb">HOME　›　BLOG　›　${esc2(p.title)}</div><article class="article"><div class="article-head"><div class="cat">${esc2(p.category)}</div><h1>${esc2(p.title)}</h1><div class="meta"><span>${date2(p.date)}</span><span>|</span><span>by ${esc2(window.TIA_DB.profile?.display_name || 'The Journal')}</span><span>|</span><span>In ${esc2(p.category)}</span></div></div><div class="cover thumb ${esc2(p.thumb)}"${coverStyle(p)}></div><div class="article-text">${paragraphs.map((x,i)=>`<p class="${i===0?'lead':''}">${esc2(x)}</p>`).join('')}<div class="share"><button onclick="navigator.clipboard?.writeText(location.href)">↗</button><button onclick="navigator.share ? navigator.share({title:'${esc2(p.title)}',url:location.href}) : alert('Link copied. Share it from your browser.')">↗</button></div></div></article></main>`;
};

window.about = function(){return `<main class="wrap page"><div class="crumb">HOME　›　ABOUT</div><div class="title"><div class="eyebrow">THE JOURNAL</div><h1>About The Inherited Amnesia</h1><p>Memory. History. Identity.</p></div><div class="split"><div class="panel"><div class="thumb books" style="height:360px"></div></div><article class="panel article-text"><p class="lead">Some silences are not ours, yet we carry them.</p><p>The Inherited Amnesia is an independent journal about memory, history, identity, culture and the stories that become harder to hear when institutions, generations or dominant narratives decide what should be forgotten.</p><p>We publish essays, reflections, archival discoveries and community submissions. The project is less interested in preserving a single official story than in asking who gets to decide what counts as one.</p><blockquote style="border-left:2px solid var(--gold);padding-left:16px;color:#d8c797">Until the lions have their own historians, the history of the hunt will always glorify the hunter.<br><small>— African proverb</small></blockquote></article></div></main>`;};

window.submission = function(){return `<main class="wrap page"><div class="title"><div class="heading"><span>◀</span><h1>SUBMISSION</h1><span>▶</span></div><p>Share your voice with our community.</p></div><div class="split"><div class="panel"><div class="thumb tree" style="height:260px"></div><div class="eyebrow" style="margin-top:18px">OPEN CALL</div><h2>Stories belong in the archive.</h2><p>We welcome original articles, essays, reflections and stories that explore memory, history, identity, culture and society.</p></div><form class="panel form" id="submissionForm"><label>Your Name<input name="name" required></label><label>Email Address<input name="email" type="email" required></label><label class="wide">Submission Title<input name="title" required></label><label>Category<select name="category" required><option value="">Select Category</option><option>Identity</option><option>History</option><option>Reflections</option><option>Culture</option><option>Society</option><option>Essays</option></select></label><label>Upload (optional, max 2MB)<input type="file" name="file" accept=".pdf,.doc,.docx,.txt"></label><label class="wide">Message / Abstract<textarea name="abstract" rows="7" required></textarea></label><button class="btn wide">SUBMIT NOW</button><div class="status wide" id="subStatus2"></div></form></div></main>`;};

window.subscribe = function(){return `<main class="wrap page"><div class="title"><div class="heading"><span>◀</span><h1>SUBSCRIBE</h1><span>▶</span></div><p>Stay connected. Stay informed.</p></div><div class="subscribe"><div class="panel"><div class="eyebrow">THE JOURNAL IN YOUR INBOX</div><h2 style="font:400 31px Georgia,serif;color:#d5b966">Subscribe to receive the latest articles, essays, magazine issues and announcements.</h2><div class="checks">✓ New blog posts<br>✓ Magazine & special issues<br>✓ Exclusive content<br>✓ Events & announcements</div></div><form class="sub-card" id="newsletterForm"><label>Email Address<input name="email" type="email" required placeholder="youremail@example.com"></label><label>First Name<input name="firstName" placeholder="Your name"></label><button class="btn">SUBSCRIBE</button><div class="copy">We respect your privacy. No spam, unsubscribe anytime.</div><div class="status" id="newsletterStatus2"></div></form></div></main>`;};

function authPage(message=''){
  return `<main class="wrap page"><div class="title"><div class="eyebrow">EDITORIAL ACCESS</div><h1>Admin Login</h1><p>Sign in to the editorial workspace, or create an account for approval.</p></div><div class="split"><form class="panel form" id="loginForm"><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="8" required></label><button class="btn wide">SIGN IN</button><div class="status wide" id="loginStatus">${esc2(message)}</div></form><form class="panel form" id="signupForm"><label>Your Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label class="wide">Password<input name="password" type="password" minlength="8" required></label><button class="btn alt wide">CREATE ACCOUNT</button><div class="copy wide">New accounts start as pending editors. An administrator must approve your account before you can publish.</div><div class="status wide" id="signupStatus"></div></form></div></main>`;
}

async function isEditor(){ await sessionState(); return ['admin','editor'].includes(window.TIA_DB.profile?.role); }

window.admin = function(){
  if(!window.TIA_DB.user) return authPage();
  if(!['admin','editor'].includes(window.TIA_DB.profile?.role)){
    return `<main class="wrap page"><div class="title"><div class="eyebrow">ACCESS PENDING</div><h1>Awaiting approval</h1><p>Your account is authenticated but does not yet have editorial permissions.</p><a class="btn alt" href="#home">RETURN TO SITE</a></div></main>`;
  }
  const p=currentPosts();
  return `<main class="admin"><aside class="admin-nav"><strong>THE<br>INHERITED<br>AMNESIA</strong><button class="active" onclick="switchAdmin('posts')">POSTS</button><button onclick="switchAdmin('submissions')">SUBMISSIONS</button><button onclick="switchAdmin('subscribers')">SUBSCRIBERS</button><button onclick="switchAdmin('settings')">SETTINGS</button><a href="#home">VIEW SITE ↗</a></aside><section class="admin-main" id="adminPanel"><div class="admin-bar"><div><div class="eyebrow">DASHBOARD</div><h1>Posts</h1></div><a class="btn" href="#editor">+ WRITE NEW POST</a></div><div class="admin-table"><div class="row header"><div>Title</div><div>Category</div><div>Status</div><div>Action</div></div>${p.map(x=>`<div class="row"><div>${esc2(x.title)}</div><div>${esc2(x.category)}</div><div>${esc2(x.status)}</div><div><button onclick="editPost('${esc2(x.id)}')">EDIT</button> <button onclick="deletePost('${esc2(x.id)}')">DELETE</button></div></div>`).join('')}</div></section></main>`;
};

window.editor = function(id){
  if(!window.TIA_DB.user || !['admin','editor'].includes(window.TIA_DB.profile?.role)) return authPage();
  const p=id ? currentPosts().find(x=>x.id===id) : null;
  return `<main class="wrap page"><div class="title"><div class="eyebrow">EDITOR</div><h1>${p?'Edit Post':'Write New Post'}</h1></div><form class="panel" id="postForm" style="max-width:900px;margin:auto;display:grid;gap:13px"><input type="hidden" name="id" value="${p?esc2(p.id):''}"><label class="eyebrow">Title<input name="title" required value="${p?esc2(p.title):''}"></label><label class="eyebrow">Category<select name="category">${['Identity','History','Reflections','Culture','Society','Essays'].map(c=>`<option ${p?.category===c?'selected':''}>${c}</option>`).join('')}</select></label><label class="eyebrow">Excerpt<textarea name="excerpt" rows="3" required>${p?esc2(p.excerpt):''}</textarea></label><label class="eyebrow">Content<textarea name="content" rows="15" required>${p?esc2(p.body.join('\n\n')):''}</textarea></label><label class="eyebrow">Status<select name="status"><option value="draft" ${p?.status==='draft'?'selected':''}>Draft</option><option value="published" ${!p||p?.status==='published'?'selected':''}>Published</option></select></label><label class="eyebrow">Cover image<input name="cover" type="file" accept="image/*"></label><button class="btn">${p?'SAVE CHANGES':'PUBLISH / SAVE POST'}</button><div id="postStatus" class="status"></div></form></main>`;
};

window.render = function(){
  const h=location.hash.slice(1)||'home',parts=h.split('/');
  let out=parts[0]==='home'?window.home():parts[0]==='archive'?window.archive():parts[0]==='post'?window.article(parts[1]):parts[0]==='about'?window.about():parts[0]==='submission'?window.submission():parts[0]==='subscribe'?window.subscribe():parts[0]==='admin'?window.admin():parts[0]==='editor'?window.editor(parts[1]):parts[0]==='privacy'?privacy():parts[0]==='terms'?terms():window.home();
  document.getElementById('app').innerHTML=out;
  if(parts[0]==='archive') window.drawArchive();
  bindRouteForms(parts[0]);
  window.scrollTo(0,0);
};

async function toDataUrl(file){
  if(!file) return null;
  if(file.size > 2*1024*1024) throw new Error('Please keep public submission files at or below 2MB.');
  return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});
}

async function bindRouteForms(route){
  if(route==='submission'){
    document.getElementById('submissionForm')?.addEventListener('submit',async e=>{
      e.preventDefault(); const f=new FormData(e.target),status=document.getElementById('subStatus2'); status.textContent='Sending…';
      try{
        const file=f.get('file'); const fileUrl=await toDataUrl(file);
        const {error}=await supabase.from('submissions').insert({name:f.get('name'),email:f.get('email'),title:f.get('title'),category:f.get('category'),abstract:f.get('abstract'),file_url:fileUrl});
        if(error) throw error;
        e.target.reset(); status.textContent='Thank you. Your submission has been received by the editorial desk.';
      }catch(err){status.textContent=err.message || 'Submission failed. Please try again.';}
    });
  }
  if(route==='subscribe'){
    document.getElementById('newsletterForm')?.addEventListener('submit',async e=>{
      e.preventDefault(); const f=new FormData(e.target),status=document.getElementById('newsletterStatus2'); status.textContent='Subscribing…';
      const {error}=await supabase.from('subscribers').upsert({email:f.get('email').trim().toLowerCase(),first_name:f.get('firstName')||null,status:'active'},{onConflict:'email'});
      if(error){status.textContent=error.message;return;} e.target.reset();status.textContent='You are subscribed. Welcome to the archive.';
    });
  }
  if(route==='admin') bindAdmin();
  if(route==='editor') bindEditor();
}

async function bindAuth(){
  document.getElementById('loginForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const f=new FormData(e.target),s=document.getElementById('loginStatus');s.textContent='Signing in…';
    const {error}=await supabase.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});
    if(error){s.textContent=error.message;return;} await sessionState(); await loadPosts(); location.hash='admin';
  });
  document.getElementById('signupForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const f=new FormData(e.target),s=document.getElementById('signupStatus');s.textContent='Creating account…';
    const {data,error}=await supabase.auth.signUp({email:f.get('email'),password:f.get('password'),options:{data:{display_name:f.get('name')}}});
    if(error){s.textContent=error.message;return;}
    s.textContent=data.session ? 'Account created. Waiting for editorial approval.' : 'Account created. Check your email to confirm the account. Then return here to sign in.';
  });
}

async function bindAdmin(){
  if(!await isEditor()){ window.render(); if(document.getElementById('loginForm')) bindAuth(); return; }
  const panel=document.getElementById('adminPanel'); if(!panel)return;
  window.switchAdmin=async section=>{
    if(section==='posts'){await sessionState();await loadPosts();window.render();return;}
    if(section==='submissions'){
      const {data,error}=await supabase.from('submissions').select('*').order('created_at',{ascending:false});
      panel.innerHTML=`<div class="admin-bar"><div><div class="eyebrow">DASHBOARD</div><h1>Submissions</h1></div><button class="btn alt" onclick="switchAdmin('posts')">BACK TO POSTS</button></div><div class="admin-table">${(data||[]).map(s=>`<div class="row" style="grid-template-columns:1.2fr 1.4fr .8fr 1fr"><div><strong>${esc2(s.title)}</strong><br><span class="date">${esc2(s.name)} · ${esc2(s.email)}</span></div><div>${esc2(s.abstract||'')}</div><div>${esc2(s.status)}</div><div><button onclick="updateSubmission('${esc2(s.id)}','reviewing')">REVIEW</button> <button onclick="updateSubmission('${esc2(s.id)}','accepted')">ACCEPT</button> <button onclick="updateSubmission('${esc2(s.id)}','rejected')">REJECT</button>${s.file_url?` <button onclick="viewSubmissionFile('${esc2(s.id)}')">FILE</button>`:''}</div></div>`).join('')||'<div style="padding:22px;color:#888">No submissions yet.</div>'}</div>`;
      return;
    }
    if(section==='subscribers'){
      const {data}=await supabase.from('subscribers').select('*').order('created_at',{ascending:false});
      panel.innerHTML=`<div class="admin-bar"><div><div class="eyebrow">DASHBOARD</div><h1>Subscribers</h1></div><button class="btn" onclick="exportSubscribers()">EXPORT CSV</button></div><div class="admin-table"><div class="row header" style="grid-template-columns:1fr 1fr 1fr"><div>Email</div><div>First name</div><div>Joined</div></div>${(data||[]).map(s=>`<div class="row" style="grid-template-columns:1fr 1fr 1fr"><div>${esc2(s.email)}</div><div>${esc2(s.first_name||'')}</div><div>${date2(s.created_at)}</div></div>`).join('')||'<div style="padding:22px;color:#888">No subscribers yet.</div>'}</div>`;
      return;
    }
    if(section==='settings'){
      panel.innerHTML=`<div class="admin-bar"><div><div class="eyebrow">ACCOUNT</div><h1>Settings</h1></div></div><div class="panel"><p>Signed in as <strong>${esc2(window.TIA_DB.user?.email)}</strong></p><p>Role: <strong>${esc2(window.TIA_DB.profile?.role)}</strong></p><button class="btn red" onclick="signOut()">SIGN OUT</button></div>`;
    }
  };
  window.updateSubmission=async(id,status)=>{await supabase.from('submissions').update({status}).eq('id',id);window.switchAdmin('submissions');};
  window.viewSubmissionFile=async(id)=>{const {data}=await supabase.from('submissions').select('file_url,title').eq('id',id).single();if(data?.file_url){const w=window.open();w.document.write(`<title>${esc2(data.title)}</title><pre style="white-space:pre-wrap">${esc2(data.file_url.slice(0,120))}…</pre>`)}};
  window.exportSubscribers=async()=>{const {data}=await supabase.from('subscribers').select('email,first_name,status,created_at').order('created_at',{ascending:false});const csv=['email,first_name,status,created_at',...(data||[]).map(x=>[x.email,x.first_name||'',x.status,x.created_at].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='inherited-amnesia-subscribers.csv';a.click();URL.revokeObjectURL(url);};
  window.signOut=async()=>{await supabase.auth.signOut();window.TIA_DB.user=null;window.TIA_DB.profile=null;await loadPosts();location.hash='home';};
  window.deletePost=async(id)=>{if(!confirm('Delete this post?'))return;const {error}=await supabase.from('posts').delete().eq('id',id);if(error){alert(error.message);return;}await loadPosts();window.render();};
  window.editPost=id=>{location.hash='editor/'+encodeURIComponent(id);};
}

async function bindEditor(){
  document.getElementById('postForm')?.addEventListener('submit',async e=>{
    e.preventDefault(); const f=new FormData(e.target),statusEl=document.getElementById('postStatus'); statusEl.textContent='Saving…';
    try{
      await sessionState(); if(!['admin','editor'].includes(window.TIA_DB.profile?.role)) throw new Error('Editorial access required.');
      let cover_url=null; const id=f.get('id'); const old=currentPosts().find(p=>p.id===id);
      if(old?.cover_url) cover_url=old.cover_url;
      const file=f.get('cover');
      if(file && file.size){
        if(file.size>8*1024*1024) throw new Error('Cover images must be 8MB or smaller.');
        const ext=(file.name.split('.').pop()||'jpg').toLowerCase(); const path=`posts/${Date.now()}-${slugify(f.get('title'))}.${ext}`;
        const up=await supabase.storage.from('journal-media').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
        if(up.error) throw up.error;
        cover_url=supabase.storage.from('journal-media').getPublicUrl(path).data.publicUrl;
      }
      const title=f.get('title').trim(), slug=id?old?.slug:slugify(title);
      const payload={title,slug,excerpt:f.get('excerpt').trim(),content:f.get('content'),category:f.get('category'),status:f.get('status'),cover_url,published_at:f.get('status')==='published'?(old?.date||new Date().toISOString()):null,updated_at:new Date().toISOString(),author_id:window.TIA_DB.user.id};
      let result;
      if(id){ result=await supabase.from('posts').update(payload).eq('id',id); }
      else { result=await supabase.from('posts').insert(payload); }
      if(result.error) throw result.error;
      await loadPosts(); statusEl.textContent='Saved successfully.'; setTimeout(()=>location.hash='admin',500);
    }catch(err){statusEl.textContent=err.message||'Unable to save post.';}
  });
}

const originalPrivacy=window.privacy, originalTerms=window.terms;
if(typeof originalPrivacy!=='function'){window.privacy=()=>'<main class="wrap page"><div class="title"><div class="eyebrow">LEGAL</div><h1>Privacy</h1></div><article class="panel article-text"><p>We collect information you voluntarily provide through subscriptions and submissions. Production data is stored in Supabase and accessed by authorized editorial staff.</p></article></main>';}
if(typeof originalTerms!=='function'){window.terms=()=>'<main class="wrap page"><div class="title"><div class="eyebrow">LEGAL</div><h1>Terms of Use</h1></div><article class="panel article-text"><p>Content published by The Inherited Amnesia is intended for reading, discussion and research. Final editorial and copyright terms should be added before public launch.</p></article></main>';}

window.addEventListener('hashchange', async ()=>{
  await sessionState();
  await loadPosts();
  window.render();
  if(['admin','editor'].includes(window.TIA_DB.profile?.role) && location.hash==='#admin') await bindAdmin();
  if(location.hash==='#admin' && !window.TIA_DB.user) bindAuth();
});
supabase.auth.onAuthStateChange(async()=>{ await sessionState(); if(location.hash==='#admin'){ await loadPosts(); window.render(); if(window.TIA_DB.user) await bindAdmin(); else bindAuth(); }});

(async function init(){
  await sessionState();
  await loadPosts();
  window.render();
  if(location.hash==='#admin' && !window.TIA_DB.user) bindAuth();
})();