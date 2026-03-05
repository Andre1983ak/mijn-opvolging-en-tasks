import React, { useState, useEffect } from "react";

// Load Open Sans from Google Fonts
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap";
document.head.appendChild(fontLink);

const STORAGE_KEY = "followup-v2-items";
const API_KEY_STORAGE = "followup-v2-apikey";

const TODAY = new Date();
TODAY.setHours(0,0,0,0);

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso); d.setHours(0,0,0,0);
  return d.getTime() === TODAY.getTime();
}

function isOverdue(iso) {
  if (!iso) return false;
  const d = new Date(iso); d.setHours(0,0,0,0);
  return d < TODAY;
}

function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso); d.setHours(0,0,0,0);
  return Math.round((d - TODAY) / 86400000);
}

const PRIO = {
  urgent: { label: "Urgent", dot: "#ef4444" },
  hoog:   { label: "Hoog",   dot: "#f59e0b" },
  middel: { label: "Middel", dot: "#6366f1" },
  laag:   { label: "Laag",   dot: "#10b981" },
};

const SOURCE = {
  email:  { icon: "✉", label: "Email" },
  teams:  { icon: "💬", label: "Teams" },
  taak:   { icon: "✓", label: "Taak" },
};

// ─── COMPONENTS ────────────────────────────────────────────────────

function PrioBadge({ p }) {
  const c = PRIO[p] || PRIO.middel;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color: c.dot }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background: c.dot, display:"inline-block" }} />
      {c.label}
    </span>
  );
}

function DeadlinePill({ iso, status }) {
  if (!iso || status === "afgehandeld") return null;
  const days = daysUntil(iso);
  const over = isOverdue(iso);
  const today = isToday(iso);
  const color = over ? "#ef4444" : today ? "#f59e0b" : days <= 2 ? "#f59e0b" : "#6b7280";
  const text = over ? `${Math.abs(days)}d te laat` : today ? "Vandaag" : `Over ${days}d`;
  return (
    <span style={{ fontSize:11, fontWeight:700, color, background: color+"14", padding:"2px 8px", borderRadius:20, border:`1px solid ${color}33` }}>
      {text}
    </span>
  );
}

// ─── MAIN APP ───────────────────────────────────────────────────────

export default function App() {
  const [items, setItems] = useState([]);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [view, setView] = useState("vandaag"); // vandaag | alle | invoer | detail | instellingen
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [genFollowup, setGenFollowup] = useState(false);
  const [toast, setToast] = useState(null);

  // Form state
  const [form, setForm] = useState({ type: "email", content: "", context: "" });
  const [followupInstr, setFollowupInstr] = useState("");

  useEffect(() => { init(); }, []);

  async function init() {
    try {
      const r1 = await window.storage.get(STORAGE_KEY);
      if (r1) setItems(JSON.parse(r1.value));
    } catch(e) { setItems([]); }
    try {
      const r2 = await window.storage.get(API_KEY_STORAGE);
      if (r2) setApiKey(r2.value);
    } catch(e) {}
    setLoading(false);
  }

  async function persist(newItems) {
    setItems(newItems);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(newItems)); } catch(e) {}
  }

  function notify(msg, err=false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3500);
  }

  async function saveApiKey() {
    await window.storage.set(API_KEY_STORAGE, apiKeyInput);
    setApiKey(apiKeyInput);
    notify("API-sleutel opgeslagen ✓");
    setView("vandaag");
  }

  async function callClaude(prompt) {
    const key = apiKey;
    if (!key) throw new Error("Geen API-sleutel");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.content.map(b => b.text||"").join("");
  }

  async function analyzeInput() {
    if (!form.content.trim()) return notify("Voeg inhoud toe", true);
    if (!apiKey) { setView("instellingen"); return; }
    setAnalyzing(true);
    const vandaag = new Date().toISOString().split("T")[0];
    try {
      const raw = await callClaude(`Je bent een persoonlijke assistent die berichten analyseert en taken inplant.

Vandaag is: ${vandaag}
Bron: ${form.type}
${form.context ? `Context: ${form.context}` : ""}

Bericht:
${form.content}

Geef een JSON-object (ALLEEN JSON, geen uitleg) met:
{
  "afzender": "naam of afdeling",
  "onderwerp": "kort onderwerp max 60 tekens",
  "samenvatting": "wat staat er in dit bericht, max 120 tekens",
  "prioriteit": "urgent|hoog|middel|laag",
  "actie_vereist": "welke concrete actie moet ondernomen worden, max 100 tekens",
  "deadline_suggestie": "ISO datum YYYY-MM-DD wanneer dit afgehandeld moet zijn (realistisch op basis van urgentie)",
  "deadline_reden": "waarom deze datum, max 60 tekens",
  "concept_antwoord": "professioneel concept-antwoord in het Nederlands, klaar om te kopiëren"
}`);
      const clean = raw.replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      const item = {
        id: Date.now(),
        bron: form.type,
        ...parsed,
        status: "open",
        aangemaakt: new Date().toISOString(),
        origineel: form.content,
        geschiedenis: [],
      };
      await persist([item, ...items]);
      setForm({ type:"email", content:"", context:"" });
      setSelected(item);
      setView("detail");
      notify("Toegevoegd en geanalyseerd ✓");
    } catch(e) {
      notify("Fout: " + e.message, true);
    }
    setAnalyzing(false);
  }

  async function generateFollowup() {
    if (!followupInstr.trim() || !selected) return;
    setGenFollowup(true);
    try {
      const text = await callClaude(`Je bent een persoonlijke assistent.

Origineel bericht van ${selected.afzender}:
${selected.origineel}

Eerdere opvolgingen:
${selected.geschiedenis.map((h,i) => `${i+1}. ${h.instructie}: ${h.antwoord.slice(0,100)}...`).join("\n") || "Geen"}

Mijn instructie voor dit vervolg:
${followupInstr}

Schrijf ALLEEN de emailtekst (geen onderwerpregel, geen uitleg, direct klaar om te sturen).`);
      const entry = { datum: new Date().toISOString(), instructie: followupInstr, antwoord: text };
      const updated = { ...selected, status:"in_behandeling", concept_antwoord: text, geschiedenis:[...(selected.geschiedenis||[]), entry] };
      const newItems = items.map(i => i.id===selected.id ? updated : i);
      await persist(newItems);
      setSelected(updated);
      setFollowupInstr("");
      notify("Vervolg gegenereerd ✓");
    } catch(e) {
      notify("Fout: " + e.message, true);
    }
    setGenFollowup(false);
  }

  async function setStatus(id, status) {
    const newItems = items.map(i => i.id===id ? {...i, status} : i);
    await persist(newItems);
    if (selected?.id === id) setSelected({...selected, status});
    notify(status === "afgehandeld" ? "✓ Afgehandeld!" : "Status bijgewerkt");
  }

  async function updateDeadline(id, date) {
    const newItems = items.map(i => i.id===id ? {...i, deadline_suggestie: date} : i);
    await persist(newItems);
    if (selected?.id === id) setSelected({...selected, deadline_suggestie: date});
  }

  async function deleteItem(id) {
    await persist(items.filter(i => i.id !== id));
    setView("alle");
    setSelected(null);
    notify("Verwijderd");
  }

  // Computed lists
  const vandaagItems = items.filter(i => i.status !== "afgehandeld" && (isToday(i.deadline_suggestie) || isOverdue(i.deadline_suggestie)));
  const openItems = items.filter(i => i.status !== "afgehandeld");
  const afgehandeldItems = items.filter(i => i.status === "afgehandeld");

  // ── STYLES ──────────────────────────────────────────────────────
  const cs = {
    app: { fontFamily:"'Open Sans', sans-serif", background:"#f0f2f5", minHeight:"100vh", color:"#1e293b", display:"flex", flexDirection:"column" },
    sidebar: { width:230, background:"#ffffff", borderRight:"1px solid #e2e8f0", padding:"24px 0", display:"flex", flexDirection:"column", gap:2, flexShrink:0, boxShadow:"2px 0 8px rgba(0,0,0,0.04)" },
    logo: { padding:"0 20px 24px", fontSize:17, fontWeight:800, letterSpacing:"-0.02em", color:"#1e293b", display:"flex", alignItems:"center", gap:8 },
    logoAccent: { color:"#4f46e5" },
    navBtn: (active) => ({
      display:"flex", alignItems:"center", gap:10, padding:"10px 20px", cursor:"pointer",
      background: active ? "#eef2ff" : "transparent",
      color: active ? "#4f46e5" : "#64748b",
      borderLeft: active ? "3px solid #4f46e5" : "3px solid transparent",
      fontWeight: active ? 700 : 500, fontSize:14, border:"none", width:"100%", textAlign:"left",
      fontFamily:"'Open Sans', sans-serif",
      transition:"all 0.15s",
    }),
    navCount: { marginLeft:"auto", background:"#eef2ff", color:"#4f46e5", borderRadius:20, padding:"1px 8px", fontSize:11, fontWeight:800 },
    content: { flex:1, overflow:"auto", padding:"36px", maxWidth:820, width:"100%", margin:"0 auto" },
    pageTitle: { fontSize:26, fontWeight:800, letterSpacing:"-0.03em", marginBottom:6, color:"#1e293b" },
    pageSubtitle: { color:"#94a3b8", fontSize:14, marginBottom:28 },
    card: (overdue) => ({
      background:"#ffffff", border:`1px solid ${overdue ? "#fecaca" : "#e2e8f0"}`,
      borderRadius:12, padding:"16px 18px", marginBottom:10, cursor:"pointer",
      boxShadow:"0 1px 3px rgba(0,0,0,0.05)",
      transition:"box-shadow 0.15s, border-color 0.15s",
    }),
    cardTop: { display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:6 },
    cardTitle: { fontWeight:700, fontSize:15, color:"#1e293b", marginBottom:2 },
    cardMeta: { fontSize:12, color:"#94a3b8" },
    cardFooter: { display:"flex", gap:8, alignItems:"center", marginTop:8, flexWrap:"wrap" },
    sourceTag: { fontSize:11, color:"#64748b", background:"#f1f5f9", padding:"2px 8px", borderRadius:20, fontWeight:600 },
    input: { background:"#ffffff", border:"1.5px solid #e2e8f0", color:"#1e293b", borderRadius:8, padding:"10px 14px", fontSize:14, fontFamily:"'Open Sans', sans-serif", outline:"none", width:"100%", boxSizing:"border-box", transition:"border 0.15s" },
    textarea: { background:"#ffffff", border:"1.5px solid #e2e8f0", color:"#1e293b", borderRadius:8, padding:"12px 14px", fontSize:14, fontFamily:"'Open Sans', sans-serif", outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", minHeight:160, lineHeight:1.6 },
    btn: (v="primary") => ({
      padding:"10px 20px", borderRadius:8, border:"none", fontWeight:700, fontSize:14, cursor:"pointer",
      fontFamily:"'Open Sans', sans-serif",
      background: v==="primary" ? "#4f46e5" : v==="danger" ? "#ef4444" : v==="success" ? "#10b981" : "#f1f5f9",
      color: v==="ghost" ? "#64748b" : "#fff",
      transition:"opacity 0.15s",
    }),
    label: { fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#94a3b8", marginBottom:6, display:"block" },
    detailBox: { background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:10, padding:"14px", fontSize:14, lineHeight:1.7, whiteSpace:"pre-wrap", color:"#334155", marginBottom:16 },
    divider: { borderTop:"1px solid #e2e8f0", margin:"20px 0" },
    row: { display:"flex", gap:10, flexWrap:"wrap" },
    tag: (color="#4f46e5") => ({ fontSize:11, fontWeight:700, color, background:color+"15", padding:"3px 10px", borderRadius:20, border:`1px solid ${color}25` }),
    emptyState: { textAlign:"center", padding:"60px 20px", color:"#000000" },
    toast: (err) => ({
      position:"fixed", bottom:24, right:24, padding:"12px 20px", borderRadius:10,
      background: err ? "#ef4444" : "#10b981", color:"#fff", fontWeight:700, fontSize:14,
      boxShadow:"0 8px 30px rgba(0,0,0,0.15)", zIndex:9999,
    }),
    sectionHeader: { fontSize:12, fontWeight:700, color:"#94a3b8", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:12, marginTop:24 },
  };

  if (loading) return <div style={{...cs.app, justifyContent:"center", alignItems:"center"}}><span style={{color:"#7c7a8e"}}>Laden…</span></div>;

  function renderCard(item) {
    const over = isOverdue(item.deadline_suggestie) && item.status !== "afgehandeld";
    return (
      <div key={item.id} style={cs.card(over)}
        onClick={() => { setSelected(item); setView("detail"); }}
        onMouseEnter={e => e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,0.08)"}
        onMouseLeave={e => e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,0.05)"}
      >
        <div style={cs.cardTop}>
          <div style={{flex:1, minWidth:0}}>
            <div style={cs.cardTitle}>{item.onderwerp}</div>
            <div style={cs.cardMeta}>{item.afzender} · {formatDate(item.aangemaakt)}</div>
          </div>
          <DeadlinePill iso={item.deadline_suggestie} status={item.status} />
        </div>
        <div style={{fontSize:13, color:"#9896aa", lineHeight:1.5, marginBottom:8}}>{item.actie_vereist}</div>
        <div style={cs.cardFooter}>
          <span style={cs.sourceTag}>{SOURCE[item.bron]?.icon} {SOURCE[item.bron]?.label}</span>
          <PrioBadge p={item.prioriteit} />
          {item.status === "in_behandeling" && <span style={cs.tag("#f59e0b")}>In behandeling</span>}
          {item.geschichte?.length > 0 && <span style={cs.tag()}>↩ {item.geschiedenis.length} opvolgingen</span>}
        </div>
      </div>
    );
  }

  // ── VIEWS ───────────────────────────────────────────────────────

  function ViewVandaag() {
    const urgent = openItems.filter(i => i.prioriteit === "urgent" && !isToday(i.deadline_suggestie) && !isOverdue(i.deadline_suggestie));
    return (
      <>
        <div style={cs.pageTitle}>Goedemorgen 👋</div>
        <div style={cs.pageSubtitle}>{new Date().toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long"})}</div>

        {vandaagItems.length === 0 && urgent.length === 0 ? (
          <div style={cs.emptyState}>
            <div style={{fontSize:40,marginBottom:12}}>🎉</div>
            <div style={{fontSize:18,fontWeight:700,color:"#000000",marginBottom:8}}>Niks op de agenda voor vandaag!</div>
            <div style={{color:"#000000"}}>Voeg een email of taak toe om te beginnen.</div>
          </div>
        ) : (
          <>
            {vandaagItems.length > 0 && <>
              <div style={cs.sectionHeader}>⚡ Vandaag & achterstallig ({vandaagItems.length})</div>
              {vandaagItems.map(renderCard)}
            </>}
            {urgent.length > 0 && <>
              <div style={cs.sectionHeader}>🔴 Urgent (andere deadlines)</div>
              {urgent.map(renderCard)}
            </>}
          </>
        )}
      </>
    );
  }

  function ViewAlle() {
    const [tab, setTab] = useState("open");
    const list = tab === "open" ? openItems : afgehandeldItems;
    const sorted = [...list].sort((a,b) => {
      const pa = ["urgent","hoog","middel","laag"].indexOf(a.prioriteit);
      const pb = ["urgent","hoog","middel","laag"].indexOf(b.prioriteit);
      if (pa !== pb) return pa - pb;
      return new Date(a.deadline_suggestie||"9999") - new Date(b.deadline_suggestie||"9999");
    });
    return (
      <>
        <div style={cs.pageTitle}>Alle taken</div>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {["open","afgehandeld"].map(t => (
            <button key={t} style={{...cs.btn(tab===t?"primary":"ghost"), padding:"7px 16px", fontSize:13}}
              onClick={()=>setTab(t)}>
              {t==="open"?"Open":"Afgehandeld"} ({t==="open"?openItems.length:afgehandeldItems.length})
            </button>
          ))}
        </div>
        {sorted.length === 0
          ? <div style={cs.emptyState}><div style={{fontSize:36,marginBottom:10}}>📭</div>Geen items</div>
          : sorted.map(renderCard)
        }
      </>
    );
  }

  function ViewInvoer() {
    return (
      <>
        <div style={cs.pageTitle}>Nieuw item toevoegen</div>
        <div style={cs.pageSubtitle}>Plak een email, Teams-bericht of beschrijf een taak. Claude analyseert en plant automatisch in.</div>

        <div style={{marginBottom:16}}>
          <label style={cs.label}>Bron</label>
          <div style={{display:"flex",gap:8}}>
            {Object.entries(SOURCE).map(([k,v]) => (
              <button key={k} style={{...cs.btn(form.type===k?"primary":"ghost"), padding:"8px 16px", fontSize:13, opacity:1}}
                onClick={()=>setForm({...form,type:k})}>
                {v.icon} {v.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{marginBottom:16}}>
          <label style={cs.label}>Inhoud</label>
          <textarea style={cs.textarea}
            placeholder={form.type==="email"
              ? "Plak hier de email tekst...\n\nVan: naam@bedrijf.nl\nOnderwerp: ...\n\nDear..."
              : form.type==="teams"
              ? "Plak hier het Teams-bericht..."
              : "Beschrijf de taak die je wilt bijhouden..."}
            value={form.content}
            onChange={e=>setForm({...form,content:e.target.value})}
          />
        </div>

        <div style={{marginBottom:20}}>
          <label style={cs.label}>Extra context (optioneel)</label>
          <input style={cs.input} placeholder="Bijv: dit is een klant met hoge prioriteit, of: dit hoeft pas volgende maand"
            value={form.context}
            onChange={e=>setForm({...form,context:e.target.value})}
          />
        </div>

        <div style={cs.row}>
          <button style={{...cs.btn("primary"), opacity:analyzing?0.6:1}} onClick={analyzeInput} disabled={analyzing}>
            {analyzing ? "✦ Analyseren…" : "✦ Analyseer & voeg toe"}
          </button>
          <button style={cs.btn()} onClick={()=>setView("vandaag")}>Annuleren</button>
        </div>
      </>
    );
  }

  function ViewDetail() {
    const item = selected;
    if (!item) return null;
    const [editDeadline, setEditDeadline] = useState(item.deadline_suggestie?.split("T")[0]||"");

    return (
      <>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
          <button style={{...cs.btn(), padding:"8px 14px", fontSize:13}} onClick={()=>setView("alle")}>← Terug</button>
          <div style={{flex:1}}>
            <div style={cs.pageTitle}>{item.onderwerp}</div>
            <div style={{color:"#94a3b8",fontSize:13}}>Van: {item.afzender} · {SOURCE[item.bron]?.icon} {SOURCE[item.bron]?.label} · {formatDate(item.aangemaakt)}</div>
          </div>
        </div>

        {/* Badges */}
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20,alignItems:"center"}}>
          <PrioBadge p={item.prioriteit} />
          <DeadlinePill iso={item.deadline_suggestie} status={item.status} />
          {item.status==="in_behandeling" && <span style={cs.tag("#f59e0b")}>In behandeling</span>}
          {item.status==="afgehandeld" && <span style={cs.tag("#10b981")}>✓ Afgehandeld</span>}
        </div>

        {/* Info grid */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
          <div>
            <label style={cs.label}>Samenvatting</label>
            <div style={cs.detailBox}>{item.samenvatting}</div>
          </div>
          <div>
            <label style={cs.label}>Vereiste actie</label>
            <div style={cs.detailBox}>{item.actie_vereist}</div>
          </div>
        </div>

        {/* Deadline */}
        <div style={{marginBottom:20}}>
          <label style={cs.label}>Deadline / opvolgdatum</label>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <input type="date" style={{...cs.input,width:"auto"}} value={editDeadline}
              onChange={e=>setEditDeadline(e.target.value)} />
            <button style={{...cs.btn("success"),padding:"9px 16px",fontSize:13}}
              onClick={()=>updateDeadline(item.id,editDeadline)}>Opslaan</button>
            {item.deadline_reden && <span style={{fontSize:12,color:"#94a3b8"}}>💡 {item.deadline_reden}</span>}
          </div>
        </div>

        <div style={cs.divider} />

        {/* Concept antwoord */}
        <div style={{marginBottom:20}}>
          <label style={cs.label}>Concept antwoord</label>
          <div style={cs.detailBox}>{item.concept_antwoord}</div>
          <button style={{...cs.btn(),fontSize:12,padding:"6px 12px"}}
            onClick={()=>{navigator.clipboard.writeText(item.concept_antwoord); notify("Gekopieerd ✓");}}>
            📋 Kopieer
          </button>
        </div>

        {/* Geschiedenis */}
        {item.geschiedenis?.length > 0 && (
          <div style={{marginBottom:20}}>
            <label style={cs.label}>Opvolggeschiedenis ({item.geschiedenis.length})</label>
            {item.geschiedenis.map((h,i) => (
              <div key={i} style={{...cs.detailBox, borderLeft:"3px solid #4f46e5", marginBottom:10}}>
                <div style={{fontSize:11,color:"#94a3b8",marginBottom:6}}>{formatDate(h.datum)} — "{h.instructie}"</div>
                {h.antwoord}
                <button style={{...cs.btn(),fontSize:11,padding:"4px 10px",marginTop:8}}
                  onClick={()=>{navigator.clipboard.writeText(h.antwoord); notify("Gekopieerd ✓");}}>
                  📋 Kopieer
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Vervolg genereren */}
        {item.status !== "afgehandeld" && (
          <>
            <div style={cs.divider} />
            <div style={{marginBottom:20}}>
              <label style={cs.label}>Vervolg genereren</label>
              <textarea style={{...cs.textarea,minHeight:100}} value={followupInstr}
                onChange={e=>setFollowupInstr(e.target.value)}
                placeholder="Beschrijf wat je wilt zeggen... (bijv. 'vraag om uitstel tot volgende week' of 'accepteer voorstel maar vraag lagere prijs')" />
              <button style={{...cs.btn("primary"),marginTop:10,opacity:genFollowup?0.6:1}}
                onClick={generateFollowup} disabled={genFollowup}>
                {genFollowup ? "Genereren…" : "✦ Genereer vervolg"}
              </button>
            </div>
          </>
        )}

        <div style={cs.divider} />

        {/* Status acties */}
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {item.status !== "afgehandeld" && (
            <button style={cs.btn("success")} onClick={()=>setStatus(item.id,"afgehandeld")}>✓ Markeer afgehandeld</button>
          )}
          {item.status === "afgehandeld" && (
            <button style={cs.btn()} onClick={()=>setStatus(item.id,"open")}>↩ Heropenen</button>
          )}
          {item.status === "open" && (
            <button style={cs.btn()} onClick={()=>setStatus(item.id,"in_behandeling")}>→ In behandeling</button>
          )}
          <button style={cs.btn("danger")} onClick={()=>deleteItem(item.id)}>Verwijderen</button>
        </div>
      </>
    );
  }

  function ViewInstellingen() {
    return (
      <>
        <div style={cs.pageTitle}>Instellingen</div>
        <div style={cs.pageSubtitle}>Voer je Anthropic API-sleutel in om AI-analyse te gebruiken.</div>
        <div style={{marginBottom:16}}>
          <label style={cs.label}>Anthropic API-sleutel</label>
          <input style={cs.input} type="password"
            placeholder="sk-ant-..."
            value={apiKeyInput}
            onChange={e=>setApiKeyInput(e.target.value)}
          />
          {apiKey && <div style={{marginTop:6,fontSize:12,color:"#10b981"}}>✓ API-sleutel is opgeslagen</div>}
        </div>
        <button style={cs.btn("primary")} onClick={saveApiKey}>Opslaan</button>
        <div style={{marginTop:24,padding:16,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,fontSize:13,color:"#64748b",lineHeight:1.7}}>
          <strong style={{color:"#1e293b"}}>Hoe een API-sleutel aanvragen:</strong><br/>
          1. Ga naar <strong style={{color:"#4f46e5"}}>console.anthropic.com</strong><br/>
          2. Maak een account aan of log in<br/>
          3. Ga naar "API Keys" en maak een nieuwe sleutel aan<br/>
          4. Plak de sleutel hierboven<br/><br/>
          Kosten: ca. €0,001–0,005 per analyse. Stel een budgetlimiet in via de console.
        </div>
      </>
    );
  }

  const navItems = [
    { id:"vandaag", icon:"☀", label:"Vandaag", count: vandaagItems.length },
    { id:"alle", icon:"◈", label:"Alle taken", count: openItems.length },
    { id:"invoer", icon:"+", label:"Toevoegen", count:0 },
    { id:"instellingen", icon:"⚙", label:"Instellingen", count:0 },
  ];

  return (
    <div style={{...cs.app, flexDirection:"row"}}>
      {toast && <div style={cs.toast(toast.err)}>{toast.msg}</div>}

      {/* Sidebar */}
      <div style={cs.sidebar}>
        <div style={cs.logo}>
          <span style={cs.logoAccent}>◈</span> Opvolging
        </div>
        {navItems.map(n => (
          <button key={n.id} style={cs.navBtn(view===n.id || (view==="detail" && n.id==="alle"))}
            onClick={()=>setView(n.id)}>
            <span style={{fontSize:15}}>{n.icon}</span>
            {n.label}
            {n.count > 0 && <span style={cs.navCount}>{n.count}</span>}
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={{flex:1, overflow:"auto"}}>
        <div style={cs.content}>
          {view==="vandaag" && <ViewVandaag />}
          {view==="alle" && <ViewAlle />}
          {view==="invoer" && <ViewInvoer />}
          {view==="detail" && <ViewDetail />}
          {view==="instellingen" && <ViewInstellingen />}
        </div>
      </div>
    </div>
  );
}
