import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uzyawtzbdcfqdfquexga.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oZfQZQsptiMY3J_EHnJrGg_sFCf5js2';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

window.TIA_DB = { posts: [], profile: null, user: null, ready: false, error: null };

const esc2 = x => (x ?? '').toString().replace(/[&<>'"]/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
}[c]));
const date2 = d => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d));
const slugify = x => x.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const DOCX_PREFIX = 'TIA_DOCX_V1:';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CORE_TITLE_NS = 'http://purl.org/dc/elements/1.1/';

function decodeDocxContent(content){
  if(typeof content !== 'string' || !content.startsWith(DOCX_PREFIX)) return null;
  try {
    const model = JSON.parse(content.slice(DOCX_PREFIX.length));
    if(model?.version === 1 && Array.isArray(model.blocks)) return model;
  } catch(err) { console.warn('Could not decode imported Word content.', err); }
  return null;
}
function directWordChild(node, name){
  return Array.from(node?.children || []).find(child => child.localName === name) || null;
}
function wordAttribute(node, name){
  return node?.getAttributeNS(WORD_NS, name) || node?.getAttribute('w:' + name) || node?.getAttribute(name) || '';
}
function parseWordXml(text){
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if(xml.getElementsByTagName('parsererror').length) throw new Error('Word document XML could not be read. Please open the file in Word and save it as .docx again.');
  return xml;
}
function wordRunStyle(run){
  const p = directWordChild(run, 'rPr');
  const enabled = name => {
    const item = directWordChild(p, name);
    if(!item) return false;
    const value = wordAttribute(item, 'val').toLowerCase();
    return !['0','false','off','none'].includes(value);
  };
  const vert = directWordChild(p, 'vertAlign');
  return {
    bold: enabled('b') || enabled('bCs'),
    italic: enabled('i') || enabled('iCs'),
    underline: enabled('u'),
    strike: enabled('strike') || enabled('dstrike'),
    vertical: vert ? wordAttribute(vert, 'val') : ''
  };
}
function appendWordPart(parts, part){
  if(part.type === 'text' && !part.text) return;
  const last = parts[parts.length - 1];
  if(part.type === 'text' && last?.type === 'text' && JSON.stringify(last.style || {}) === JSON.stringify(part.style || {})){
    last.text += part.text;
  } else parts.push(part);
}
function getWordFootnoteNumber(id, ctx){
  if(!ctx.footnoteIds.has(String(id))) return null;
  if(!ctx.footnoteNumbers.has(String(id))){
    ctx.refOrder.push(String(id));
    ctx.footnoteNumbers.set(String(id), ctx.refOrder.length);
  }
  return ctx.footnoteNumbers.get(String(id));
}
function parseWordInline(node, ctx){
  const parts = [];
  const walk = (el, style = {}) => {
    const tag = el.localName;
    if(tag === 'r'){
      const nextStyle = { ...style, ...wordRunStyle(el) };
      for(const child of Array.from(el.children || [])) if(child.localName !== 'rPr') walk(child, nextStyle);
      return;
    }
    if(tag === 't' || tag === 'delText'){
      appendWordPart(parts, {type:'text', text:el.textContent || '', style});
      return;
    }
    if(tag === 'tab'){
      appendWordPart(parts, {type:'text', text:'\t', style});
      return;
    }
    if(tag === 'br' || tag === 'cr'){
      parts.push({type:'break'});
      return;
    }
    if(tag === 'footnoteReference'){
      if(ctx.inFootnote) return;
      const id = wordAttribute(el, 'id');
      const number = getWordFootnoteNumber(id, ctx);
      if(number) parts.push({type:'footnoteRef', id:String(id), number});
      return;
    }
    if(tag === 'footnoteRef' || tag === 'instrText' || tag === 'delInstrText') return;
    for(const child of Array.from(el.children || [])) walk(child, style);
  };
  walk(node);
  return parts;
}
function parseWordNumbering(xml){
  const result = new Map();
  if(!xml) return result;
  const abstractTypes = new Map();
  for(const item of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'abstractNum'))){
    const id = wordAttribute(item, 'abstractNumId');
    const level = directWordChild(item, 'lvl') || item.getElementsByTagNameNS(WORD_NS, 'lvl')[0];
    const fmt = level ? wordAttribute(directWordChild(level, 'numFmt'), 'val').toLowerCase() : '';
    abstractTypes.set(id, fmt === 'bullet' ? 'ul' : 'ol');
  }
  for(const item of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'num'))){
    const id = wordAttribute(item, 'numId');
    const abstractId = wordAttribute(directWordChild(item, 'abstractNumId'), 'val');
    result.set(id, abstractTypes.get(abstractId) || 'ul');
  }
  return result;
}
function parseWordParagraph(paragraph, ctx){
  const properties = directWordChild(paragraph, 'pPr');
  const styleId = wordAttribute(directWordChild(properties, 'pStyle'), 'val');
  const normalized = styleId.toLowerCase().replace(/[^a-z0-9]/g, '');
  const outline = directWordChild(properties, 'outlineLvl');
  const outlineValue = outline ? Number(wordAttribute(outline, 'val')) : NaN;
  let type = 'p';
  if(normalized === 'title') type = 'docTitle';
  else if(/^heading[1-3]$/.test(normalized)) type = 'h' + normalized.slice(-1);
  else if(Number.isFinite(outlineValue) && outlineValue >= 0 && outlineValue <= 2) type = 'h' + (outlineValue + 1);
  else if(normalized === 'quote' || normalized === 'intensequote') type = 'quote';
  const numPr = directWordChild(properties, 'numPr');
  const numId = numPr ? wordAttribute(directWordChild(numPr, 'numId'), 'val') : '';
  const alignNode = directWordChild(properties, 'jc');
  const alignValue = alignNode ? wordAttribute(alignNode, 'val').toLowerCase() : '';
  const align = ({center:'center', right:'right', both:'justify', distribute:'justify'}[alignValue] || '');
  const parts = parseWordInline(paragraph, ctx);
  if(numId && numId !== '0') return {type:'listItem', listType:ctx.listTypes.get(numId) || 'ul', parts, align};
  return {type, parts, align};
}
function parseWordTable(table, ctx){
  const rows = [];
  for(const row of Array.from(table.children || []).filter(x => x.localName === 'tr')){
    const cells = [];
    for(const cell of Array.from(row.children || []).filter(x => x.localName === 'tc')){
      cells.push(parseWordBlocks(cell, ctx));
    }
    rows.push(cells);
  }
  return {type:'table', rows};
}
function parseWordBlocks(container, ctx){
  const blocks = [];
  for(const child of Array.from(container?.children || [])){
    if(child.localName === 'p') blocks.push(parseWordParagraph(child, ctx));
    else if(child.localName === 'tbl') blocks.push(parseWordTable(child, ctx));
  }
  return blocks;
}
function inlinePlainText(parts){
  return (parts || []).map(part => part.type === 'footnoteRef' ? '[' + part.number + ']' : part.type === 'break' ? '\n' : (part.text || '')).join('');
}
function wordBlockPlainText(block){
  if(!block) return '';
  if(block.type === 'table') return (block.rows || []).map(row => row.map(cell => (cell || []).map(wordBlockPlainText).filter(Boolean).join(' ')).join(' | ')).join('\n');
  const text = inlinePlainText(block.parts);
  return block.type === 'listItem' ? '• ' + text : text;
}
function wordModelPlainText(model, includeFootnotes = false){
  const body = (model.blocks || []).map(wordBlockPlainText).filter(text => text.trim()).join('\n\n');
  if(!includeFootnotes || !model.footnotes?.length) return body;
  const notes = model.footnotes.map(note => String(note.number) + '. ' + (note.blocks || []).map(wordBlockPlainText).filter(Boolean).join(' ')).join('\n');
  return body + '\n\nFOOTNOTES\n' + notes;
}
function renderWordInline(parts){
  return (parts || []).map(part => {
    if(part.type === 'break') return '<br>';
    if(part.type === 'footnoteRef'){
      const n = Number(part.number);
      return '<sup class="docx-footnote-ref" id="fn-ref-' + n + '"><a href="#fn-note-' + n + '" aria-label="Footnote ' + n + '">' + n + '</a></sup>';
    }
    let text = esc2(part.text || '').replace(/\n/g, '<br>');
    const style = part.style || {};
    if(style.bold) text = '<strong>' + text + '</strong>';
    if(style.italic) text = '<em>' + text + '</em>';
    if(style.underline) text = '<u>' + text + '</u>';
    if(style.strike) text = '<s>' + text + '</s>';
    if(style.vertical === 'superscript') text = '<sup>' + text + '</sup>';
    else if(style.vertical === 'subscript') text = '<sub>' + text + '</sub>';
    return text;
  }).join('');
}
function renderWordBlocks(blocks){
  let html = '';
  for(let i=0; i<(blocks || []).length; i++){
    const block = blocks[i];
    if(block.type === 'listItem'){
      const listType = block.listType === 'ol' ? 'ol' : 'ul';
      let items = '';
      while(i < blocks.length && blocks[i].type === 'listItem' && (blocks[i].listType === 'ol' ? 'ol' : 'ul') === listType){
        items += '<li>' + renderWordInline(blocks[i].parts) + '</li>';
        i++;
      }
      i--;
      html += '<' + listType + ' class="docx-list">' + items + '</' + listType + '>';
      continue;
    }
    if(block.type === 'table'){
      const rows = (block.rows || []).map(row => '<tr>' + row.map(cell => '<td>' + renderWordBlocks(cell) + '</td>').join('') + '</tr>').join('');
      html += '<div class="docx-table-wrap"><table class="docx-table"><tbody>' + rows + '</tbody></table></div>';
      continue;
    }
    const align = block.align ? ' style="text-align:' + block.align + '"' : '';
    const inline = renderWordInline(block.parts);
    if(block.type === 'h1') html += '<h2 class="docx-heading"' + align + '>' + inline + '</h2>';
    else if(block.type === 'h2') html += '<h3 class="docx-heading"' + align + '>' + inline + '</h3>';
    else if(block.type === 'h3') html += '<h4 class="docx-heading"' + align + '>' + inline + '</h4>';
    else if(block.type === 'docTitle') html += '<h2 class="docx-title-block"' + align + '>' + inline + '</h2>';
    else if(block.type === 'quote') html += '<blockquote class="docx-quote"' + align + '>' + inline + '</blockquote>';
    else html += '<p' + align + '>' + inline + '</p>';
  }
  return html;
}
function renderWordFootnotes(notes){
  if(!notes?.length) return '';
  return '<section class="docx-footnotes" aria-label="Footnotes"><h2>Footnotes</h2><ol>' + notes.map(note => {
    const n = Number(note.number);
    return '<li id="fn-note-' + n + '">' + renderWordBlocks(note.blocks) + '<a class="docx-footnote-back" href="#fn-ref-' + n + '" aria-label="Back to footnote reference ' + n + '">↩</a></li>';
  }).join('') + '</ol></section>';
}
async function importWordDocx(file){
  if(!file || !/\.docx$/i.test(file.name)) throw new Error('Please select a Microsoft Word .docx file. Older .doc files are not supported yet.');
  if(file.size > 20 * 1024 * 1024) throw new Error('Please keep Word documents under 20 MB.');
  const module = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const JSZip = module.default || module;
  const zip = await JSZip.loadAsync(file);
  const documentFile = zip.file('word/document.xml');
  if(!documentFile) throw new Error('This file does not look like a valid .docx document.');
  const documentXml = parseWordXml(await documentFile.async('string'));
  const body = documentXml.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if(!body) throw new Error('No document body was found in this Word file.');
  const noteFile = zip.file('word/footnotes.xml');
  const footnoteXml = noteFile ? parseWordXml(await noteFile.async('string')) : null;
  const footnoteElements = footnoteXml ? Array.from(footnoteXml.getElementsByTagNameNS(WORD_NS, 'footnote')) : [];
  const footnoteMap = new Map();
  footnoteElements.forEach(note => {
    const id = wordAttribute(note, 'id');
    const noteType = wordAttribute(note, 'type');
    if(id && Number(id) > 0 && !['separator','continuationSeparator'].includes(noteType)) footnoteMap.set(String(id), note);
  });
  const numberingFile = zip.file('word/numbering.xml');
  const numberingXml = numberingFile ? parseWordXml(await numberingFile.async('string')) : null;
  const coreFile = zip.file('docProps/core.xml');
  const coreXml = coreFile ? parseWordXml(await coreFile.async('string')) : null;
  const titleNode = coreXml?.getElementsByTagNameNS(CORE_TITLE_NS, 'title')[0];
  const metadataTitle = (titleNode?.textContent || '').trim();
  const ctx = {footnoteIds:new Set(footnoteMap.keys()), footnoteNumbers:new Map(), refOrder:[], listTypes:parseWordNumbering(numberingXml), inFootnote:false};
  let blocks = parseWordBlocks(body, ctx);
  let firstHeadingTitle = '';
  if(blocks[0] && ['docTitle','h1'].includes(blocks[0].type)) firstHeadingTitle = wordBlockPlainText(blocks[0]).trim();
  const title = metadataTitle || firstHeadingTitle || file.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim();
  if(blocks[0] && ['docTitle','h1'].includes(blocks[0].type) && wordBlockPlainText(blocks[0]).trim().toLowerCase() === title.toLowerCase()) blocks = blocks.slice(1);
  ctx.inFootnote = true;
  const notes = ctx.refOrder.map(id => {
    const noteElement = footnoteMap.get(id);
    return {id, number:ctx.footnoteNumbers.get(id), blocks:noteElement ? parseWordBlocks(noteElement, ctx) : []};
  }).filter(note => note.blocks.length);
  const model = {version:1, blocks, footnotes:notes};
  const firstParagraph = blocks.find(block => block.type === 'p' && wordBlockPlainText(block).trim().length > 20);
  return {
    model,
    title,
    excerpt: (firstParagraph ? wordBlockPlainText(firstParagraph) : wordModelPlainText({blocks,footnotes:[]}, false)).replace(/\s+/g,' ').trim().slice(0,280),
    plainText:wordModelPlainText(model, true)
  };
}
const thumbClass = category => ({Identity:'face',History:'tree',Reflections:'face',Culture:'books',Society:'tree',Essays:'books'}[category] || 'books');
const postView = p => {
  const rawContent = p.content || '';
  const richModel = decodeDocxContent(rawContent);
  const plain = richModel ? wordModelPlainText({blocks:richModel.blocks || [], footnotes:[]}, false) : rawContent;
  return {
    id:p.id, slug:p.slug, title:p.title, date:p.published_at || p.created_at, category:p.category,
    thumb:thumbClass(p.category), excerpt:p.excerpt || '', cover_url:p.cover_url || '',
    body:plain.split(/\n\s*\n/).filter(Boolean), richModel, richContent:richModel ? rawContent : '',
    editorText:richModel ? wordModelPlainText(richModel, true) : plain,
    status:p.status, author_id:p.author_id
  };
};

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
  if (error) {
    console.error('Article query failed:',error);
    window.TIA_DB.error = error.message || 'Database connection unavailable';
    window.TIA_DB.ready = true;
    return;
  }
  window.TIA_DB.posts = (data || []).map(postView);
  window.TIA_DB.error = null;
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
  const latest = currentPosts().filter(p=>p.status==='published').slice(0,5);
  const row = (p,i) => "<a class='feed-row' href='#post/"+esc2(p.id)+"'><div class='feed-index'>"+String(i+1).padStart(2,'0')+"</div><div class='feed-content'><div class='cat'>"+esc2(p.category)+"</div><h3 class='feed-title'>"+esc2(p.title)+"</h3><p class='feed-excerpt'>"+esc2(p.excerpt)+"</p></div><div class='feed-meta'>"+date2(p.date)+"<br>Read essay</div></a>";
  return '<main class="shell">' +
    '<section class="hero"><div class="hero-copy"><div class="eyebrow">Independent journal · Memory / History / Identity</div><h1 class="display-title">The Inherited <span>Amnesia</span></h1><p class="lede">Reclaiming what we were never meant to forget. An independent journal for histories, memories and questions that refuse to disappear.</p><a class="btn" href="#archive">Explore the archive <svg class="arrow-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M8 5h11v11"></path></svg></a></div>' +
    '<aside class="hero-aside"><div class="issue">Essays · Histories · Reflections</div><div class="index-mark" aria-hidden="true">IA</div><p>The past is never simply gone. It leaves records, silences, and questions that still ask something of the present.</p><a class="inline-link" href="#about">Why this journal exists</a></aside></section>' +
    '<section class="action-strip" aria-label="Journal actions"><a class="action-item" href="#archive"><span class="action-number">01</span><div><h2>Read the archive</h2><p>Explore essays on inherited memory and contested history.</p><span class="inline-link">Browse articles</span></div></a>' +
    '<a class="action-item" href="#submission"><span class="action-number">02</span><div><h2>Contribute a story</h2><p>Submit an original essay, account or reflection for review.</p><span class="inline-link">Submission guide</span></div></a>' +
    '<a class="action-item" href="#subscribe"><span class="action-number">03</span><div><h2>Receive dispatches</h2><p>Get new writing and journal announcements by email.</p><span class="inline-link">Join the list</span></div></a></section>' +
    '<section class="section"><div class="section-head"><div><div class="eyebrow">From the journal</div><h2>Recent writing</h2><p>Essays and reflections from the archive.</p></div><a class="inline-link" href="#archive">All articles</a></div>' +
    '<div class="post-feed">'+(latest.length?latest.map(row).join(''):(window.TIA_DB.error?'<div class="feed-empty">The live archive is reconnecting. Please try again in a moment.</div>':'<div class="feed-empty">No articles have been published yet.</div>'))+'</div></section>' +
    '<section class="statement"><div class="statement-label">A note on memory</div><p class="statement-copy">An archive is not neutral. What survives, what is lost, and who gets to narrate the past all shape the world we <em>inherit.</em></p></section></main>';
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

};

window.article = function(id){
  const p=currentPosts().find(x=>x.id===id);
  if(!p) return `<main class="wrap page"><div class="title"><h1>Article not found</h1></div></main>`;
  const bodyHtml = p.richModel
    ? '<div class="docx-content">' + renderWordBlocks(p.richModel.blocks || []) + renderWordFootnotes(p.richModel.footnotes || []) + '</div>'
    : p.body.map((x,i)=>'<p class="' + (i===0?'lead':'') + '">' + esc2(x) + '</p>').join('');
  return `<main class="wrap page"><div class="crumb">HOME　›　BLOG　›　${esc2(p.title)}</div><article class="article"><div class="article-head"><div class="cat">${esc2(p.category)}</div><h1>${esc2(p.title)}</h1><div class="meta"><span>${date2(p.date)}</span><span>|</span><span>by ${esc2(window.TIA_DB.profile?.display_name || 'The Journal')}</span><span>|</span><span>In ${esc2(p.category)}</span></div></div><div class="cover thumb ${esc2(p.thumb)}"${coverStyle(p)}></div><div class="article-text">${bodyHtml}<div class="share"><button aria-label="Copy article link" title="Copy article link" onclick="navigator.clipboard?.writeText(location.href)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1"></rect><path d="M16 8V5H4v12h4"></path></svg></button><button aria-label="Share article" title="Share article" onclick="if(navigator.share){navigator.share({url:location.href})}else{navigator.clipboard?.writeText(location.href)}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2"></path></svg></button></div></div></article></main>`;
};
window.about = function(){return `<main class="wrap page"><div class="crumb">HOME　›　ABOUT</div><div class="title"><div class="eyebrow">THE JOURNAL</div><h1>About The Inherited Amnesia</h1><p>Memory. History. Identity.</p></div><div class="split"><div class="panel"><div class="thumb books" style="height:360px"></div></div><article class="panel article-text"><p class="lead">Never underestimate a storyteller. A man with a sword can make a people kneel; a man with a story can make their grandchildren call it salvation. He need not invent the facts. He need only arrange them carefully, leave the inconvenient dead unnamed, and give the wound a respectable explanation. By the time the truth arrives, it may find its oldest enemies defending it.</p><p>Some conquests leave ruins. Others leave textbooks, traditions, and perfectly reasonable people who cannot explain what, exactly, they have lost.</p><p><em>The Inherited Amnesia</em> is concerned with that peculiar inheritance: the things we remember incorrectly, the things we have forgotten to question, and the things we defend without knowing why. It is an exploration of memory, power, identity, and the curious human talent for mistaking a familiar story for the truth.</p><p>After all, the most successful lies are rarely the ones we are forced to believe. They are the ones we would be heartbroken to discover were lies.</p><blockquote style="border-left:2px solid var(--accent);padding-left:16px;color:var(--soft);margin-top:30px;font:italic 1.2em/1.6 Georgia,serif">“A sword decides who bleeds; a storyteller decides whose bleeding matters.”<br><small style="display:block;margin-top:10px;color:var(--accent);font:normal 10px/1.5 Arial,Helvetica,sans-serif;letter-spacing:.12em;text-transform:uppercase">— Antony Karol Muma</small></blockquote></article></div></main>`;};

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
  return `<main class="admin"><aside class="admin-nav"><strong>THE<br>INHERITED<br>AMNESIA</strong><button class="active" onclick="switchAdmin('posts')">POSTS</button><button onclick="switchAdmin('submissions')">SUBMISSIONS</button><button onclick="switchAdmin('subscribers')">SUBSCRIBERS</button><button onclick="switchAdmin('users')">USERS</button><button onclick="switchAdmin('settings')">SETTINGS</button><a href="#home">VIEW SITE</a></aside><section class="admin-main" id="adminPanel"><div class="admin-bar"><div><div class="eyebrow">DASHBOARD</div><h1>Posts</h1></div><a class="btn" href="#editor">+ WRITE NEW POST</a></div><div class="admin-table"><div class="row header"><div>Title</div><div>Category</div><div>Status</div><div>Action</div></div>${p.map(x=>`<div class="row"><div>${esc2(x.title)}</div><div>${esc2(x.category)}</div><div>${esc2(x.status)}</div><div><button onclick="editPost('${esc2(x.id)}')">EDIT</button> <button onclick="deletePost('${esc2(x.id)}')">DELETE</button></div></div>`).join('')}</div></section></main>`;
};

window.editor = function(id){
  if(!window.TIA_DB.user) return authPage();
  if(!['admin','editor'].includes(window.TIA_DB.profile?.role)) return '<main class="wrap page"><div class="eyebrow">EDITORIAL ACCESS</div><h1 class="page-title">Access pending</h1><p>Your account has been created, but an administrator must approve editorial access before you can create or edit articles.</p><a class="btn alt" href="#home">Return to journal</a></main>';
  const p=id ? currentPosts().find(x=>x.id===id) : null;
  return `<main class="wrap page"><div class="title"><div class="eyebrow">EDITOR</div><h1>${p?'Edit Post':'Write New Post'}</h1></div><form class="panel" id="postForm" style="max-width:900px;margin:auto;display:grid;gap:13px"><input type="hidden" name="id" value="${p?esc2(p.id):''}"><input type="hidden" name="richContent" value="${p?esc2(p.richContent||''):''}"><label class="eyebrow">Title<input id="postTitle" name="title" required value="${p?esc2(p.title):''}"></label><label class="eyebrow">Category<select name="category">${['Identity','History','Reflections','Culture','Society','Essays'].map(c=>`<option ${p?.category===c?'selected':''}>${c}</option>`).join('')}</select></label><label class="eyebrow">Excerpt<textarea id="postExcerpt" name="excerpt" rows="3" required>${p?esc2(p.excerpt):''}</textarea></label><label class="eyebrow">Import Word document (.docx)<input id="docxFile" name="docxFile" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label><p class="copy">Upload a Word document to import its text, headings, lists, tables and footnotes. Footnote markers become clickable references, with the notes displayed at the end of the article. Save the file as .docx first; older .doc files are not supported.</p><div id="docxStatus" class="status"></div><label class="eyebrow">Content<textarea id="postContent" name="content" rows="15" required>${p?esc2(p.editorText):''}</textarea></label><label class="eyebrow">Status<select name="status"><option value="draft" ${p?.status==='draft'?'selected':''}>Draft</option><option value="published" ${!p||p?.status==='published'?'selected':''}>Published</option></select></label><label class="eyebrow">Cover image<input name="cover" type="file" accept="image/*"></label><button class="btn">${p?'SAVE CHANGES':'PUBLISH / SAVE POST'}</button><div id="postStatus" class="status"></div></form></main>`;
};
window.render = function(){
  const h=location.hash.slice(1)||'home',parts=h.split('/');
  let out=parts[0]==='home'?window.home():parts[0]==='archive'?window.archive():parts[0]==='post'?window.article(parts[1]):parts[0]==='about'?window.about():parts[0]==='submission'?window.submission():parts[0]==='subscribe'?window.subscribe():parts[0]==='admin'?window.admin():parts[0]==='editor'?window.editor(parts[1]):parts[0]==='privacy'?window.privacy():parts[0]==='terms'?window.terms():window.home();
  document.getElementById('app').innerHTML=out;
  if(parts[0]==='archive') { window.drawArchive(); bindArchiveControls(); }
  updateNavigation(parts[0]);
  document.title = parts[0]==='post' ? ((currentPosts().find(p=>p.id===parts[1])?.title || 'Article') + ' — The Inherited Amnesia') : 'The Inherited Amnesia — Journal';
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
      e.preventDefault();
      const f=new FormData(e.target),status=document.getElementById('subStatus2');
      status.textContent='Sending submission…';status.dataset.kind='';
      let filePath=null;
      try{
        const file=f.get('file');
        if(file && file.size){
          if(file.size>2*1024*1024) throw new Error('Please keep the attachment under 2 MB.');
          const ext=(file.name.split('.').pop()||'txt').toLowerCase().replace(/[^a-z0-9]/g,'');
          filePath='incoming/'+crypto.randomUUID()+'.'+ext;
          const upload=await supabase.storage.from('submission-files').upload(filePath,file,{upsert:false,contentType:file.type||'application/octet-stream'});
          if(upload.error) throw upload.error;
        }
        const {error}=await supabase.from('submissions').insert({
          name:String(f.get('name')||'').trim(),
          email:String(f.get('email')||'').trim().toLowerCase(),
          title:String(f.get('title')||'').trim(),
          category:f.get('category'),
          abstract:String(f.get('abstract')||'').trim(),
          file_url:filePath
        });
        if(error) throw error;
        e.target.reset();status.textContent='Thank you. Your submission has reached the editorial desk.';status.dataset.kind='success';
      }catch(err){
        if(filePath) await supabase.storage.from('submission-files').remove([filePath]);
        status.textContent=err.message||'Submission failed. Please try again.';status.dataset.kind='error';
      }
    });
  }
  if(route==='subscribe'){
    document.getElementById('newsletterForm')?.addEventListener('submit',async e=>{
      e.preventDefault();
      const f=new FormData(e.target),status=document.getElementById('newsletterStatus2');
      status.textContent='Subscribing…';status.dataset.kind='';
      const email=String(f.get('email')||'').trim().toLowerCase();
      const firstName=String(f.get('firstName')||'').trim()||null;
      const {error}=await supabase.from('subscribers').upsert({email,first_name:firstName,status:'active'},{onConflict:'email',ignoreDuplicates:true});
      if(error){status.textContent='Could not subscribe just now. Please try again.';status.dataset.kind='error';return;}
      e.target.reset();status.textContent='You are subscribed. Welcome to the archive.';status.dataset.kind='success';
    });
  }
  if(route==='admin') bindAdmin();
  if(route==='editor') {
    if(!window.TIA_DB.user) bindAuth();
    else if(['admin','editor'].includes(window.TIA_DB.profile?.role)) bindEditor();
  }
}
async function bindAuth(){
  document.getElementById('loginForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const f=new FormData(e.target),s=document.getElementById('loginStatus');s.textContent='Signing in…';
    const {error}=await supabase.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});
    if(error){s.textContent=error.message;return;} await sessionState(); await loadPosts(); window.render();
  });
  document.getElementById('signupForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const f=new FormData(e.target),s=document.getElementById('signupStatus');s.textContent='Creating account…';
    const {data,error}=await supabase.auth.signUp({email:f.get('email'),password:f.get('password'),options:{emailRedirectTo:window.location.origin,data:{display_name:f.get('name')}}});
    if(error){s.textContent=error.message;return;}
    s.textContent=data.session ? 'Account created. Waiting for editorial approval.' : 'Account created. Check your email to confirm the account. Then return here to sign in.'; if(data.session){await sessionState();await loadPosts();window.render();}
  });
}

async function bindAdmin(){
  if(!window.TIA_DB.user){ bindAuth(); return; } if(!['admin','editor'].includes(window.TIA_DB.profile?.role)) return;
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
    if(section==='users'){
      if(window.TIA_DB.profile?.role!=='admin'){
        panel.innerHTML='<div class="admin-bar"><div><div class="eyebrow">ACCESS CONTROL</div><h1>Users</h1></div></div><p class="admin-note">Only administrators can change editorial roles.</p>';
        return;
      }
      const {data,error}=await supabase.from('profiles').select('id,display_name,role,created_at').order('created_at',{ascending:false});
      if(error){panel.innerHTML='<p class="admin-note">Could not load users. Please try again.</p>';return;}
      const rows=(data||[]).map(u=>{
        const name=esc2(u.display_name||('User '+u.id.slice(0,8)));
        const current=u.id===window.TIA_DB.user.id;
        const roleOptions=['pending','editor','admin'].map(r=>'<option value="'+r+'" '+(u.role===r?'selected':'')+'>'+r+'</option>').join('');
        const action=current?'Current account':'<select aria-label="Role for '+name+'" id="role-'+u.id+'">'+roleOptions+'</select> <button onclick="updateRole(\''+u.id+'\',document.getElementById(\'role-'+u.id+'\').value)">SAVE ROLE</button>';
        return '<div class="row" style="grid-template-columns:minmax(160px,1fr) minmax(110px,.8fr) minmax(100px,.8fr) minmax(160px,1fr)"><div>'+name+'<br><span class="muted">'+u.id.slice(0,8)+'</span></div><div>'+esc2(u.role)+'</div><div>'+date2(u.created_at)+'</div><div class="table-actions">'+action+'</div></div>';
      }).join('');
      panel.innerHTML='<div class="admin-bar"><div><div class="eyebrow">ACCESS CONTROL</div><h1>Users</h1></div></div><div class="admin-table"><div class="row header" style="grid-template-columns:minmax(160px,1fr) minmax(110px,.8fr) minmax(100px,.8fr) minmax(160px,1fr)"><div>Account</div><div>Role</div><div>Joined</div><div>Change role</div></div>'+(rows||'<div style="padding:22px;color:#888">No user accounts yet.</div>')+'</div><p class="admin-note">New accounts start as pending. Grant administrator access only to people you trust.</p>';
      return;
    }
    if(section==='settings'){
      panel.innerHTML=`<div class="admin-bar"><div><div class="eyebrow">ACCOUNT</div><h1>Settings</h1></div></div><div class="panel"><p>Signed in as <strong>${esc2(window.TIA_DB.user?.email)}</strong></p><p>Role: <strong>${esc2(window.TIA_DB.profile?.role)}</strong></p><button class="btn red" onclick="signOut()">SIGN OUT</button></div>`;
    }
  };
  window.updateRole=async(id,role)=>{if(!['pending','editor','admin'].includes(role)){alert('Invalid role.');return;}const {error}=await supabase.from('profiles').update({role}).eq('id',id);if(error){alert(error.message);return;}await sessionState();window.switchAdmin('users');};
  window.updateSubmission=async(id,status)=>{await supabase.from('submissions').update({status}).eq('id',id);window.switchAdmin('submissions');};
  window.viewSubmissionFile=async(id)=>{const {data,error}=await supabase.from('submissions').select('file_url,title').eq('id',id).single();if(error||!data?.file_url){alert('No attachment was found.');return;}const {data:signed,error:signError}=await supabase.storage.from('submission-files').createSignedUrl(data.file_url,300);if(signError){alert(signError.message);return;}window.open(signed.signedUrl,'_blank','noopener');};
  window.exportSubscribers=async()=>{const {data}=await supabase.from('subscribers').select('email,first_name,status,created_at').order('created_at',{ascending:false});const csv=['email,first_name,status,created_at',...(data||[]).map(x=>[x.email,x.first_name||'',x.status,x.created_at].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='inherited-amnesia-subscribers.csv';a.click();URL.revokeObjectURL(url);};
  window.signOut=async()=>{await supabase.auth.signOut();window.TIA_DB.user=null;window.TIA_DB.profile=null;await loadPosts();location.hash='home';};
  window.deletePost=async(id)=>{if(!confirm('Delete this post?'))return;const {error}=await supabase.from('posts').delete().eq('id',id);if(error){alert(error.message);return;}await loadPosts();window.render();};
  window.editPost=id=>{location.hash='editor/'+encodeURIComponent(id);};
}

async function bindEditor(){
  const form = document.getElementById('postForm');
  if(!form) return;
  const contentField = form.elements.content;
  const richField = form.elements.richContent;
  const docxFile = document.getElementById('docxFile');
  const docxStatus = document.getElementById('docxStatus');
  const statusEl = document.getElementById('postStatus');
  let contentSnapshot = contentField?.value || '';

  docxFile?.addEventListener('change', async () => {
    const file = docxFile.files?.[0];
    if(!file) return;
    docxStatus.textContent = 'Reading the Word document…';
    docxStatus.dataset.kind = '';
    try{
      const imported = await importWordDocx(file);
      richField.value = DOCX_PREFIX + JSON.stringify(imported.model);
      contentField.value = imported.plainText;
      contentSnapshot = contentField.value;
      const titleField = form.elements.title;
      const excerptField = form.elements.excerpt;
      if(!titleField.value.trim()) titleField.value = imported.title;
      if(!excerptField.value.trim()) excerptField.value = imported.excerpt || imported.title;
      const noteCount = imported.model.footnotes?.length || 0;
      docxStatus.textContent = 'Word document imported. ' + noteCount + ' footnote' + (noteCount === 1 ? '' : 's') + ' detected. The footnotes and formatting will be preserved when saved. To keep them, leave the imported Content field unchanged; editing that text switches the post to plain text.';
      docxStatus.dataset.kind = 'success';
    }catch(err){
      richField.value = '';
      docxStatus.textContent = err?.message || 'Could not import this Word document.';
      docxStatus.dataset.kind = 'error';
    }
  });

  contentField?.addEventListener('input', () => {
    if(richField.value && contentField.value !== contentSnapshot){
      richField.value = '';
      docxStatus.textContent = 'The Content field was edited manually. Saving will use plain text and will not retain Word formatting or clickable footnotes. Upload the original .docx again to preserve them.';
      docxStatus.dataset.kind = 'error';
    }
  });

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const f = new FormData(form);
    statusEl.textContent = 'Saving…';
    statusEl.dataset.kind = '';
    try{
      await sessionState();
      if(!['admin','editor'].includes(window.TIA_DB.profile?.role)) throw new Error('Editorial access required.');
      let cover_url = null;
      const id = f.get('id');
      const old = currentPosts().find(p=>p.id===id);
      if(old?.cover_url) cover_url = old.cover_url;
      const file = f.get('cover');
      if(file && file.size){
        if(file.size>8*1024*1024) throw new Error('Cover images must be 8MB or smaller.');
        const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
        const path='posts/'+Date.now()+'-'+slugify(f.get('title'))+'.'+ext;
        const up=await supabase.storage.from('journal-media').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
        if(up.error) throw up.error;
        cover_url=supabase.storage.from('journal-media').getPublicUrl(path).data.publicUrl;
      }
      const title=String(f.get('title')||'').trim();
      const slug=id?old?.slug:slugify(title);
      const richContent=String(f.get('richContent')||'').trim();
      const plainContent=String(f.get('content')||'');
      const payload={
        title,slug,excerpt:String(f.get('excerpt')||'').trim(),
        content:richContent || plainContent,
        category:f.get('category'),status:f.get('status'),cover_url,
        published_at:f.get('status')==='published'?(old?.status==='published'?old.date:new Date().toISOString()):null,
        updated_at:new Date().toISOString(),author_id:window.TIA_DB.user.id
      };
      let result;
      if(id) result=await supabase.from('posts').update(payload).eq('id',id);
      else result=await supabase.from('posts').insert(payload);
      if(result.error) throw result.error;
      await loadPosts();
      statusEl.textContent = 'Saved successfully.';
      statusEl.dataset.kind = 'success';
      setTimeout(()=>location.hash='admin',500);
    }catch(err){
      statusEl.textContent=err?.message||'Unable to save post.';
      statusEl.dataset.kind='error';
    }
  });
}

const originalPrivacy=window.privacy, originalTerms=window.terms;
if(typeof originalPrivacy!=='function'){window.privacy=()=>'<main class="wrap page"><div class="title"><div class="eyebrow">LEGAL</div><h1>Privacy</h1></div><article class="panel article-text"><p>We collect information you voluntarily provide through subscriptions and submissions. Production data is stored in Supabase and accessed by authorized editorial staff.</p></article></main>';}
if(typeof originalTerms!=='function'){window.terms=()=>'<main class="wrap page"><div class="title"><div class="eyebrow">LEGAL</div><h1>Terms of Use</h1></div><article class="panel article-text"><p>Content published by The Inherited Amnesia is intended for reading, discussion and research. Final editorial and copyright terms should be added before public launch.</p></article></main>';}


let renderSerial = 0;
function updateNavigation(route){
  document.querySelectorAll('.navlinks a[data-route]').forEach(a => {
    if(a.dataset.route === route) a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  });
  document.getElementById('siteNav')?.classList.remove('open');
  document.getElementById('menuToggle')?.setAttribute('aria-expanded','false');
}
function bindArchiveControls(){
  const controls = [
    [document.getElementById('cat2'),'change'],
    [document.getElementById('year2'),'change'],
    [document.getElementById('sort2'),'change'],
    [document.getElementById('q2'),'input'],
    [document.getElementById('search2'),'click']
  ];
  controls.forEach(([node,eventName])=>{
    if(node && !node.dataset.bound){ node.addEventListener(eventName,window.drawArchive); node.dataset.bound='1'; }
  });
}
function showFatal(err){
  console.error('The Inherited Amnesia:',err);
  const app=document.getElementById('app');
  if(app) app.innerHTML='<main class="wrap page"><div class="eyebrow">TEMPORARY ERROR</div><h1 class="page-title">The page could not be loaded.</h1><p>Please refresh the page. If the problem continues, contact the site administrator.</p><button class="btn alt" id="reloadPage">Reload page</button></main>';
  document.getElementById('reloadPage')?.addEventListener('click',()=>location.reload());
}
document.getElementById('menuToggle')?.addEventListener('click',()=>{
  const nav=document.getElementById('siteNav'),button=document.getElementById('menuToggle');
  const open=!nav.classList.contains('open');nav.classList.toggle('open',open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Close navigation':'Open navigation');
});
document.getElementById('headerSearch')?.addEventListener('click',()=>{
  if(location.hash!=='#archive') location.hash='#archive';
  setTimeout(()=>document.getElementById('q2')?.focus(),150);
});
document.getElementById('footerNewsletter')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const f=new FormData(e.target),status=document.getElementById('footerNewsletterStatus');
  const email=String(f.get('email')||'').trim().toLowerCase();
  status.textContent='Subscribing…';status.dataset.kind='';
  const {error}=await supabase.from('subscribers').upsert({email,status:'active'},{onConflict:'email',ignoreDuplicates:true});
  if(error){status.textContent='Could not subscribe just now. Please try again.';status.dataset.kind='error';return;}
  e.target.reset();status.textContent='You are subscribed. Thank you.';status.dataset.kind='success';
});
window.addEventListener('hashchange',()=>{
  window.render();
  const serial=++renderSerial;
  (async()=>{
    try{
      await sessionState();
      await loadPosts();
      if(serial===renderSerial) window.render();
    }catch(err){console.error(err);}
  })();
});
(async function init(){
  window.render();
  const serial=++renderSerial;
  try{
    await sessionState();
    await loadPosts();
    if(serial===renderSerial) window.render();
  }catch(err){
    window.TIA_DB.error=err?.message||'Database connection unavailable';
    showFatal(err);
  }
})();
window.privacy=()=>'<main class="wrap page"><div class="eyebrow">INFORMATION</div><h1 class="page-title">Privacy</h1><p class="lede">We use details provided through subscriptions and submissions to operate the journal and respond to contributors. Access to submissions and subscriber records is limited to authorized editorial users.</p></main>';
window.terms=()=>'<main class="wrap page"><div class="eyebrow">INFORMATION</div><h1 class="page-title">Terms of use</h1><p class="lede">Content published by The Inherited Amnesia is offered for reading, discussion and research. Contributors are responsible for originality and accuracy. Publication is subject to editorial review.</p></main>';
