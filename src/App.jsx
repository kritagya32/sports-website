    // src/App.jsx
    import React, { useEffect, useState, useCallback, useRef } from "react";
    import './index.css';
    import { supabase } from './supabaseClient';
    import logo from './png.png';

    /*
      Full patched App.jsx
      - Supabase realtime, fetch, pending queue
      - Age-class / sport eligibility rules adjusted
      - Doubles/mixed-doubles logic updated:
          * Doubles: up to 2 participants per age class (represents one doubles team)
          * Mixed doubles: up to 2 participants per age class, must be 1 male + 1 female
      - Women veteran now has mixed doubles; men senior veteran does NOT
      - Admin sport filter preserved
    */

    // -------------------- Constants --------------------
    const TEAM_CREDENTIALS = [
      { teamId: "Chamba", username: "chamba", password: "Ch@mba2025" },
      { teamId: "Dharamshala", username: "dharamshala", password: "Dhar@2025" },
      { teamId: "Mandi", username: "mandi", password: "M@ndi2025" },
      { teamId: "Solan", username: "solan", password: "S0lan2025" },
      { teamId: "Hamirpur", username: "hamirpur", password: "HamiR2025" },
      { teamId: "Bilaspur", username: "bilaspur", password: "BilaP2025" },
      { teamId: "Nahan", username: "nahan", password: "Nahan2025#" },
      { teamId: "Wildlife", username: "wildlife", password: "Wild2025!" },
      { teamId: "Kullu", username: "kullu", password: "Kullu2025#" },
      { teamId: "Rampur", username: "rampur", password: "Rampur2025" },
      { teamId: "Shimla", username: "shimla", password: "Shimla2025" },
      { teamId: "HPSFDC", username: "hpsfdc", password: "HPSFDC2025" },
      { teamId: "Direction", username: "direction", password: "Direct2025" }
    ];

    const ADMIN_CREDENTIALS = [
      { role: "Admin1", username: "admin1", password: "Adm1n#Chamba" },
      { role: "Admin2", username: "admin2", password: "Adm2n#Chamba" },
      { role: "Admin3", username: "admin3", password: "Adm3n#Chamba" }
    ];

    const SPORTS = [
      "100 m","200 m","400 m","800 m","1500 m","5000 m","4x100 m relay",
      "Long Jump","High Jump","Triple Jump","Discuss Throw","Shotput","Javelin throw",
      "400 m walking","800 m walking","Chess","Carrom (Singles)","Carrom (Doubles)",
      "Table Tennis(Singles)","Table Tennis(Doubles)","Table Tennis (Mix Doubles)",
      "Badminton (Singles)","Badminton (Doubles)","Badminton (Mixed Doubles)",
      "Volleyball","Kabaddi","Basketball","Tug of War","Football","Lawn Tennis","Quiz","10k Marathon"
    ];

    const DESIGNATIONS = ["PCCF","APCCF","CCF", "CF", "DCF/DFO","ACF", "RFO", "Block Officer/Forest Guard", "Ministerial Staff","Van Mitra", "Others"];
    const BLOOD_TYPES = ["A+","A-","B+","B-","AB+","AB-","O+","O-"];

    const AGE_CLASSES_MASTER = {
      Male: [
        { id: "men_open", label: "Men - Open" },
        { id: "men_vet", label: "Men - Veteran (45+)" },
        { id: "men_sr_vet", label: "Men - Senior Veteran (53+)" }
      ],
      Female: [
        { id: "women_open", label: "Women - Open" },
        { id: "women_vet", label: "Women - Veteran (40+)" }
      ]
    };

    const DEFAULT_BASE_FEE_FIRST_35 = 300000;
    const SOLAN_BILASPUR_BASE = 250000;
    const EXTRA_FEE_PER_PLAYER = 7500;

    const LS_DRAFT_KEY = (team) => `chamba_draft_${team}`;
    const LS_SUBMITTED_KEY = (team) => `chamba_submitted_${team}`;
    const LS_DELETE_REQS = `chamba_delete_reqs_v1`;
    const LS_PENDING_KEY = (team) => `chamba_pending_${team}`;

    // -------------------- Helpers --------------------
    const formatINR = (n) => { try { return "₹" + Number(n).toLocaleString('en-IN'); } catch { return "₹" + n; } };
    const toBase64 = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const genReqId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

    function computeParticipationFees(count, teamId) {
      const n = Math.max(0, Number(count) || 0);
      let base = DEFAULT_BASE_FEE_FIRST_35;
      if (teamId === "Solan" || teamId === "Bilaspur") base = SOLAN_BILASPUR_BASE;
      if (n <= 35) return { base, extraCount: 0, extraAmount: 0, total: base };
      const extraCount = n - 35;
      const extraAmount = extraCount * EXTRA_FEE_PER_PLAYER;
      return { base, extraCount, extraAmount, total: base + extraAmount };
    }

    // -------------------- Age-class & sport eligibility rules --------------------

    // Allowed age classes based on gender and numeric age
    function getAllowedAgeClasses(gender, age) {
      if (!gender) return [];
      const a = Number(age);
      if (gender === "Male") {
        if (!Number.isFinite(a)) return [AGE_CLASSES_MASTER.Male[0]];
        if (a >= 53) return [AGE_CLASSES_MASTER.Male[0], AGE_CLASSES_MASTER.Male[1], AGE_CLASSES_MASTER.Male[2]];
        if (a >= 45) return [AGE_CLASSES_MASTER.Male[0], AGE_CLASSES_MASTER.Male[1]];
        return [AGE_CLASSES_MASTER.Male[0]];
      } else if (gender === "Female") {
        const f = Number(age);
        if (!Number.isFinite(f)) return [AGE_CLASSES_MASTER.Female[0]];
        if (f >= 40) return [AGE_CLASSES_MASTER.Female[0], AGE_CLASSES_MASTER.Female[1]];
        return [AGE_CLASSES_MASTER.Female[0]];
      }
      return [];
    }

    // Allowed sports given gender + ageClass (updated per your instructions)
    // - Women Veteran now allowed mixed doubles in Badminton and Table Tennis
    // - Men Senior Veteran removed mixed doubles
    function allowedSportsFor(gender, ageClass) {
      if (!gender) return SPORTS.slice();

      const menOpenDisallowed = new Set(["400 m walking", "800 m walking"]);
      const menVetDisallowed = new Set([
        "800 m", "1500 m", "5000 m", "4x100 m relay", "Triple Jump",
        "400 m walking", "800 m walking", "Carrom (Singles)", "Carrom (Doubles)"
      ]);
      // men_sr_vet: limited set; ensure we DO NOT allow mixed doubles here
      const menSrVetAllowed = new Set([
        "800 m walking",
        "Table Tennis(Singles)", "Table Tennis(Doubles)",
        "Badminton (Singles)", "Badminton (Doubles)",
        "Quiz", "10k Marathon"
      ]);
      const womenOpenDisallowed = new Set(["Football", "Lawn Tennis"]);
      // women_vet: allow mixed doubles for both badminton and table tennis as requested
      const womenVetAllowed = new Set(["800 m walking", "Quiz", "10k Marathon", "Badminton (Mixed Doubles)", "Table Tennis (Mix Doubles)"]);

      if (gender === "Male") {
        if (ageClass === "men_open") return SPORTS.filter(s => !menOpenDisallowed.has(s));
        if (ageClass === "men_vet") return SPORTS.filter(s => !menVetDisallowed.has(s));
        if (ageClass === "men_sr_vet") return SPORTS.filter(s => menSrVetAllowed.has(s));
        return SPORTS.slice();
      } else {
        if (ageClass === "women_open") return SPORTS.filter(s => !womenOpenDisallowed.has(s));
        if (ageClass === "women_vet") return SPORTS.filter(s => womenVetAllowed.has(s));
        return SPORTS.slice();
      }
    }

    // -------------------- Validation --------------------
    // Updated to enforce:
    // - Chess & Carrom (Singles): one player per gender per age class per team
    // - Badminton/Table Tennis singles: up to two singles players per gender per age class per team
    // - Badminton/Table Tennis doubles: max 2 participants per age class per team (represents one doubles team)
    // - Badminton/Table Tennis mixed doubles: max 2 participants per age class per team (must be 1 male + 1 female)
    function validateParticipant(part, teamExisting = []) {
      if (!part.name || String(part.name).trim() === "") return { ok: false, message: "Name required" };
      if (!part.gender || (part.gender !== "Male" && part.gender !== "Female")) return { ok: false, message: "Select gender (Male/Female)" };
      if (part.age === "" || part.age === null || part.age === undefined) return { ok: false, message: "Age is required" };
      const ageN = Number(part.age);
      if (!Number.isFinite(ageN) || ageN < 12 || ageN > 120) return { ok: false, message: "Enter valid age (12-120)" };
      if (!part.designation || String(part.designation).trim() === "") return { ok: false, message: "Designation is required" };
      if (!part.phone || String(part.phone).trim() === "") return { ok: false, message: "Phone is required" };
      const phoneDigits = String(part.phone).replace(/\D/g, '');
      if (!/^\d{10}$/.test(phoneDigits)) return { ok: false, message: "Enter a valid 10-digit phone number" };
      if (!part.blood || String(part.blood).trim() === "") return { ok: false, message: "Select blood type" };
      if (!BLOOD_TYPES.includes(part.blood)) return { ok: false, message: "Invalid blood type selected" };
      if (!part.ageClass || String(part.ageClass).trim() === "") return { ok: false, message: "Select age class" };

      // Check age-class allowed
      const allowedClasses = getAllowedAgeClasses(part.gender, part.age);
      if (!allowedClasses.some(a => a.id === part.ageClass)) return { ok: false, message: "Invalid age class for this participant's age/gender" };

      if (!part.vegNon || !(part.vegNon === "Veg" || part.vegNon === "Non Veg")) return { ok: false, message: "Select Veg or Non Veg" };
      if (!part.photoBase64 || String(part.photoBase64).trim() === "") return { ok: false, message: "Profile photo required (JPG/PNG ≤200KB)" };

      const chosen = (part.sports || []).filter(Boolean);
      if (chosen.length === 0) return { ok: false, message: "Choose at least one sport" };
      if (chosen.length > 3) return { ok: false, message: "Max 3 sports allowed" };

      // Check chosen sports allowed by age-class/gender
      const allowedSports = new Set(allowedSportsFor(part.gender, part.ageClass));
      const invalidChosen = chosen.filter(s => !allowedSports.has(s));
      if (invalidChosen.length > 0) return { ok: false, message: `Selected sport(s) not allowed for ${part.ageClass.replace(/_/g,' ')}: ${invalidChosen.join(', ')}` };

      // Per-age-class quotas using teamExisting (submitted + drafts)
      const sameAgeClass = (teamExisting || []).filter(r => (r.ageClass || "") === (part.ageClass || ""));

      // Chess & Carrom (Singles): 1 per gender per age class
      const chessSameGender = sameAgeClass.filter(p => p.gender === part.gender && (p.sports || []).includes("Chess")).length;
      if (chosen.includes("Chess") && chessSameGender >= 1) {
        return { ok: false, message: `Only one ${part.gender.toLowerCase()} player allowed in Chess for this age class` };
      }
      const carromSinglesSameGender = sameAgeClass.filter(p => p.gender === part.gender && (p.sports || []).includes("Carrom (Singles)")).length;
      if (chosen.includes("Carrom (Singles)") && carromSinglesSameGender >= 1) {
        return { ok: false, message: `Only one ${part.gender.toLowerCase()} player allowed in Carrom (Singles) for this age class` };
      }

      // Badminton singles: up to 2 per gender per age class
      const bdSinglesSameGender = sameAgeClass.filter(p => p.gender === part.gender && (p.sports || []).includes("Badminton (Singles)")).length;
      if (chosen.includes("Badminton (Singles)") && bdSinglesSameGender >= 2) {
        return { ok: false, message: `Only two ${part.gender.toLowerCase()} badminton singles allowed for this age class` };
      }

      // Table Tennis singles: up to 2 per gender per age class
      const ttSinglesSameGender = sameAgeClass.filter(p => p.gender === part.gender && (p.sports || []).includes("Table Tennis(Singles)")).length;
      if (chosen.includes("Table Tennis(Singles)") && ttSinglesSameGender >= 2) {
        return { ok: false, message: `Only two ${part.gender.toLowerCase()} table tennis singles allowed for this age class` };
      }

      // Badminton doubles: allow up to 2 participants total for the age class (represents one doubles team)
      const bdDoublesCount = sameAgeClass.filter(p => (p.sports || []).includes("Badminton (Doubles)")).length;
      if (chosen.includes("Badminton (Doubles)") && bdDoublesCount >= 2) {
        return { ok: false, message: `Badminton doubles team already filled for this age class (max 2 participants / one team)` };
      }

      // Table Tennis doubles: allow up to 2 participants total for the age class
      const ttDoublesCount = sameAgeClass.filter(p => (p.sports || []).includes("Table Tennis(Doubles)")).length;
      if (chosen.includes("Table Tennis(Doubles)") && ttDoublesCount >= 2) {
        return { ok: false, message: `Table Tennis doubles team already filled for this age class (max 2 participants / one team)` };
      }

      // Badminton Mixed Doubles:
      // - allow up to 2 participants total in the age class
      // - composition must be 1 male + 1 female
      const bdMixedMale = sameAgeClass.filter(p => p.gender === "Male" && (p.sports || []).includes("Badminton (Mixed Doubles)")).length;
      const bdMixedFemale = sameAgeClass.filter(p => p.gender === "Female" && (p.sports || []).includes("Badminton (Mixed Doubles)")).length;
      const bdMixedTotal = bdMixedMale + bdMixedFemale;
      if (chosen.includes("Badminton (Mixed Doubles)")) {
        // Reject if age class is men_sr_vet (allowedSportsFor already excludes it; this is just defensive)
        if (!allowedSports.has("Badminton (Mixed Doubles)")) {
          return { ok: false, message: `Badminton mixed doubles not allowed for this age class` };
        }
        // If participant is male
        if (part.gender === "Male") {
          if (bdMixedMale >= 1) return { ok: false, message: `Only one male allowed in Badminton mixed doubles for this age class` };
        } else {
          if (bdMixedFemale >= 1) return { ok: false, message: `Only one female allowed in Badminton mixed doubles for this age class` };
        }
        if (bdMixedTotal >= 2) return { ok: false, message: `Badminton mixed doubles team already filled for this age class` };
      }

      // Table Tennis Mixed Doubles:
      const ttMixedMale = sameAgeClass.filter(p => p.gender === "Male" && (p.sports || []).includes("Table Tennis (Mix Doubles)")).length;
      const ttMixedFemale = sameAgeClass.filter(p => p.gender === "Female" && (p.sports || []).includes("Table Tennis (Mix Doubles)")).length;
      const ttMixedTotal = ttMixedMale + ttMixedFemale;
      if (chosen.includes("Table Tennis (Mix Doubles)")) {
        if (!allowedSports.has("Table Tennis (Mix Doubles)")) {
          return { ok: false, message: `Table Tennis mixed doubles not allowed for this age class` };
        }
        if (part.gender === "Male") {
          if (ttMixedMale >= 1) return { ok: false, message: `Only one male allowed in Table Tennis mixed doubles for this age class` };
        } else {
          if (ttMixedFemale >= 1) return { ok: false, message: `Only one female allowed in Table Tennis mixed doubles for this age class` };
        }
        if (ttMixedTotal >= 2) return { ok: false, message: `Table Tennis mixed doubles team already filled for this age class` };
      }

      // Passed all checks
      return { ok: true };
    }

    // -------------------- CSV helpers --------------------
    function escapeCsvValue(value) {
      if (value === null || value === undefined) return '';
      if (Array.isArray(value)) value = value.join(';');
      if (typeof value === 'object') value = JSON.stringify(value);
      const s = String(value);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }
    function downloadCSV(rows = [], filename = 'registrations.csv') {
      if (!rows || !rows.length) {
        const blob = new Blob([''], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const headers = Object.keys(rows[0]);
      const csvLines = [];
      csvLines.push(headers.map(h => escapeCsvValue(h)).join(','));
      for (const row of rows) {
        const line = headers.map(h => escapeCsvValue(row[h]));
        csvLines.push(line.join(','));
      }
      const csvContent = csvLines.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    // -------------------- App Root and UI (unchanged behavior) --------------------
    export default function App() {
      const [user, setUser] = useState(null); // {type:'team', teamId} or {type:'admin', role}
      const [loginMessage, setLoginMessage] = useState("");

      function handleLogin(username, password) {
        const team = TEAM_CREDENTIALS.find(t => t.username === username && t.password === password);
        if (team) { setUser({ type: "team", teamId: team.teamId }); setLoginMessage(""); return; }
        const admin = ADMIN_CREDENTIALS.find(a => a.username === username && a.password === password);
        if (admin) { setUser({ type: "admin", role: admin.role }); setLoginMessage(""); return; }
        setLoginMessage("Invalid credentials");
      }
      function handleLogout() { setUser(null); }

      return (
        <div className="app-root">
          <header className="app-header">
            <div className="brand">
              <div className="brand-icon">
                <img src={logo} alt="Chamba logo" style={{width:"150px",height:"150px",objectFit:"contain"}} />
              </div>
              <h1>
              <div>26th H.P. Forest Sports & Duty Meet, 2025</div>
              <div style={{ fontSize: "0.95em", marginTop: "4px"}}>Registration Portal</div>
              </h1>
            </div>
            <div className="brand-right">
              {user ? (
                <div className="user-info">
                  <span className="user-type">{user.type === "team" ? user.teamId : user.role}</span>
                  <button className="btn small" onClick={handleLogout}>Logout</button>
                </div>
              ) : null}
            </div>
          </header>

          <main className="app-main">
            {!user && <Login onLogin={handleLogin} message={loginMessage} />}
            {user && user.type === "team" && <TeamManager teamId={user.teamId} />}
            {user && user.type === "admin" && <AdminDashboard />}
          </main>

          <footer className="app-footer"><div>© Kritagya Kumar</div></footer>
        </div>
      );
    }

    // -------------------- Login --------------------
    function Login({ onLogin, message }) {
      const [u, setU] = useState("");
      const [p, setP] = useState("");
      return (
        <div className="panel login-panel">
          <h2>Login</h2>
          <div className="form-row"><label>Username <span className="required">*</span></label><input value={u} onChange={e => setU(e.target.value)} /></div>
          <div className="form-row"><label>Password <span className="required">*</span></label><input type="password" value={p} onChange={e => setP(e.target.value)} /></div>
          <div className="form-row"><button className="btn primary" onClick={() => onLogin(u, p)}>Login</button></div>
          <div className="muted">Forgot Credentials? Contact us at sportsmeetchamba2025@gmail.com</div>
          {message && <div className="error-text">{message}</div>}
        </div>
      );
    }

    // -------------------- Team Manager --------------------
    function TeamManager({ teamId }) {
      const [drafts, setDrafts] = useState(() => { try { return JSON.parse(localStorage.getItem(LS_DRAFT_KEY(teamId)) || "[]") } catch { return [] } });
      const [submitted, setSubmitted] = useState(() => { try { return JSON.parse(localStorage.getItem(LS_SUBMITTED_KEY(teamId)) || "[]") } catch { return [] } });
      const [countInput, setCountInput] = useState("");
      const [message, setMessage] = useState("");
      const [fees, setFees] = useState({ base: 0, extraCount: 0, extraAmount: 0, total: 0 });
      const [loading, setLoading] = useState(false);
      const realtimeSubRef = useRef(null);

      useEffect(() => { try { localStorage.setItem(LS_DRAFT_KEY(teamId), JSON.stringify(drafts)); } catch (e) {} }, [drafts, teamId]);
      useEffect(() => { try { localStorage.setItem(LS_SUBMITTED_KEY(teamId), JSON.stringify(submitted)); } catch (e) {} }, [submitted, teamId]);

      useEffect(() => { recomputeFees(); }, []);
      useEffect(() => { recomputeFees(); }, [drafts, submitted]);

      const fetchSubmittedFromServer = useCallback(async () => {
        try {
          const { data, error } = await supabase
            .from('participants')
            .select('*')
            .eq('team_id', teamId)
            .order('timestamp', { ascending: false });

          if (error) {
            console.warn('Supabase fetch (TeamManager) error:', error);
            return { ok: false, error: error.message || JSON.stringify(error) };
          }

          const normalized = (data || []).map(r => ({
            id: r.id,
            teamId: r.team_id,
            name: r.name,
            gender: r.gender,
            age: r.age,
            designation: r.designation,
            phone: r.phone,
            blood: r.blood,
            ageClass: r.age_class,
            vegNon: r.veg_non,
            sports: r.sports,
            photoBase64: r.photo_base64,
            timestamp: r.timestamp,
            status: r.status || "Active"
          }));

          const localSubmitted = JSON.parse(localStorage.getItem(LS_SUBMITTED_KEY(teamId)) || "[]");
          const serverIds = new Set(normalized.filter(r => r.id).map(r => String(r.id)));
          const localsNotOnServer = (localSubmitted || []).filter(r => !r.id || !serverIds.has(String(r.id)));
          const merged = [...normalized];
          const existingTimestamps = new Set(merged.map(r => r.timestamp));
          localsNotOnServer.forEach(r => {
            if (!existingTimestamps.has(r.timestamp)) merged.push(r);
          });
          merged.sort((a,b) => (new Date(b.timestamp||0).getTime() - new Date(a.timestamp||0).getTime()));

          setSubmitted(merged);
          try { localStorage.setItem(LS_SUBMITTED_KEY(teamId), JSON.stringify(merged)); } catch (e) {}

          return { ok: true, count: merged.length };
        } catch (err) {
          console.error('fetchSubmittedFromServer failed', err);
          return { ok: false, error: err.message || String(err) };
        }
      }, [teamId]);

      const setupRealtime = useCallback(async () => {
        try {
          if (realtimeSubRef.current && realtimeSubRef.current.unsubscribe) {
            try { await realtimeSubRef.current.unsubscribe(); } catch (e) {}
            realtimeSubRef.current = null;
          }

          const channel = supabase.channel(`participants_team_${teamId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `team_id=eq.${teamId}` }, payload => {
              try {
                const evt = payload.eventType || payload.event || payload.type;
                const newRow = payload.new || payload.record || null;
                const oldRow = payload.old || null;

                if (evt === 'INSERT') {
                  if (!newRow) return;
                  const normalized = {
                    id: newRow.id,
                    teamId: newRow.team_id,
                    name: newRow.name,
                    gender: newRow.gender,
                    age: newRow.age,
                    designation: newRow.designation,
                    phone: newRow.phone,
                    blood: newRow.blood,
                    ageClass: newRow.age_class,
                    vegNon: newRow.veg_non,
                    sports: newRow.sports,
                    photoBase64: newRow.photo_base64,
                    timestamp: newRow.timestamp,
                    status: newRow.status || "Active"
                  };
                  setSubmitted(prev => {
                    const exists = prev.some(r => (r.id && normalized.id && String(r.id) === String(normalized.id)) || (r.timestamp && normalized.timestamp && r.timestamp === normalized.timestamp));
                    if (exists) return prev.map(r => ((r.id && normalized.id && String(r.id) === String(normalized.id)) || (r.timestamp && normalized.timestamp && r.timestamp === normalized.timestamp)) ? normalized : r);
                    const next = [normalized, ...prev];
                    try { localStorage.setItem(LS_SUBMITTED_KEY(teamId), JSON.stringify(next)); } catch (e) {}
                    return next;
                  });
                } else if (evt === 'UPDATE') {
                  if (!newRow) return;
                  const normalized = {
                    id: newRow.id,
                    teamId: newRow.team_id,
                    name: newRow.name,
                    gender: newRow.gender,
                    age: newRow.age,
                    designation: newRow.designation,
                    phone: newRow.phone,
                    blood: newRow.blood,
                    ageClass: newRow.age_class,
                    vegNon: newRow.veg_non,
                    sports: newRow.sports,
                    photoBase64: newRow.photo_base64,
                    timestamp: newRow.timestamp,
                    status: newRow.status || "Active"
                  };
                  setSubmitted(prev => {
                    const found = prev.some(r => r.id && normalized.id && String(r.id) === String(normalized.id));
                    let next;
                    if (found) next = prev.map(r => (r.id && normalized.id && String(r.id) === String(normalized.id)) ? normalized : r);
                    else {
                      const foundTs = prev.some(r => r.timestamp === normalized.timestamp);
                      if (foundTs) next = prev.map(r => r.timestamp === normalized.timestamp ? normalized : r);
                      else next = [normalized, ...prev];
                    }
                    try { localStorage.setItem(LS_SUBMITTED_KEY(teamId), JSON.stringify(next)); } catch (e) {}
                    return next;
                  });
                } else if (evt === 'DELETE') {
                  const idToRemove = (oldRow && oldRow.id) ? oldRow.id : (payload.old && payload.old.id ? payload.old.id : null);
                  const tsToRemove = (oldRow && oldRow.timestamp) ? oldRow.timestamp : null;
                  setSubmitted(prev => {
                    const next = prev.map(r => {
                      if ((idToRemove && r.id && String(r.id) === String(idToRemove)) || (!r.id && tsToRemove && r.timestamp === tsToRemove)) {
                        return { ...r, status: "Deleted" };
                      }
                      return r;
                    });
                    try { localStorage.setItem(LS_SUBMITTED_KEY(teamId), JSON.stringify(next)); } catch (e) {}
                    return next;
                  });
                } else {
                  fetchSubmittedFromServer().catch(()=>{});
                }
              } catch (err) {
                console.error('realtime payload handling error', err);
              }
            });

          const sub = await channel.subscribe();
          realtimeSubRef.current = channel;
          return { ok: true, sub };
        } catch (err) {
          console.error('setupRealtime failed', err);
          return { ok: false, error: err.message || String(err) };
        }
      }, [teamId, fetchSubmittedFromServer]);

      useEffect(() => {
        let mounted = true;
        (async () => {
          await fetchSubmittedFromServer();
          if (!mounted) return;
          await setupRealtime();
        })();
        return () => { mounted = false; if (realtimeSubRef.current && realtimeSubRef.current.unsubscribe) { realtimeSubRef.current.unsubscribe().catch(()=>{}); realtimeSubRef.current = null; } };
      }, [fetchSubmittedFromServer, setupRealtime]);

      function recomputeFees() {
        const activeSubmitted = (submitted || []).filter(r => r.status !== "Deleted" && r.status !== "Requested");
        const totalPlayers = activeSubmitted.length + (drafts || []).length;
        const f = computeParticipationFees(totalPlayers, teamId);
        setFees(f);
      }

      function generateSlots() {
        const n = Math.max(0, Math.min(80, Number(countInput) || 0));
        if (n <= 0) { setMessage("Enter a number between 1 and 80"); return; }
        const activeSubmitted = (submitted || []).filter(r => r.status !== "Deleted").length;
        const available = Math.max(0, 80 - activeSubmitted);
        if (n > available) { setMessage(`You may add up to ${available} more players (already submitted ${activeSubmitted}).`); return; }
        const arr = [];
        for (let i=0;i<n;i++){
          arr.push({
            __localId: Date.now()+"_"+i,
            teamId,
            name: "",
            gender: "",
            age: "",
            designation: "",
            phone: "",
            blood: "",
            ageClass: "",
            vegNon: "",
            sports: ["","",""],
            photoBase64: "",
            timestamp: new Date().toISOString(),
            status: "Draft"
          });
        }
        setDrafts(arr);
        setMessage("");
      }

      function updateDraft(idx, patch) {
        setDrafts(prev => {
          const copy = prev.slice();
          copy[idx] = { ...copy[idx], ...patch };

          // If gender or age changed, ensure ageClass still valid
          if (patch.gender || patch.age) {
            const allowed = getAllowedAgeClasses(copy[idx].gender, copy[idx].age).map(a => a.id);
            if (!allowed.includes(copy[idx].ageClass)) copy[idx].ageClass = "";
          }

          // If ageClass changed, filter sports to allowed ones
          if (patch.ageClass) {
            const allowedSet = new Set(allowedSportsFor(copy[idx].gender, copy[idx].ageClass));
            copy[idx].sports = (copy[idx].sports || []).map(s => allowedSet.has(s) ? s : "");
          }

          return copy;
        });
      }

      function removeDraft(idx) { setDrafts(prev => { const c = prev.slice(); c.splice(idx,1); return c; }); }

      async function handlePhotoChange(idx, file) {
        if (!file) return;
        const allowed = ["image/jpeg","image/png"];
        const max = 200*1024;
        if (!allowed.includes(file.type)) { setMessage("Profile photo must be JPG or PNG"); return; }
        if (file.size > max) { setMessage("Profile photo must be <= 200 KB"); return; }
        const b64 = await toBase64(file);
        updateDraft(idx, { photoBase64: b64 });
        setMessage("");
      }

      // pending queue helpers
      function enqueuePending(team, payload) {
        try {
          const key = LS_PENDING_KEY(team);
          const existing = JSON.parse(localStorage.getItem(key) || "[]");
          existing.push(payload);
          localStorage.setItem(key, JSON.stringify(existing));
        } catch (e) { console.error('enqueue failed', e); }
      }
      function removePendingOne(team) {
        try {
          const key = LS_PENDING_KEY(team);
          const existing = JSON.parse(localStorage.getItem(key) || "[]");
          existing.shift();
          localStorage.setItem(key, JSON.stringify(existing));
        } catch (e) { console.error('remove pending failed', e); }
      }

      async function flushPending(team) {
        try {
          const key = LS_PENDING_KEY(team);
          const pending = JSON.parse(localStorage.getItem(key) || "[]");
          if (!pending || pending.length === 0) return { ok:true, count:0 };

          for (let i=0;i<pending.length;i++){
            const item = pending[i];
            try {
              if (item.action === 'appendMultiple') {
                const toInsert = item.rows.map(r => {
                  const ageVal = (r.age === "" || r.age === null || r.age === undefined) ? null : parseInt(r.age, 10);
                  const sportsArr = Array.isArray(r.sports) ? r.sports.filter(s => s && String(s).trim() !== "") : [];
                  return {
                    team_id: r.teamId || null,
                    name: r.name || null,
                    gender: r.gender || null,
                    age: Number.isFinite(ageVal) ? ageVal : null,
                    designation: r.designation || null,
                    phone: r.phone || null,
                    blood: r.blood || null,
                    age_class: r.ageClass || null,
                    veg_non: r.vegNon || null,
                    sports: sportsArr,
                    photo_base64: r.photoBase64 || null,
                    timestamp: r.timestamp || new Date().toISOString(),
                    status: r.status || "Active"
                  };
                });

                const { data, error } = await supabase.from('participants').insert(toInsert).select();
                if (error) {
                  console.error('flush appendMultiple failed (supabase):', error);
                  return { ok:false, error: error.message || JSON.stringify(error) };
                }
                removePendingOne(team);
                await fetchSubmittedFromServer();
              } else if (item.action === 'requestDelete') {
                const payload = item.payload || {};
                if (payload.id) {
                  const { data, error } = await supabase.from('participants').update({ status: 'Requested' }).eq('id', payload.id).select();
                  if (error) { console.error('flush requestDelete by id failed:', error); return { ok:false, error: error.message || JSON.stringify(error) }; }
                  removePendingOne(team);
                  await fetchSubmittedFromServer();
                } else if (payload.timestamp && payload.teamId) {
                  const { data, error } = await supabase.from('participants').update({ status: 'Requested' }).eq('team_id', payload.teamId).eq('timestamp', payload.timestamp).select();
                  if (error) { console.error('flush requestDelete by timestamp failed:', error); return { ok:false, error: error.message || JSON.stringify(error) }; }
                  removePendingOne(team);
                  await fetchSubmittedFromServer();
                } else {
                  console.warn('requestDelete pending item missing id/timestamp, dropping', payload);
                  removePendingOne(team);
                }
              } else {
                console.warn('Unknown pending action', item.action);
                removePendingOne(team);
              }
            } catch (err) {
              console.error('flushPending network error', err);
              return { ok:false, error: err.message };
            }
          }
          return { ok:true, count: pending.length };
        } catch (err) {
          console.error('flushPending error', err);
          return { ok:false, error: err.message };
        }
      }

      async function submitAll() {
        const errors = [];
        for (let i=0;i<drafts.length;i++){
          const p = drafts[i];
          const otherTeam = submitted.concat(drafts.slice(0,i)).concat(drafts.slice(i+1));
          const v = validateParticipant(p, otherTeam);
          if (!v.ok) errors.push({ index:i, message: v.message });
        }
        if (errors.length > 0) { setMessage(`Validation failed: ${errors[0].message}`); return; }

        const insertRows = drafts.map(d => {
          const ageVal = (d.age === "" || d.age === null || d.age === undefined) ? null : parseInt(d.age, 10);
          const sportsArr = Array.isArray(d.sports) ? d.sports.filter(s => s && String(s).trim() !== "") : [];
          return {
            team_id: d.teamId || null,
            name: d.name || null,
            gender: d.gender || null,
            age: Number.isFinite(ageVal) ? ageVal : null,
            designation: d.designation || null,
            phone: d.phone || null,
            blood: d.blood || null,
            age_class: d.ageClass || null,
            veg_non: d.vegNon || null,
            sports: sportsArr,
            photo_base64: d.photoBase64 || null,
            timestamp: d.timestamp || new Date().toISOString(),
            status: "Active"
          };
        });

        setLoading(true);
        try {
          const { data, error } = await supabase.from('participants').insert(insertRows).select();
          if (error) {
            console.error('Supabase insert error:', error);
            enqueuePending(teamId, { action: 'appendMultiple', rows: drafts.map(d => ({ ...d })) });
            setSubmitted(prev => {
              const next = prev.concat(drafts.map(d => ({ ...d, status: "Active" })));
              try { localStorage.setItem(LS_SUBMITTED_KEY(teamId), JSON.stringify(next)); } catch (e) {}
              return next;
            });
            const serverMsg = error.message || (error.error ? error.error : JSON.stringify(error));
            setMessage('Error saving to server: ' + serverMsg);
          } else {
            const mapped = (data || []).map(r => ({
              id: r.id,
              teamId: r.team_id,
              name: r.name,
              gender: r.gender,
              age: r.age,
              designation: r.designation,
              phone: r.phone,
              blood: r.blood,
              ageClass: r.age_class,
              vegNon: r.veg_non,
              sports: r.sports,
              photoBase64: r.photo_base64,
              timestamp: r.timestamp,
              status: r.status || "Active"
            }));

            setSubmitted(prev => {
              const prevCopy = prev.slice();
              mapped.forEach(m => {
                const replacedIndex = prevCopy.findIndex(p => (p.id && m.id && String(p.id) === String(m.id)) || (p.timestamp && m.timestamp && p.timestamp === m.timestamp));
                if (replacedIndex >= 0) prevCopy[replacedIndex] = m;
                else prevCopy.unshift(m);
              });
              try { localStorage.setItem(LS_SUBMITTED_KEY(teamId), JSON.stringify(prevCopy)); } catch (e) {}
              return prevCopy;
            });

            setMessage("Saved to server!");
          }

          setDrafts([]);
          recomputeFees();

          try {
            const r = await flushPending(teamId);
            await fetchSubmittedFromServer();
            if (r && r.ok && r.count > 0) setMessage(prev => prev + " Pending actions flushed.");
          } catch (e) {}

        } catch (err) {
          console.error('submitAll fatal', err);
          setMessage('Unexpected error: ' + (err.message || String(err)));
        } finally {
          setLoading(false);
        }
      }

      useEffect(() => {
        flushPending(teamId).catch(()=>{});
        const interval = setInterval(() => { flushPending(teamId).catch(()=>{}); }, 60000);
        return () => clearInterval(interval);
      }, [teamId]);

      function requestDelete(row) {
        if (!row) { setMessage("Row missing"); return; }
        if (row.status === "Requested" || row.status === "Deleted") return;
        const reason = prompt("Enter brief reason for deletion (optional):");
        if (reason === null) return;

        setSubmitted(prev => {
          const updated = prev.map(r => ((r.id && row.id && String(r.id) === String(row.id)) || (!r.id && r.timestamp === row.timestamp)) ? { ...r, status: "Requested" } : r);
          try { localStorage.setItem(LS_SUBMITTED_KEY(teamId), JSON.stringify(updated)); } catch (e) {}
          return updated;
        });

        try {
          const saved = JSON.parse(localStorage.getItem(LS_DELETE_REQS) || "[]");
          saved.push({ reqId: genReqId(), rowId: row.id || null, teamId, name: row.name || "", timestamp: row.timestamp || null, reason, requestedAt: new Date().toISOString() });
          localStorage.setItem(LS_DELETE_REQS, JSON.stringify(saved));
        } catch (e) {}

        if (row.id) {
          (async () => {
            try {
              const { data, error } = await supabase.from('participants').update({ status: 'Requested' }).eq('id', row.id).select();
              if (error) {
                console.warn('Supabase update requestDelete failed, enqueuing', error);
                enqueuePending(teamId, { action: 'requestDelete', payload: { id: row.id, teamId, timestamp: row.timestamp, name: row.name, reason } });
                setMessage("Deletion requested locally; will retry server update.");
              } else {
                setMessage("Deletion requested and saved on server.");
                await fetchSubmittedFromServer();
              }
            } catch (err) {
              console.error('requestDelete network error, enqueuing', err);
              enqueuePending(teamId, { action: 'requestDelete', payload: { id: row.id, teamId, timestamp: row.timestamp, name: row.name, reason } });
              setMessage("Deletion requested locally; will retry server update.");
            }
          })();
        } else {
          enqueuePending(teamId, { action: 'requestDelete', payload: { id: null, teamId, timestamp: row.timestamp, name: row.name, reason } });
          setMessage("Deletion requested locally; will apply on server after row sync.");
        }
      }

      const manualSync = async () => {
        setMessage("Syncing with server...");
        const r = await fetchSubmittedFromServer();
        if (r && r.ok) setMessage("Synced with server.");
        else setMessage("Could not sync with server (check network / permissions).");
      };

      const activeSubmittedCount = (submitted || []).filter(r => r.status !== "Deleted").length;
      const totalParticipants = activeSubmittedCount + (drafts || []).length;
      const filledDrafts = (drafts || []).filter(d => d.name && d.name.trim()).length;
      const progressPercent = drafts.length === 0 ? 0 : Math.round((filledDrafts / drafts.length) * 100);

      
        return (
        <div className="panel team-manager">
            <div className="panel-header">
                <h2>Team Manager — {teamId}</h2>
                <div className="header-right"><div className="small-muted">Total: {totalParticipants} | Fee: {formatINR(fees.total)}</div></div>
            </div>

            <div className="grid-2">
                <div className="card">
                    <h3>Generate Draft Slots</h3>
                    <label>Number of participants (1-80) <span className="required">*</span></label>
                    <input type="number" min="1" max="80" value={countInput} onChange={e => setCountInput(e.target.value)} />
                    <div className="row gap" style={{ marginTop: 12 }}>
                        <button className="btn primary" onClick={generateSlots} disabled={loading}>Generate</button>
                        <button className="btn" onClick={() => { setCountInput(""); setMessage(""); }}>Cancel</button>
                        <button className="btn" onClick={manualSync}>Sync</button>
                    </div>
                    {message && <div className="info-text">{message}</div>}
                </div>

                <div className="card">
                    <h3>Summary</h3>
                    <div className="summary-row"><div>Submitted (active):</div><div>{activeSubmittedCount}</div></div>
                    <div className="summary-row"><div>Draft slots:</div><div>{drafts.length}</div></div>
                    <div className="summary-row"><div>Grand total:</div><div className="strong">{formatINR(fees.total)}</div></div>
                    <div className="progress-wrap" title={`${filledDrafts}/${drafts.length}`}>
                        <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPercent}%` }} /></div>
                        <div className="muted">Draft filled: {filledDrafts}/{drafts.length} ({progressPercent}%)</div>
                    </div>
                    <div className="note">All Team Managers are requested to enter required fields. At least one sport is compulsory.</div>
                </div>
            </div>

            {drafts.length === 0 ? (
                <div className="card"><h4>No draft slots. Generate slots to add participants.</h4></div>
            ) : (
                <div className="card">
                    <h3>Draft Participants</h3>
                    {drafts.map((d, idx) => {
                        const ageClassOptions = getAllowedAgeClasses(d.gender, d.age);
                        const sportsOptions = allowedSportsFor(d.gender, d.ageClass);
                        return (
                            <div key={d.__localId || d.timestamp || idx} className="participant-card">
                                <div className="participant-header"><div>Participant #{idx + 1}</div><div className="muted">{d.timestamp}</div></div>

                                <div className="grid-3">
                                    <div><label>Full name <span className="required">*</span></label><input value={d.name} onChange={e => updateDraft(idx, { name: e.target.value })} /></div>
                                    <div><label>Gender <span className="required">*</span></label><select value={d.gender} onChange={e => updateDraft(idx, { gender: e.target.value })}><option value="">Select gender</option><option>Male</option><option>Female</option></select></div>
                                    <div><label>Age <span className="required">*</span></label><input type="number" min="12" max="120" value={d.age} onChange={e => updateDraft(idx, { age: e.target.value })} /></div>
                                </div>

                                <div className="grid-3">
                                    <div><label>Designation <span className="required">*</span></label><select value={d.designation} onChange={e => updateDraft(idx, { designation: e.target.value })}><option value="">Select</option>{DESIGNATIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                                    <div><label>Phone <span className="required">*</span></label><input value={d.phone} onChange={e => updateDraft(idx, { phone: e.target.value })} /></div>
                                    <div><label>Blood Type <span className="required">*</span></label><select value={d.blood} onChange={e => updateDraft(idx, { blood: e.target.value })}><option value="">Select</option>{BLOOD_TYPES.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
                                </div>

                                <div className="grid-3">
                                    <div>
                                        <label>Age class <span className="required">*</span></label>
                                        <select value={d.ageClass} onChange={e => updateDraft(idx, { ageClass: e.target.value })}>
                                            <option value="">Select</option>
                                            {ageClassOptions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                                        </select>
                                    </div>
                                    <div><label>Veg / Non-Veg <span className="required">*</span></label><select value={d.vegNon} onChange={e => updateDraft(idx, { vegNon: e.target.value })}><option value="">Select</option><option>Veg</option><option>Non Veg</option></select></div>
                                    <div><label>Upload profile photo <span className="required">*</span> <span className="muted small">JPG/PNG ≤200KB</span></label><input type="file" accept="image/jpeg,image/png" onChange={async e => { const f = e.target.files && e.target.files[0]; if (f) await handlePhotoChange(idx, f); }} />{d.photoBase64 && <img src={d.photoBase64} alt="preview" className="photo-thumb" />}</div>
                                </div>

                                <div>
                                    <label>Select up to 3 sports <span className="required">*</span></label>
                                    <div className="grid-3">
                                        {[0, 1, 2].map(i => (
                                            <select key={i} value={d.sports[i] || ""} onChange={e => { const arr = (d.sports || ["", "", ""]).slice(); arr[i] = e.target.value; updateDraft(idx, { sports: arr }); }}>
                                                <option value="">-- Sport #{i + 1} --</option>
                                                {sportsOptions.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                                            </select>
                                        ))}
                                    </div>
                                    <div className="muted small">Allowed sports shown based on selected Age class & Gender.</div>
                                </div>

                                <div className="row gap">
                                    <button className="btn" onClick={() => removeDraft(idx)}>Remove</button>
                                    <div className="muted">Validation: {(() => { const others = submitted.concat(drafts.slice(0, idx)).concat(drafts.slice(idx + 1)); const v = validateParticipant(d, others); return v.ok ? "OK" : v.message; })()}</div>
                                </div>
                            </div>
                        );
                    })}
                    <div className="row gap" style={{ marginTop: 12 }}>
                        <button className="btn primary" onClick={submitAll} disabled={loading || drafts.length === 0}>Submit All</button>
                        <button className="btn" onClick={() => { setDrafts([]); setMessage("Draft cleared"); }}>Clear Draft</button>
                    </div>
                </div>
            )}

            <div className="card">
                <h3>Combined Participants (Submitted + Draft)</h3>
                <div className="table-scroll small">
                    <table className="data-table">
                        <thead><tr><th>#</th><th>Name</th><th>Source</th><th>Sports</th><th>Gender</th><th>Status</th><th>Photo</th><th>Action</th></tr></thead>
                        <tbody>
                            {[
                                ...(submitted || []).map((r, i) => ({ key: `s-${r.id || r.timestamp || i}`, source: "submitted", row: r })),
                                ...(drafts || []).map((r, i) => ({ key: `d-${i}`, source: "draft", row: r }))
                            ].map((item, idx) => {
                                const r = item.row;
                                const sports = (r.sports || []).filter(Boolean).join(", ");
                                const status = r.status || (item.source === "draft" ? "Draft" : "Active");
                                return (
                                    <tr key={item.key} className={status === "Deleted" ? "row-deleted" : ""}>
                                        <td>{idx + 1}</td>
                                        <td>{r.name || (item.source === "draft" ? "(draft)" : "(no name)")}</td>
                                        <td>{item.source}</td>
                                        <td>{sports}</td>
                                        <td>{r.gender}</td>
                                        <td>{status}</td>
                                        <td>{r.photoBase64 ? <img src={r.photoBase64} alt="thumb" className="photo-thumb" /> : ""}</td>
                                        <td>{item.source === "submitted" ? (status === "Active" ? <button className="btn" onClick={() => requestDelete(r)}>Request Delete</button> : status === "Requested" ? <span className="muted">Requested</span> : <span className="muted">Deleted</span>) : <span className="muted">—</span>}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// -------------------- Admin Dashboard (updated: photo download + realtime) --------------------
function AdminDashboard() {
  const [rows, setRows] = useState([]);
  const [teamFilter, setTeamFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sportFilter, setSportFilter] = useState("");
  const [message, setMessage] = useState("");
  const realtimeRef = useRef(null);

  // fetch all rows from Supabase
  const fetchFromSupabase = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('participants')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) {
        console.warn('Supabase fetch error (Admin):', error);
        return null;
      }
      const normalized = (data || []).map(r => ({
        id: r.id,
        teamId: r.team_id,
        name: r.name,
        gender: r.gender,
        age: r.age,
        designation: r.designation,
        phone: r.phone,
        blood: r.blood,
        ageClass: r.age_class,
        vegNon: r.veg_non,
        sports: r.sports,
        photoBase64: r.photo_base64,
        timestamp: r.timestamp,
        status: r.status || "Active"
      }));
      setRows(normalized);
      return normalized;
    } catch (err) {
      console.error('fetchFromSupabase failed (Admin)', err);
      return null;
    }
  }, []);

  // fallback: load aggregated localStorage rows (teams store theirs locally)
  const fetchRowsLocal = useCallback(() => {
    try {
      const all = [];
      TEAM_CREDENTIALS.forEach(t => {
        try {
          const s = JSON.parse(localStorage.getItem(LS_SUBMITTED_KEY(t.teamId)) || "[]");
          if (Array.isArray(s)) s.forEach(r => all.push({ ...r, teamId: t.teamId }));
        } catch (e) { /* ignore */ }
      });
      setRows(all);
      return all;
    } catch (err) { console.warn("Could not load local rows (Admin):", err); return []; }
  }, []);

  // subscribe to realtime changes so admin sees updates live across devices
  useEffect(() => {
    let mounted = true;
    (async () => {
      const sup = await fetchFromSupabase();
      if (!sup) { fetchRowsLocal(); setMessage("Loaded local rows (Supabase fetch failed)."); }
      else setMessage("Loaded rows from Supabase.");

      try {
        // unsubscribe existing if any
        if (realtimeRef.current && realtimeRef.current.unsubscribe) {
          await realtimeRef.current.unsubscribe().catch(()=>{});
          realtimeRef.current = null;
        }

        // create a channel listening to all changes in participants table
        const channel = supabase
          .channel('public:participants:admin')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, payload => {
            // simply refetch on any change (keeps logic simple and consistent)
            fetchFromSupabase().catch(() => {});
          });

        const sub = await channel.subscribe();
        realtimeRef.current = channel;
      } catch (e) {
        console.warn('Admin realtime subscription failed', e);
      }
    })();

    return () => {
      if (realtimeRef.current && realtimeRef.current.unsubscribe) {
        realtimeRef.current.unsubscribe().catch(()=>{});
        realtimeRef.current = null;
      }
    };
  }, [fetchFromSupabase, fetchRowsLocal]);

  // Approve deletion (keeps current behavior but tries to update supabase)
  async function approveDelete(reqRow) {
    const ok = window.confirm(`Approve deletion for ${reqRow.name} (Team ${reqRow.teamId})?`);
    if (!ok) return;
    try {
      if (reqRow.id) {
        const { data, error } = await supabase.from('participants').update({ status: 'Deleted' }).eq('id', reqRow.id);
        if (error) console.warn('Supabase update failed (approveDelete):', error);
      } else {
        console.warn('No id present for row; will mark locally only.');
      }

      // mark team local storage
      try {
        const team = reqRow.teamId;
        const s = JSON.parse(localStorage.getItem(LS_SUBMITTED_KEY(team)) || "[]");
        const updated = (s || []).map(r => {
          if ((reqRow.id && r.id && String(r.id) === String(reqRow.id)) || (!reqRow.id && r.timestamp === reqRow.timestamp)) {
            return { ...r, status: "Deleted" };
          }
          return r;
        });
        localStorage.setItem(LS_SUBMITTED_KEY(team), JSON.stringify(updated));
      } catch (e) { console.error(e); }

      // update admin UI state
      setRows(prev => prev.map(r => ((reqRow.id && r.id && String(r.id) === String(reqRow.id)) || (!reqRow.id && r.timestamp === reqRow.timestamp)) ? { ...r, status: "Deleted" } : r));

      // notify team clients via event (team manager listens)
      try { window.dispatchEvent(new CustomEvent("chamba:rowDeleted", { detail: { rowId: reqRow.id || null, teamId: reqRow.teamId || null, timestamp: reqRow.timestamp || null } })); } catch (e) {}

      setMessage("Deletion approved (attempted server update; marked Deleted locally).");
    } catch (err) {
      console.error(err);
      setMessage("Error while approving delete.");
    }
  }

  // download photo helper: ensures server is checked if missing and then downloads
  async function downloadPhoto(row) {
    try {
      setMessage("Preparing photo...");

      // prefer server copy if id present (get latest)
      let photoB64 = row.photoBase64;
      if ((!photoB64 || photoB64 === "") && row.id) {
        const { data, error } = await supabase.from('participants').select('photo_base64').eq('id', row.id).single();
        if (error) {
          setMessage("Could not fetch photo from server: " + (error.message || JSON.stringify(error)));
          return;
        }
        photoB64 = data && data.photo_base64;
      }

      if (!photoB64) {
        setMessage("No photo available for this participant.");
        return;
      }

      // if value is already a data URL, use it; if it's plain base64, assume JPEG
      let dataUrl = photoB64;
      if (!/^data:/i.test(photoB64)) {
        // attempt to determine mime if possible (default jpeg)
        dataUrl = `data:image/jpeg;base64,${photoB64}`;
      }

      // fetch converted blob and trigger download
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const ext = blob.type && blob.type.split('/')[1] ? blob.type.split('/')[1].split('+')[0] : 'jpg';
      const safeName = (row.name || 'participant').replace(/[^a-z0-9_\-\.]/gi, '_').slice(0,60);
      const filename = `${row.teamId || 'team'}_${safeName}_${row.id || row.timestamp || Date.now()}.${ext}`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      setMessage("Photo downloaded");
    } catch (err) {
      console.error('downloadPhoto error', err);
      setMessage("Error downloading photo: " + (err.message || String(err)));
    }
  }

  // teams for filter dropdown
  const teams = Array.from(new Set((rows || []).map(r => r.teamId))).sort();

  // filter rows for display
  const filtered = (rows || []).filter(r => {
    if (teamFilter && r.teamId !== teamFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (sportFilter && sportFilter !== "") {
      const s = r.sports || [];
      if (!s.includes(sportFilter)) return false;
    }
    return true;
  });

  // CSV export (unchanged)
  function exportCSV() {
    const header = ['teamId','name','gender','age','designation','phone','blood','ageClass','vegNon','sports','photoBase64','timestamp','id','status'];
    const csvRows = [header, ...filtered.map(r => [ r.teamId, r.name, r.gender, r.age, r.designation, r.phone, r.blood, r.ageClass, r.vegNon, JSON.stringify(r.sports || []), r.photoBase64 ? '[BASE64]' : '', r.timestamp || '', r.id || '', r.status || '' ])];
    const csvContent = csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "chamba_registrations.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="panel admin-panel">
      <div className="panel-header">
        <h2>Admin Dashboard</h2>
        <div className="header-actions">
          <button className="btn" onClick={async () => { const sup = await fetchFromSupabase(); if (!sup) { fetchRowsLocal(); setMessage("Loaded local rows"); } else setMessage("Loaded from Supabase"); }}>Load</button>
          <button className="btn" onClick={exportCSV}>Download CSV</button>
        </div>
      </div>

      <div className="filters">
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}><option value="">All Teams</option>{teams.map(t => <option key={t} value={t}>{t}</option>)}</select>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All Statuses</option><option value="Active">Active</option><option value="Requested">Requested</option><option value="Deleted">Deleted</option></select>

        <select value={sportFilter} onChange={e => setSportFilter(e.target.value)}><option value="">All Sports</option>{SPORTS.map(s => <option key={s} value={s}>{s}</option>)}</select>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>Team</th><th>Name</th><th>Gender</th><th>Age</th><th>Sports</th><th>Status</th><th>Photo</th><th>ID</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r,i) => (
              <tr key={r.id || r.timestamp || i} className={r.status === "Deleted" ? "row-deleted" : ""}>
                <td>{i+1}</td>
                <td>{r.teamId}</td>
                <td>{r.name}</td>
                <td>{r.gender}</td>
                <td>{r.age}</td>
                <td>{(r.sports || []).filter(Boolean).join(", ")}</td>
                <td>{r.status || "Active"}</td>

                {/* Photo column: thumbnail + Download button for Active participants */}
                <td>
                  {r.photoBase64 ? <img src={r.photoBase64} alt="thumb" className="photo-thumb" /> : <span className="muted">—</span>}
                  <div style={{ marginTop: 6 }}>
                    {r.status === "Active" ? <button className="btn small" onClick={() => downloadPhoto(r)}>Download Photo</button> : <span className="muted small">No download</span>}
                  </div>
                </td>

                <td>{r.id || "-"}</td>
                <td>
                  {r.status === "Requested" ? <button className="btn" onClick={() => approveDelete(r)}>Approve Delete</button> : <span className="muted">—</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} className="muted">No rows</td></tr>}
          </tbody>
        </table>
      </div>

      {message && <div className="info-text">{message}</div>}
    </div>
  );
}
