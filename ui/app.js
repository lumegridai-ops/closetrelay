/* ClosetRelay: one local operator, actual server state, no simulated provider results. */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {data:null, appointmentId:null, itemId:null, filter:'all', search:'', busy:false, dialog:null, packKeys:new Map(), packHoldId:null, packDraft:'', packError:null, preview:null, previewTimer:null};

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || body?.message || `The server returned ${status}.`);
    this.status = status;
    this.body = body;
  }
}

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(path, {method, headers:body === undefined ? {} : {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body), cache:'no-store'});
  } catch (error) {
    throw new ApiError(0, {error:{code:'connection_failed',message:'The local workspace is not responding. Check that the server is running, then refresh.'}});
  }
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(response.status, {error:{code:'unexpected_response',message:'The server did not return a readable response.'}, response:text.slice(0,1000)}); }
  if (!response.ok) throw new ApiError(response.status, result);
  return result;
}

const appointment = () => state.data?.appointments.find(a => a.id === state.appointmentId);
const selectedItem = () => state.data?.items.find(i => i.id === state.itemId);
const itemById = id => state.data?.items.find(i => i.id === id);
const currentHold = a => (a?.active_holds || []).find(h => h.state === 'active');
const isPacked = a => (a?.handoffs || []).length > 0;
const providerReady = () => !!(state.data?.provider?.configured && state.data?.provider?.enabled);
const validApproval = a => a?.approval?.state === 'active' && itemById(a.approval.item_id)?.version === a.approval.item_version;
const readable = value => String(value || '').replaceAll('_', ' ');
function itemStatus(item) {
  if (item.state === 'held') return item.owner === state.appointmentId ? 'Held here' : 'Held elsewhere';
  return {available:'Available',packed:'Packed',unavailable:'Unavailable'}[item.state] || readable(item.state);
}
function appointmentStatus(a) {
  if (isPacked(a)) return {label:'Packed',type:'packed',short:'Handoff recorded'};
  if (currentHold(a)) return {label:'On hold',type:'held',short:'Ready to pack'};
  if (validApproval(a)) return {label:'Approved',type:'ready',short:'Ready for a hold'};
  if (a?.approval && a.approval.state !== 'active') return {label:'Review needed',type:'needs_review',short:'Choose again'};
  return {label:'Ready to choose',type:'available',short:'No item held'};
}

function announce(text) { $('#announcer').textContent = ''; requestAnimationFrame(() => { $('#announcer').textContent = text; }); }
function notice(title, text, error = null) {
  const box = $('#message');
  box.hidden = false;
  box.className = `message${error ? ' error' : ''}`;
  box.setAttribute('role', error ? 'alert' : 'status');
  box.innerHTML = `<div class="message-top"><div><strong>${esc(title)}</strong><p>${esc(text)}</p></div><button class="icon-button" aria-label="Dismiss message" data-action="dismiss">×</button></div>${error ? `<details><summary>Response details</summary><pre>${esc(JSON.stringify({http_status:error.status,...error.body},null,2))}</pre></details>` : ''}`;
  announce(`${title}. ${text}`);
}

async function loadState({quiet = false} = {}) {
  const next = await api('/api/state');
  if (!Array.isArray(next.items) || !Array.isArray(next.appointments)) throw new ApiError(200,{error:{code:'unexpected_state',message:'The workspace response is missing its item or appointment records.'}});
  state.data = next;
  state.preview = null;
  if (!next.appointments.some(a => a.id === state.appointmentId)) state.appointmentId = next.appointments[0]?.id || null;
  const a = appointment();
  if (!next.items.some(i => i.id === state.itemId)) state.itemId = a?.approval?.item_id || next.items.find(i => i.state === 'available')?.id || next.items[0]?.id || null;
  $('#loading').hidden = true;
  $('#app').hidden = false;
  render();
  schedulePreviewRead();
  if (!quiet) announce('Workspace refreshed from saved records.');
}

async function mutate(path, method, body, success, {dialog = false, packing = false} = {}) {
  if (state.busy) return null;
  state.busy = true;
  let failed = false;
  $('#choice-panel').setAttribute('aria-busy','true');
  $$('button[type="submit"], [data-action="approve"], [data-action="hold"], [data-action="release"]').forEach(b => { b.disabled = true; });
  try {
    const result = await api(path,method,body);
    if (packing) { state.packDraft=''; state.packError=null; }
    if (dialog) $('#form-dialog').close();
    await loadState({quiet:true});
    if (success) notice(success.title, typeof success.text === 'function' ? success.text(result) : success.text);
    return result;
  } catch (error) {
    failed = true;
    if (dialog && $('#form-dialog').open) {
      $('#dialog-error').hidden = false;
      $('#dialog-error').textContent = error.message;
      $('#dialog-error').focus();
    }
    if (packing) state.packError = error.message;
    try { await loadState({quiet:true}); } catch { /* Preserve the original mutation failure. */ }
    // A stale hold may remove the form during refresh. In that case name the actual failure.
    notice(error.status === 409 ? 'The change was stopped.' : 'This action did not finish.', packing && state.packError ? 'Review the item ID in the packing form. The saved record has been refreshed.' : error.message, error);
    return null;
  } finally {
    state.busy = false;
    $('#choice-panel').setAttribute('aria-busy','false');
    $('#dialog-submit').disabled = false;
    if (state.data) {
      renderPanel();
      if (!$('#form-dialog').open) {
        const next = $('#scan-id') || $('[data-action="hold"]:not([disabled])') || $('[data-action="approve"]:not([disabled])') || $('[data-action="manifest"]') || $('#choice-heading');
        if (next) { if (next.tagName === 'H2') next.tabIndex = -1; next.focus({preventScroll:true}); if (packing && failed) next.scrollIntoView({block:'center',behavior:'instant'}); }
      }
    }
  }
}

function safeImage(ref) {
  return typeof ref === 'string' && /^\/media\/[A-Za-z0-9_-]+$/.test(ref) ? ref : null;
}

function garment(item, small = false) {
  // A deliberately schematic drawing, never presented as a garment photograph or generated try-on.
  const palettes = [['#394b60','#243449','#e7e8e2'],['#555956','#343a37','#e5e7e1'],['#777d52','#505736','#e7eadc'],['#824754','#582c3a','#eee2df'],['#70818c','#445760','#e4e8e7'],['#8e846a','#665d49','#e9e6da']];
  const colorWord = String(item.label).toLowerCase();
  const index = colorWord.includes('navy') ? 0 : colorWord.includes('charcoal') ? 1 : colorWord.includes('olive') ? 2 : colorWord.includes('burgundy') ? 3 : 5;
  const [base,dark,back] = palettes[index];
  return `<svg viewBox="0 0 180 180" aria-hidden="true" focusable="false"><path d="M79 18c0-9 15-11 17-2 2 7-6 8-6 12v6" fill="none" stroke="#aca78f" stroke-width="2"/><path d="M90 33 50 55h80Z" fill="none" stroke="#aca78f" stroke-width="2"/><path d="m61 45-20 15-20 69 23 8 18-47-3 68h62l-3-68 18 47 23-8-20-69-20-15-15-5H76Z" fill="${base}" stroke="${dark}" stroke-width="1.3"/><path d="M76 40 69 59l18 17-9 15 12 13V60Z" fill="${dark}"/><path d="m104 40 7 19-18 17 9 15-12 13V60Z" fill="${dark}" opacity=".83"/><path d="m78 40 12 20 12-20" fill="${back}"/><path d="M90 99v59M62 90l-2 22m58-22 2 22" stroke="${dark}" stroke-width="1.2" fill="none"/><path d="M67 122h15m17 0h15" stroke="${dark}" stroke-width="3"/><path d="M65 126h17v11H65m33-11h17v11H98" stroke="${dark}" fill="none" stroke-width=".8" opacity=".75"/><circle cx="94" cy="107" r="1.6" fill="${dark}"/><circle cx="94" cy="119" r="1.6" fill="${dark}"/></svg>`;
}

function render() {
  const focusedAppointment = document.activeElement?.dataset?.appointment;
  const a = appointment();
  const status = appointmentStatus(a);
  $('#sample-banner').hidden = !(state.data.scope?.demo_catalog || state.data.items.some(i => i.is_demo) || state.data.appointments.some(i => i.is_demo));
  $('#appointment-kicker').textContent = a ? `${a.is_demo ? 'FICTIONAL APPOINTMENT' : 'CURRENT APPOINTMENT'} · ${a.id}` : 'LOCAL WORKSPACE';
  $('#appointment-name').textContent = a ? (a.is_demo ? a.name.replace(/^Fictional\s+/i,'').replace(/^appointment/i,'Appointment') : a.name) : 'A choice worth keeping.';
  $('#appointment-subtitle').textContent = a ? 'Their choice. The exact garment. A thoughtful handoff.' : 'Add an appointment to begin recording an item choice.';
  $('#appointment-status').className = `status ${status.type}`;
  $('#appointment-status').textContent = a ? status.label : 'No appointment';
  $('#appointments').innerHTML = state.data.appointments.map(p => {
    const s = appointmentStatus(p);
    const displayName = p.is_demo ? p.name.replace(/^Fictional\s+/i,'') : p.name;
    const initials = p.is_demo ? displayName.split(/\s+/).at(-1) : p.name.split(/\s+/).slice(0,2).map(s => s[0] || '').join('');
    return `<button class="appointment-button${p.id === state.appointmentId ? ' selected' : ''}" data-appointment="${esc(p.id)}" aria-label="${esc(p.name)} · ${esc(s.short)}" aria-current="${p.id === state.appointmentId ? 'true':'false'}"><span class="appointment-avatar" aria-hidden="true">${esc(initials)}</span><span class="appointment-meta"><strong>${esc(displayName)}</strong><small>${esc(s.short)}${p.is_demo ? ' · Fictional' : ''}</small></span><span class="appointment-arrow" aria-hidden="true">›</span></button>`;
  }).join('') || '<p class="muted">No appointments yet.</p>';
  const packed = isPacked(a), held = !!currentHold(a), approved = validApproval(a) || packed;
  const steps = [{name:'Client choice',note:approved ? 'Approval recorded' : 'Review together',done:approved,current:!approved},{name:'Staff hold',note:held ? 'Reserved here' : packed ? 'Hold fulfilled' : 'Reserve one item',done:held || packed,current:approved && !held && !packed},{name:'Exact-item packing',note:packed ? 'Handoff recorded' : 'Confirm the tag',done:packed,current:held}];
  $('#progress').innerHTML = steps.map((s,i) => `<li class="${s.done?'complete':s.current?'current':''}" ${s.current?'aria-current="step"':''}><span class="step-dot" aria-hidden="true">${s.done?'✓':i+1}</span><span class="step-label">${s.name}<small>${s.note}</small></span></li>`).join('');
  renderItems();
  renderPanel();
  renderActivity();
  $('#connection-status').textContent = 'Connected locally · saved records';
  $('#manifest').disabled = !a;
  if (focusedAppointment) $$('[data-appointment]').find(b => b.dataset.appointment === focusedAppointment)?.focus({preventScroll:true});
}

function renderItems() {
  const focusedItem = document.activeElement?.dataset?.item;
  const term = state.search.trim().toLocaleLowerCase();
  const items = state.data.items.filter(i => (state.filter === 'all' || i.state === state.filter) && (!term || [i.id,i.label,i.location,i.condition].some(v=>String(v).toLocaleLowerCase().includes(term))));
  $('#rack-count').textContent = `${items.length} ${items.length === 1?'item':'items'}`;
  $$('[data-filter]').forEach(b => { const on = b.dataset.filter === state.filter; b.classList.toggle('active',on); b.setAttribute('aria-pressed',String(on)); });
  $('#items').innerHTML = items.map(item => {
    const photo = safeImage(item.photo_ref);
    return `<button class="item-card${item.id === state.itemId?' selected':''}" data-item="${esc(item.id)}" aria-pressed="${item.id === state.itemId}" aria-label="View ${esc(item.label)}, ${esc(item.id)}, ${esc(itemStatus(item))}"><div class="item-visual">${photo ? `<img src="${esc(photo)}" alt="${esc(item.label)} · ${item.is_demo?'fictional test image':'uploaded item image'}" loading="lazy">` : garment(item)}<span class="visual-label">${item.is_demo?(photo?'FICTIONAL · TEST IMAGE':'FICTIONAL · ILLUSTRATION'):photo?'UPLOADED ITEM IMAGE':'NO ITEM PHOTO · ILLUSTRATION'}</span><span class="selected-check" aria-hidden="true">✓</span></div><div class="item-info"><div class="item-topline"><span class="item-id">${esc(item.id)}</span><span class="status ${esc(item.state)}">${esc(itemStatus(item))}</span></div><h3>${esc(item.label)}</h3><p>${esc(item.condition)}</p><div class="item-bottom"><span>${esc(item.location)}</span><span>Version ${esc(item.version)}</span></div></div></button>`;
  }).join('') || `<div class="empty-rack"><strong>${state.data.items.length?'No matching items.':'The rack is ready for its first item.'}</strong><p>${state.data.items.length?'Try another name, item ID or location. Your selection has not changed.':'Add an item with its condition and storage location.'}</p>${state.data.items.length?'<button class="button" data-action="reset-search">Show all items</button>':''}</div>`;
  if (focusedItem) $$('[data-item]').find(b => b.dataset.item === focusedItem)?.focus({preventScroll:true});
}

function renderPanel() {
  const item = selectedItem(), a = appointment();
  const panel = $('#choice-panel');
  if (!item || !a) {
    panel.innerHTML = '<div class="panel-heading"><span class="eyebrow">THE NEXT STEP</span><h2 id="choice-heading">Make room for a choice.</h2></div><div class="panel-body"><p>Add an appointment and an item to start the handoff.</p></div>';
    $('#mobile-selection').hidden=true;
    return;
  }
  const approval = a.approval, hold = currentHold(a), packed = isPacked(a);
  const chosenHere = approval?.item_id === item.id;
  const current = chosenHere && validApproval(a);
  const blocked = item.state !== 'available' && !(item.state === 'held' && item.owner === a.id);
  const heldHere = hold?.item_id === item.id;
  if (state.packHoldId !== hold?.id) { state.packHoldId=hold?.id || null; state.packDraft=''; state.packError=null; }
  $('#mobile-selection').hidden=false;
  $('#mobile-item-name').textContent=item.label;
  let approvalBlock = '', actionBlock = '';
  if (packed) {
    const handoff = a.handoffs[0];
    approvalBlock = `<div class="approval-state"><strong>Handoff recorded</strong><p>${esc(handoff.item_id)} was confirmed for this appointment. No shipment or delivery is implied.</p></div>`;
    actionBlock = '<button class="button button-primary full-width" data-action="manifest">View packing record <span aria-hidden="true">↗</span></button>';
  } else if (chosenHere && approval && !current) {
    const changed = approval.item_version !== item.version;
    approvalBlock = `<div class="approval-state warning"><strong>${changed?'This item changed. Review it again.':'This choice needs a fresh approval.'}</strong><p>${changed?`The approval covered version ${esc(approval.item_version)}. This is version ${esc(item.version)}.`:esc(String(a.unresolved_reason || `The earlier approval is ${readable(approval.state)}`).replace(/[.\s]+$/,'')+'.')} No old approval will reserve or pack it.</p></div>`;
  } else if (current) {
    approvalBlock = `<div class="approval-state"><strong>${heldHere?'The approved item is held here.':'Approval recorded. No hold yet.'}</strong><p>Approval matches ${esc(item.id)}, version ${esc(item.version)}.</p></div>`;
  } else if (hold) {
    approvalBlock = `<div class="approval-state warning"><strong>Another item is held for this appointment.</strong><p>${esc(hold.item_id)} remains held. Recording a different choice will release that hold.</p><button class="button button-quiet" data-action="view-current">View current item</button></div>`;
  } else if (approval) {
    approvalBlock = `<div class="approval-state"><strong>Currently viewing a different item.</strong><p>The earlier choice is ${esc(approval.item_id)}. A new approval replaces it.</p></div>`;
  }
  if (!packed && heldHere && current) {
    actionBlock = `<form id="pack-form" class="pack-form"><label for="scan-id">Scan or type the item ID</label><input id="scan-id" name="item_id" value="${esc(state.packDraft)}" autocomplete="off" spellcheck="false" placeholder="Exact ID on the garment" required aria-invalid="${!!state.packError}" aria-describedby="scan-help${state.packError?' pack-error':''}"><p class="compact-note" id="scan-help">Expected: <strong>${esc(item.id)}</strong>. Check the garment tag before packing.</p>${state.packError?`<div id="pack-error" class="field-error" role="alert"><strong>The item wasn’t packed.</strong><span>${esc(state.packError)}</span><p>Check the tag and enter the approved item ID to try again.</p></div>`:''}<button type="submit" class="button button-primary full-width">Confirm exact item & pack <span aria-hidden="true">→</span></button></form><div class="panel-actions"><button class="button button-quiet" data-action="release">Release this hold</button></div>`;
  } else if (!packed && current) {
    actionBlock = `<button class="button button-primary full-width" data-action="hold" ${blocked?'disabled':''}>Place an exclusive hold <span aria-hidden="true">→</span></button><p class="action-note">${blocked?'This item is no longer available. Choose another item; no substitute is selected for you.':'This reserves this exact item for this appointment.'}</p>`;
  } else if (!packed) {
    actionBlock = `<button class="button button-primary full-width" data-action="approve" ${blocked?'disabled':''}>${approval?'Record a new approval':'Record client approval'} <span aria-hidden="true">→</span></button><p class="action-note">${blocked?'This item cannot be approved while it is held elsewhere, unavailable or packed.':a.is_demo?'Practice approval for this fictional appointment. No actual client consent is claimed.':'Record this only after the client agrees to the item and its current condition.'}</p>`;
  }
  const photo = safeImage(item.photo_ref);
  panel.innerHTML = `<div class="panel-heading"><div class="panel-role"><span class="eyebrow">${packed?'HANDOFF COMPLETE':heldHere?'STAFF · PACKING':current?'STAFF · INVENTORY HOLD':'CLIENT · ITEM CHOICE'}</span><span class="panel-role-number">${packed?'✓':heldHere?'03 / 03':current?'02 / 03':'01 / 03'}</span></div><h2 id="choice-heading">${packed?'The right item, packed.':heldHere?'Ready for the handoff.':current?'Keep this choice safe.':'A considered choice.'}</h2></div><div class="panel-body"><div class="chosen-item"><div class="chosen-thumb">${photo?`<img src="${esc(photo)}" alt="${esc(item.label)} · uploaded item image">`:garment(item,true)}</div><div><h3>${esc(item.label)}</h3><p>${esc(item.id)}${item.is_demo?' · Fictional item':''}</p></div></div><dl class="detail-list"><dt>Location</dt><dd>${esc(item.location)}</dd><dt>Item state</dt><dd>${esc(itemStatus(item))}</dd><dt>Version</dt><dd>${esc(item.version)}${chosenHere && approval?` · approved version ${esc(approval.item_version)}`:''}</dd></dl><div class="condition-note"><strong>Condition recorded by staff</strong>${esc(item.condition)}</div>${approvalBlock}${actionBlock}<div class="panel-actions"><button class="button button-quiet" data-action="edit-item" ${item.state==='packed'?'disabled':''}>Update item details</button></div>${approval?`<details class="inspect-details"><summary>Inspect the approval record</summary><code>Approval: ${esc(approval.id)}</code><code>Item: ${esc(approval.item_id)} · Version: ${esc(approval.item_version)}</code><code>State: ${esc(approval.state)}</code>${hold?`<code>Hold: ${esc(hold.id)}</code>`:''}</details>`:''}</div>${renderPreview(a)}`;
}

function renderPreview(a) {
  const ready = providerReady(), provider = state.data.provider || {};
  const p = state.preview?.appointment_id === a.id ? state.preview : (a.previews || [])[0] || null;
  const result = p?.displayable && p.status === 'succeeded' && safeImage(p.result_url);
  const viewingApproved = validApproval(a) && state.itemId === a.approval.item_id;
  const usable = result && viewingApproved && p.item_id === a.approval.item_id && p.choice_revision === a.choice_revision && p.item_version === itemById(a.approval.item_id)?.version && a.consent;
  return `<section class="preview-section" aria-label="Optional appearance preview"><div class="preview-heading"><h3>An optional second look.</h3><span class="optional-tag">YouCam</span></div><p>Explore appearance with a consented photo, or continue without one. A preview cannot verify fit or condition.</p>${usable?`<figure style="margin:0"><img class="preview-image" src="${esc(result)}" alt="YouCam appearance illustration for the currently approved item"><figcaption class="compact-note">YouCam appearance illustration${a.is_demo?' using fictional test material':''}. Not proof of fit, measurements or condition.</figcaption></figure>`:''}<button class="button full-width" data-action="preview" ${!ready || !viewingApproved?'disabled':''}>${!ready?'YouCam preview unavailable':!viewingApproved?'Approve this item before previewing':a.consent?'Request a YouCam preview':'Choose a photo for YouCam'}</button><div class="panel-actions"><button class="button button-quiet" data-action="configure-provider">${ready?'Change YouCam key':'Connect YouCam'}</button>${ready?'<button class="button button-quiet" data-action="clear-provider">Clear key</button>':''}</div>${a.consent?'<button class="button button-quiet full-width" data-action="revoke-consent" style="margin-top:7px">Withdraw photo consent</button>':''}${p?`<p><strong>Preview for ${esc(p.item_id)}:</strong> ${esc(readable(p.status))}${p.reason?` · ${esc(p.reason)}`:''}</p>${['pending','processing','queued','running'].includes(p.status)?`<button class="button full-width" data-action="refresh-preview" data-preview-id="${esc(p.id)}">Check provider result</button>`:''}<details class="inspect-details"><summary>Inspect actual provider evidence</summary><code>Task record: ${esc(p.id)}</code><code>Provider task: ${esc(p.provider?.task_id || 'Not created')}</code><code>Provider status: ${esc(p.provider?.status || 'Not available')}</code>${p.provider?.error?`<code>${esc(JSON.stringify(p.provider.error))}</code>`:''}<code>Result displayable: ${p.displayable?'yes':'no'}</code></details>`:''}<details class="preview-details"><summary>${ready?'Before sending a personal photo':'Why is the preview unavailable?'}</summary><p>${ready?'A key is configured in server memory. This does not verify API access, credits or a successful preview. A consented adult photo and the garment photograph are sent to YouCam only when requested. Results illustrate appearance and cannot establish fit, fabric feel or garment condition.':esc(provider.reason || 'No active YouCam provider is available. No preview was generated or replaced with a sample result.')}</p><p>You can complete the approval, hold and packing steps without a preview.</p><p><a href="https://www.perfectcorp.com/perfectbeauty/youcam/privacy-policy-api" target="_blank" rel="noopener noreferrer">YouCam API privacy policy ↗</a>. Withdrawing here clears local access; it does not promise immediate deletion at the provider.</p></details></section>`;
}

function schedulePreviewRead() {
  clearTimeout(state.previewTimer);
  const a = appointment();
  const p = state.preview?.appointment_id === a?.id ? state.preview : a?.previews?.[0];
  if (!p || p.status !== 'pending' || !providerReady()) return;
  state.previewTimer = setTimeout(async()=>{
    if (state.busy || $('#form-dialog').open || document.hidden) { schedulePreviewRead(); return; }
    try {
      const next = await api(`/api/previews/${encodeURIComponent(p.id)}`);
      if (state.appointmentId !== a.id) return;
      state.preview = next;
      const old = $('.preview-section');
      if (old) old.outerHTML = renderPreview(appointment());
      if (next.status !== p.status) announce(`Preview status: ${readable(next.status)}.`);
    } catch (error) {
      // A read failure never creates another provider task or changes stock.
      announce('Could not refresh the preview status. Use Refresh to try again.');
    }
    schedulePreviewRead();
  },2000);
}

const auditCopy = {
  client_approved:['Choice recorded','The exact item and version were approved.'],
  item_held:['Exclusive hold placed','This item is reserved for the appointment.'],
  hold_released:['Hold released','The item is available again; the old approval cannot reclaim it.'],
  item_changed:['Item details changed','Affected approvals and holds require a fresh review.'],
  item_packed:['Exact item confirmed','A packing handoff was recorded.'],
  packed:['Exact item confirmed','A packing handoff was recorded.'],
  handoff_recorded:['Exact item confirmed','A packing handoff was recorded.'],
  consent_granted:['Photo consent recorded','Personal-photo processing was enabled for this appointment.'],
  consent_revoked:['Photo consent withdrawn','Local preview access was revoked.'],
  preview_requested:['Preview requested','A preview request was recorded.'],
  preview_completed:['Preview response recorded','Inspect the record for its current status.'],
};

function renderActivity() {
  const a = appointment();
  const events = state.data.audit || [];
  const list = (Array.isArray(events)?events:events.events || []).filter(e => e.target === a?.id || e.target === a?.approval?.item_id || e.target === state.itemId).sort((x,y) => y.sequence-x.sequence).slice(0,20);
  $('#activity-list').innerHTML = list.map(e => {
    let payload = e.payload; try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { /* Keep original evidence string. */ }
    const [title,description] = auditCopy[e.kind] || [readable(e.kind),'A saved workspace action.'];
    return `<div class="activity-row"><span class="activity-dot" aria-hidden="true">${e.kind.includes('change')?'↻':'✓'}</span><div class="activity-content"><strong>${esc(title)}</strong><small>${esc(payload?.item_id || e.target)} · ${esc(description)}</small><details><summary>Inspect saved evidence</summary><pre>${esc(JSON.stringify({sequence:e.sequence,kind:e.kind,target:e.target,payload},null,2))}</pre></details></div><span class="activity-index">#${esc(e.sequence)}</span></div>`;
  }).join('') || '<p class="activity-empty">No actions recorded for this appointment yet. Its choice and handoff will appear here.</p>';
}

function openDialog(type) {
  const item = selectedItem();
  state.dialog = {type,item:item ? {...item}:null};
  const fields = $('#dialog-fields');
  $('#dialog-error').hidden = true;
  $('#dialog-submit').disabled = false;
  $('#dialog-kicker').textContent = type === 'consent' ? 'OPTIONAL PERSONAL PHOTO' : 'LOCAL OPERATOR WORKSPACE';
  if (type === 'provider') {
    $('#dialog-title').textContent = 'Connect your YouCam key.';
    $('#dialog-description').textContent = 'The key stays in this server process only. It is not saved to the database, browser storage, URLs or logs. Configuring a key does not verify credits or successful API access.';
    fields.innerHTML = '<div class="field"><label for="provider-key">YouCam API key</label><input id="provider-key" name="api_key" type="password" required autocomplete="off" spellcheck="false" maxlength="4096"><small>Use a key you are authorized to use. Restarting the server or clearing the key removes this connection.</small></div>';
    $('#dialog-submit').textContent = 'Use key for this session';
  } else if (type === 'appointment') {
    $('#dialog-title').textContent = 'A new appointment.';
    $('#dialog-description').textContent = 'Use an appointment name or reference. This creates a record in this local workspace; it does not invite or message anyone.';
    fields.innerHTML = '<div class="field"><label for="new-name">Appointment name or reference</label><input id="new-name" name="name" required maxlength="100" autocomplete="off" placeholder="e.g. Appointment 014"></div>';
    $('#dialog-submit').textContent = 'Create appointment';
  } else if (type === 'item') {
    $('#dialog-title').textContent = 'Put an item on the rack.';
    $('#dialog-description').textContent = 'Record one actual garment. Its unique ID is used again at packing.';
    fields.innerHTML = '<div class="field"><label for="new-id">Unique item ID</label><input id="new-id" name="id" required maxlength="80" autocomplete="off" placeholder="e.g. JKT-014"></div><div class="field"><label for="new-label">Item name</label><input id="new-label" name="label" required maxlength="200" placeholder="e.g. Navy single-button jacket"></div><div class="field"><label for="new-location">Storage location</label><input id="new-location" name="location" required maxlength="200" placeholder="e.g. Rail 2 · position 6"></div><div class="field"><label for="new-condition">Condition and garment details</label><textarea id="new-condition" name="condition" required maxlength="2000" placeholder="Record the label size, measured details if known, and any wear."></textarea></div>';
    $('#dialog-submit').textContent = 'Add item';
  } else if (type === 'edit') {
    $('#dialog-title').textContent = 'Keep the item honest.';
    $('#dialog-description').textContent = `Updating ${item.id} creates a new version and invalidates its current approvals and holds. Review with the client again before reserving or packing.`;
    fields.innerHTML = `<div class="field"><label for="edit-condition">Condition and garment details</label><textarea id="edit-condition" name="condition" required maxlength="2000">${esc(item.condition)}</textarea></div><div class="field"><label for="edit-photo">Replace the garment photograph (optional)</label><input id="edit-photo" name="photo" type="file" accept="image/jpeg,image/png"><small>Upload one real garment photograph. No sample photo will be invented.</small></div><div class="field"><label class="checkbox-label"><input name="unavailable" type="checkbox" ${item.state==='unavailable'?'checked':''}><span>Mark this item unavailable.<br>Leave unchecked to make it available for a fresh choice.</span></label></div>`;
    $('#dialog-submit').textContent = 'Save & require fresh approval';
  } else if (type === 'consent') {
    $('#dialog-title').textContent = 'A photo is your choice.';
    $('#dialog-description').textContent = 'YouCam receives the personal photo and the garment photo to create an appearance illustration. It cannot verify fit or condition. Selection works without this step.';
    fields.innerHTML = '<div class="field"><label for="source-photo">Consented adult photograph</label><input id="source-photo" name="photo" type="file" accept="image/jpeg,image/png" required><small><a href="https://docs.perfectcorp.com/reference/ai_clothes/section/overview" target="_blank" rel="noopener noreferrer">Review the current YouCam image requirements ↗</a></small></div><div class="field"><label class="checkbox-label"><input name="consent" type="checkbox" required><span>I have permission to send this adult\'s image to YouCam for this preview, and have explained the <a href="https://www.perfectcorp.com/perfectbeauty/youcam/privacy-policy-api" target="_blank" rel="noopener noreferrer">provider privacy policy</a>. This does not grant permission to publish the image.</span></label></div>';
    $('#dialog-submit').textContent = 'Save consented photo';
  }
  $('#form-dialog').showModal();
  requestAnimationFrame(() => $('#dialog-fields input:not([type="checkbox"]), #dialog-fields textarea')?.focus());
}

async function upload(file,purpose) {
  if (!file || !file.size) return null;
  if (!['image/jpeg','image/png'].includes(file.type)) throw new ApiError(400,{error:{code:'image_type',message:'Choose a JPEG or PNG image.'}});
  if (file.size > 8*1024*1024) throw new ApiError(400,{error:{code:'image_size',message:'Choose an image smaller than 8 MB.'}});
  const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
  return api('/api/uploads','POST',{purpose,mime_type:file.type,data_base64:data,...(purpose==='source'?{appointment_id:state.appointmentId}:{})});
}

async function submitDialog(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = new FormData(event.target), d = state.dialog;
  if (d.type === 'provider') {
    const key = form.get('api_key').trim();
    $('#provider-key').value = '';
    await mutate('/api/provider/configure','POST',{api_key:key},{title:'YouCam key configured in memory.',text:'API access is not verified yet. A successful real preview is still required.'},{dialog:true});
  } else if (d.type === 'appointment') {
    const r = await mutate('/api/appointments','POST',{name:form.get('name').trim()},{title:'Appointment created.',text:'The new appointment is saved in this local workspace.'},{dialog:true});
    if (r?.id) { state.appointmentId = r.id; state.itemId = state.data.items.find(i => i.state==='available')?.id || state.data.items[0]?.id; render(); }
  } else if (d.type === 'item') {
    const r = await mutate('/api/items','POST',Object.fromEntries(['id','label','location','condition'].map(k=>[k,form.get(k).trim()])),{title:'Item added.',text:'Its record is now available for review. Add a real photograph from “Update item details” if needed.'},{dialog:true});
    if (r?.id) { state.itemId = r.id; state.filter = 'all'; render(); }
  } else if (d.type === 'edit' || d.type === 'consent') {
    $('#dialog-submit').disabled = true;
    try {
      const file = form.get('photo');
      const image = file?.size ? await upload(file,d.type==='edit'?'garment':'source') : null;
      if (d.type === 'edit') {
        await mutate(`/api/items/${encodeURIComponent(d.item.id)}`,'PATCH',{expected_version:d.item.version,condition:form.get('condition').trim(),unavailable:form.has('unavailable'),...(image?{photo_id:image.id}:{})},{title:'Item details updated.',text:'Previous approvals and holds are invalidated. Review the current item before recording a new choice.'},{dialog:true});
      } else {
        if (!image) throw new ApiError(400,{error:{code:'source_required',message:'Choose a permitted personal photo.'}});
        await mutate(`/api/appointments/${encodeURIComponent(state.appointmentId)}/consent`,'POST',{source_id:image.id,consent:true},{title:'Photo consent recorded.',text:'No preview has been generated yet. Request it when the approved garment is ready.'},{dialog:true});
      }
    } catch (error) { $('#dialog-error').hidden=false; $('#dialog-error').textContent=error.message; notice('The photo was not attached.',error.message,error); }
    finally { $('#dialog-submit').disabled = false; }
  }
}

async function manifest() {
  if (!appointment()) return;
  try {
    const data = await api(`/api/appointments/${encodeURIComponent(state.appointmentId)}/manifest`);
    const rows = Array.isArray(data)?data:data.items || data.manifest || [];
    const a = appointment();
    const handoffs = a.handoffs || [];
    $('#record-content').innerHTML = `<p class="muted">${esc(a.name)}${a.is_demo?' · Fictional appointment':''}</p>${rows.length?rows.map(row=>`<div class="record-card"><h3>${esc(row.label)}</h3><dl class="detail-list"><dt>Exact item</dt><dd>${esc(row.item_id)}</dd><dt>Version</dt><dd>${esc(row.item_version)}</dd><dt>Location</dt><dd>${esc(row.location)}</dd><dt>Condition</dt><dd>${esc(row.condition)}</dd><dt>State</dt><dd>Held, awaiting exact-item confirmation</dd></dl></div>`).join(''):handoffs.length?handoffs.map(h=>`<div class="record-card"><h3>Packing confirmed</h3><dl class="detail-list"><dt>Exact item</dt><dd>${esc(h.item_id)}</dd><dt>Version</dt><dd>${esc(h.item_version)}</dd><dt>Handoff</dt><dd class="record-code">${esc(h.id)}</dd></dl></div>`).join(''):'<div class="record-card"><p style="margin:0">There is no active hold or completed packing record for this appointment.</p></div>'}<p class="compact-note">This records the approved item and local packing action. It does not claim that a parcel was shipped or delivered.</p><details class="record-raw"><summary>Inspect saved records</summary><pre>${esc(JSON.stringify({manifest:data,handoffs},null,2))}</pre></details>`;
    $('#record-dialog').showModal();
  } catch (error) { notice('The packing record could not open.',error.message,error); }
}

async function action(name,button) {
  if (state.busy) return;
  const a = appointment(), item = selectedItem();
  if (name === 'dismiss') { $('#message').hidden=true; return; }
  if (name === 'reset-search') { state.filter='all'; state.search=''; $('#item-search').value=''; renderItems(); $('#item-search').focus(); announce('Showing all items.'); return; }
  if (name === 'show-choice') { const heading=$('#choice-heading'); heading.tabIndex=-1; heading.focus({preventScroll:true}); $('#choice-panel').scrollIntoView({block:'start',behavior:'instant'}); return; }
  if (name === 'manifest') { await manifest(); return; }
  if (name === 'edit-item') { openDialog('edit'); return; }
  if (name === 'configure-provider') { openDialog('provider'); return; }
  if (name === 'clear-provider') { await mutate('/api/provider/configure','POST',{api_key:null},{title:'YouCam key cleared.',text:'The server no longer has this session key. No new provider requests can be made.'}); return; }
  if (name === 'view-current') { state.itemId=a.approval.item_id; state.filter='all'; render(); return; }
  if (name === 'approve') {
    await mutate(`/api/appointments/${encodeURIComponent(a.id)}/choice`,'POST',{item_id:item.id,expected_version:item.version,expected_choice_revision:a.choice_revision},{title:'Choice recorded.',text:`${item.id}, version ${item.version}, is approved. Place a hold to reserve it.`});
  } else if (name === 'hold') {
    await mutate(`/api/appointments/${encodeURIComponent(a.id)}/hold`,'POST',{approval_id:a.approval.id},{title:'The exact item is held.',text:`${a.approval.item_id} is reserved for this appointment. Confirm its ID at packing.`});
  } else if (name === 'release') {
    const hold = currentHold(a);
    await mutate(`/api/holds/${encodeURIComponent(hold.id)}/release`,'POST',{}, {title:'Hold released.',text:`${hold.item_id} is available again. A fresh approval is required before another hold.`});
  } else if (name === 'preview') {
    if (!providerReady()) return;
    if (!a.consent) { openDialog('consent'); return; }
    const p = await mutate(`/api/appointments/${encodeURIComponent(a.id)}/previews`,'POST',{}, {title:'Preview request recorded.',text:'The preview is separate from the hold. Check the actual provider result below.'});
    if (p) { state.preview = p; renderPanel(); schedulePreviewRead(); }
  } else if (name === 'revoke-consent') {
    await mutate(`/api/appointments/${encodeURIComponent(a.id)}/consent`,'POST',{consent:false},{title:'Photo consent withdrawn.',text:'Local access to personal preview material was revoked. Provider deletion is not implied.'});
    state.preview = null; renderPanel();
  } else if (name === 'refresh-preview') {
    const p = await mutate(`/api/previews/${encodeURIComponent(button.dataset.previewId)}/refresh`,'POST',{},null);
    if (p) { state.preview = p; renderPanel(); schedulePreviewRead(); announce(`Preview status: ${readable(p.status)}`); }
  }
}

document.addEventListener('click',event => {
  const b = event.target.closest('button');
  if (!b || b.disabled) return;
  if (state.busy) return;
  if (b.dataset.appointment) {
    state.appointmentId=b.dataset.appointment; state.itemId=appointment()?.approval?.item_id || state.data.items.find(i=>i.state==='available')?.id || state.data.items[0]?.id; state.preview=null; render(); schedulePreviewRead(); announce(`Opened ${appointment().name}.`);
  } else if (b.dataset.item) {
    state.itemId=b.dataset.item; renderItems(); renderPanel(); renderActivity(); announce(`Viewing ${selectedItem().label}. No approval or hold changed.`);
  } else if (b.dataset.filter) { state.filter=b.dataset.filter; renderItems(); }
  else if (b.dataset.action) { void action(b.dataset.action,b); }
});
document.addEventListener('submit',async event => {
  if (event.target.id !== 'pack-form') return;
  event.preventDefault();
  const hold = currentHold(appointment());
  const item_id = new FormData(event.target).get('item_id').trim();
  const key = `${hold.id}:${item_id}`;
  if (!state.packKeys.has(key)) state.packKeys.set(key,crypto.randomUUID());
  state.packDraft=item_id;
  await mutate(`/api/holds/${encodeURIComponent(hold.id)}/pack`,'POST',{item_id,request_key:state.packKeys.get(key)},{title:'Exact item confirmed and packed.',text:`${item_id} is tied to this approval and handoff record. Shipping or delivery has not been recorded.`},{packing:true});
});
document.addEventListener('input',event=>{ if (event.target.id==='scan-id') state.packDraft=event.target.value; });
$('#item-search').addEventListener('input',event=>{ state.search=event.target.value; renderItems(); });
$('#refresh').addEventListener('click',async()=>{ if (state.busy) return; try { await loadState(); notice('Workspace refreshed.','The item and appointment states now match the saved records.'); } catch(error) { notice('Could not refresh.',error.message,error); } });
$('#add-appointment').addEventListener('click',()=>{ if (!state.busy) openDialog('appointment'); });
$('#add-item').addEventListener('click',()=>{ if (!state.busy) openDialog('item'); });
$('#manifest').addEventListener('click',manifest);
$('#dialog-form').addEventListener('submit',submitDialog);
$('#dialog-close').addEventListener('click',()=>$('#form-dialog').close());
$('#dialog-cancel').addEventListener('click',()=>$('#form-dialog').close());
$('#record-close').addEventListener('click',()=>$('#record-dialog').close());
for (const dialog of $$('dialog')) dialog.addEventListener('click',event=>{ if (event.target===dialog) { const r=dialog.getBoundingClientRect(); if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) dialog.close(); } });
// The mobile shortcut gets out of the way as soon as the appointment sheet is visible.
new IntersectionObserver(entries=>{
  $('#mobile-selection').classList.toggle('choice-visible',entries[0].isIntersecting);
}).observe($('#choice-panel'));

loadState().catch(error=>{ $('#loading').hidden=true; notice('The workspace could not open.',error.message,error); $('#connection-status').textContent='Not connected'; });
