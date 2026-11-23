// wetter-verlauf-karte v1.0.0
// Einzeln installierbares Modul (Home Assistant Marketplace / HACS, Kategorie Dashboard).
window.customCards = window.customCards || [];
window.customCardFeatures = window.customCardFeatures || [];
// Eigener Block: Namen bleiben lokal, auch wenn mehrere Karten zusammen geladen werden.
{
// ---------------------------------------------------------------------------
// Wetter-Verlauf-Karte: gemessene Werte der eigenen Wetterstation aus der Langzeitstatistik,
// gleiche Optik wie die Wetter-Karte, mit Zeitraumwahl und Blaettern.
// Tage: Hoechst-/Tiefstwert, Regen, Wind (Mittel + staerkste Boee); Stunden: Mittelwert, Regen, Wind.
//
//   type: custom:wetter-verlauf-karte
//   temperatur: sensor.wetterstation_outdoor_temperature
//   regen: sensor.wetterstation_total_rain        # Zaehler (Summe), pro Tag/Stunde wird die Aenderung genommen
//   wind: sensor.wetterstation_wind_speed
//   boee: sensor.wetterstation_wind_gust
//   luftdruck: sensor.wetterstation_relative_pressure   # optional, als Kurve im unteren Bereich

const TYPE9 = "wetter-verlauf-karte";

class WetterVerlaufKarte extends HTMLElement {
  setConfig(c) {
    if (!c?.temperatur) throw new Error("temperatur fehlt");
    this._config = {
      zeitraeume: [{ t: "24 Std", n: 24, p: "hour" }, { t: "7 Tage", n: 7, p: "day" }, { t: "14 Tage", n: 14, p: "day" }, { t: "30 Tage", n: 30, p: "day" }],
      ...c,
    };
    this._key = `wetter-verlauf-karte:${c.temperatur}`;
    let i = NaN;
    try { i = Number(localStorage.getItem(this._key)); } catch (e) { /* kein Speicher */ }
    this._zr = this._config.zeitraeume[i] ? i : Math.max(0, this._config.zeitraeume.findIndex((z) => z.n === 7 && z.p === "day"));
    this._seite = 0;
    this._daten = null;
    this._render();
  }

  set hass(hass) {
    const erst = !this._hass;
    this._hass = hass;
    if (erst || Date.now() - (this._geladen || 0) > 10 * 60 * 1000) this._laden();
  }

  connectedCallback() {
    if (!this._ro) this._ro = new ResizeObserver(() => this._zeichnen());
    this._ro.observe(this);
  }
  disconnectedCallback() { this._ro?.disconnect(); }

  get _z() { return this._config.zeitraeume[this._zr]; }

  _fenster() {
    const { n, p } = this._z, s = this._seite, jetzt = new Date();
    if (p === "hour") {
      const ende = new Date(jetzt); ende.setMinutes(0, 0, 0); ende.setHours(ende.getHours() + 1 - s * n);
      const start = new Date(ende); start.setHours(start.getHours() - n);
      return { start, ende };
    }
    const ende = new Date(jetzt); ende.setHours(0, 0, 0, 0); ende.setDate(ende.getDate() + 1 - s * n);
    const start = new Date(ende); start.setDate(start.getDate() - n);
    return { start, ende };
  }

  _schluessel(d) {
    return this._z.p === "hour" ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}` : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  async _laden() {
    if (!this._hass || !this._config) return;
    const nr = (this._ladeNr = (this._ladeNr || 0) + 1);
    const { start, ende } = this._fenster(), c = this._config, p = this._z.p;
    this._geladen = Date.now();
    this._fehler = null;
    const ids = [c.temperatur, c.regen, c.wind, c.boee, c.luftdruck].filter(Boolean);
    let r = {};
    try {
      r = await this._hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(), end_time: ende.toISOString(),
        statistic_ids: ids, period: p, types: ["mean", "min", "max", "change"] });
    } catch (e) { if (nr === this._ladeNr) this._fehler = String(e?.message || e); }
    if (nr !== this._ladeNr) return;
    const tabelle = (id) => {
      const m = new Map();
      for (const z of (id && r[id]) || []) m.set(this._schluessel(new Date(typeof z.start === "number" ? z.start : Date.parse(z.start))), z);
      return m;
    };
    const T = tabelle(c.temperatur), R = tabelle(c.regen), W = tabelle(c.wind), B = tabelle(c.boee), L = tabelle(c.luftdruck);
    const spalten = [];
    const t = new Date(start);
    for (let i = 0; i < 1000 && t < ende; i++) {
      const k = this._schluessel(t);
      spalten.push({ d: new Date(t), t: T.get(k), regen: R.get(k)?.change, wind: W.get(k)?.mean, boee: B.get(k)?.max, druck: L.get(k)?.mean });
      if (p === "hour") t.setHours(t.getHours() + 1); else t.setDate(t.getDate() + 1);
    }
    this._daten = { spalten, start, ende, p };
    this._zeichnen();
  }

  _zahl(v, st = 1) { return Number(v).toLocaleString("de-DE", { maximumFractionDigits: st }); }

  _einheit(id, std) { return this._hass?.states[id]?.attributes?.unit_of_measurement || std; }

  _bereichText() {
    const { start, ende } = this._daten && this._daten.p === this._z.p ? this._daten : this._fenster();
    const f = (d) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
    const letzt = new Date(ende);
    if (this._z.p === "hour") { letzt.setHours(letzt.getHours() - 1); return `${f(start)} ${start.getHours()}:00 – ${f(letzt)} ${letzt.getHours()}:59`; }
    letzt.setDate(letzt.getDate() - 1);
    return `${f(start)} – ${f(letzt)}${letzt.getFullYear()}`;
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px 16px 10px; box-sizing: border-box; }
        .summe { font-size: 13px; color: var(--secondary-text-color); margin-bottom: 4px; }
        .nav { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
        .bereich { font-size: 13px; color: var(--primary-text-color); min-width: 130px; text-align: center; }
        .platz { flex: 1; }
        button { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 16px; cursor: pointer;
          border: 1px solid var(--divider-color, #555); background: transparent; color: var(--primary-text-color); }
        button.pfeil { padding: 2px 10px; font-size: 16px; line-height: 1.2; }
        button:disabled { opacity: 0.35; cursor: default; }
        button.aktiv { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        .scroll { overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
        .zeile { display: flex; }
        .zeile > div { flex: none; text-align: center; }
        .zeit { font-size: 13px; color: var(--primary-text-color); }
        .zeit small { display: block; font-size: 11px; color: var(--secondary-text-color); }
        .wind { font-size: 12px; color: var(--primary-text-color); line-height: 1.3; padding-top: 2px; }
        .wind small { display: block; font-size: 11px; color: var(--secondary-text-color); }
        .wind ha-icon { --mdc-icon-size: 16px; color: #81c784; }
        .legende { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: var(--secondary-text-color); margin-top: 6px; }
        .legende i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }
        .legende i.balken { width: 7px; height: 10px; }
        .meldung { font-size: 13px; color: var(--secondary-text-color); padding: 20px 0; text-align: center; }
      </style>
      <ha-card>
        <div class="summe"></div>
        <div class="nav">
          <button class="pfeil zur" title="zurück">‹</button>
          <span class="bereich"></span>
          <button class="pfeil vor" title="vor">›</button>
          <span class="platz"></span>
          <span class="zr"></span>
        </div>
        <div class="scroll"><div class="inhalt"></div></div>
        <div class="legende"></div>
      </ha-card>`;
    const r = this.shadowRoot;
    r.querySelector(".zur").addEventListener("click", () => { this._seite++; this._laden(); this._zeichnen(); });
    r.querySelector(".vor").addEventListener("click", () => { if (this._seite > 0) { this._seite--; this._laden(); this._zeichnen(); } });
    const zr = r.querySelector(".zr");
    this._config.zeitraeume.forEach((z, i) => {
      const b = document.createElement("button");
      b.textContent = z.t; b.dataset.i = String(i);
      b.addEventListener("click", () => {
        if (i === this._zr) return;
        this._zr = i; this._seite = 0; this._daten = null;
        try { localStorage.setItem(this._key, String(i)); } catch (e) { /* kein Speicher */ }
        this._laden(); this._zeichnen();
      });
      zr.appendChild(b);
    });
    this._zeichnen();
  }

  _pille(x, y, text, farbe) {
    const b = Math.max(34, text.length * 7.2 + 14);
    return `<g><rect x="${x - b / 2}" y="${y - 12}" width="${b}" height="24" rx="12" fill="var(--card-background-color, #1c1c1c)" stroke="${farbe}" stroke-width="2"/>
      <text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="13" fill="var(--primary-text-color)">${text}</text></g>`;
  }

  _zeichnen() {
    const r = this.shadowRoot, c = this._config;
    if (!r || !c) return;
    r.querySelectorAll(".zr button").forEach((b) => b.classList.toggle("aktiv", Number(b.dataset.i) === this._zr));
    r.querySelector(".vor").disabled = this._seite === 0;
    r.querySelector(".bereich").textContent = this._bereichText();
    const inhalt = r.querySelector(".inhalt"), legende = r.querySelector(".legende"), summe = r.querySelector(".summe");
    const d = this._daten;
    if (this._fehler) { inhalt.innerHTML = `<div class="meldung">Fehler: ${this._fehler}</div>`; return; }
    if (!d || d.p !== this._z.p) { inhalt.innerHTML = `<div class="meldung">Lade …</div>`; return; }
    const tag = d.p === "day", sp0 = d.spalten;
    const eT = this._einheit(c.temperatur, "°C"), eR = this._einheit(c.regen, "mm"), eW = this._einheit(c.wind, "km/h");
    const hoch = sp0.map((x) => (tag ? x.t?.max : x.t?.mean)).filter((v) => v != null);
    const tief = tag ? sp0.map((x) => x.t?.min).filter((v) => v != null) : [];
    if (!hoch.length) { inhalt.innerHTML = `<div class="meldung">Keine Messwerte in diesem Zeitraum</div>`; summe.textContent = ""; legende.innerHTML = ""; return; }
    const regen = sp0.reduce((s, x) => s + (x.regen > 0 ? x.regen : 0), 0);
    const boeen = sp0.map((x) => x.boee).filter((v) => v != null);
    const eL = this._einheit(c.luftdruck, "hPa"), drucke = sp0.map((x) => x.druck).filter((v) => v != null);
    const dMin = drucke.length ? Math.min(...drucke) : null, dMax = drucke.length ? Math.max(...drucke) : null;
    summe.textContent = [`Höchst ${this._zahl(Math.max(...hoch))} ${eT}`, `Tiefst ${this._zahl(Math.min(...(tief.length ? tief : hoch)))} ${eT}`,
      c.regen ? `Regen ${this._zahl(regen)} ${eR}` : null, boeen.length ? `stärkste Böe ${this._zahl(Math.max(...boeen), 0)} ${eW}` : null,
      drucke.length ? `Luftdruck ${this._zahl(dMin, 0)}–${this._zahl(dMax, 0)} ${eL}` : null].filter(Boolean).join(" · ");

    const breite = Math.max(200, r.querySelector(".scroll").clientWidth || this.clientWidth || 360);
    const sp = Math.max(tag ? 54 : 56, breite / sp0.length);
    const W = sp * sp0.length, H = 200, oben = 26, hoehe = 80, basis = H - 20, zone = 52;
    const alle = [...hoch, ...tief], min = Math.min(...alle), max = Math.max(...alle), spanne = max - min || 1;
    const y = (t) => oben + (1 - (t - min) / spanne) * hoehe, xm = (i) => sp * i + sp / 2;
    const linie = (f) => sp0.map((x, i) => (f(x) != null ? `${xm(i)},${y(f(x))}` : null)).filter(Boolean).join(" ");
    const orange = "#ff9800", blau = "#4fc3f7";
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    for (let i = 0; i <= sp0.length; i++) svg += `<line x1="${sp * i}" x2="${sp * i}" y1="0" y2="${H - 6}" stroke="var(--divider-color, #444)" stroke-width="1" opacity="0.5"/>`;
    svg += `<line x1="0" x2="${W}" y1="${basis}" y2="${basis}" stroke="var(--divider-color, #444)" stroke-width="1"/>`;
    // Regen als Balken (Skala mind. 5 mm stuendlich / 10 mm taeglich)
    const regenF = "#4fc3f7", grau = "#90a4ae";
    const skalaN = Math.max(tag ? 10 : 5, ...sp0.map((x) => (x.regen > 0 ? x.regen : 0))), bw = Math.min(28, sp * 0.45);
    sp0.forEach((x, i) => {
      if (x.regen == null || x.regen < 0.05) return;
      const h = Math.max(2, x.regen / skalaN * zone);
      svg += `<rect x="${xm(i) - bw / 2}" y="${basis - h}" width="${bw}" height="${h}" rx="3" fill="${regenF}" opacity="0.75"/>`;
      svg += `<text x="${xm(i)}" y="${basis + 14}" text-anchor="middle" font-size="11" fill="var(--primary-text-color)">${this._zahl(x.regen)} ${eR}</text>`;
    });
    // Luftdruck als Kurve im unteren Bereich (eigene Skala, mind. 10 hPa Spanne)
    if (drucke.length) {
      const mitte = (dMin + dMax) / 2, halb = Math.max(5, (dMax - dMin) / 2), lo = mitte - halb, sp2 = halb * 2;
      const yL = (v) => basis - 4 - (v - lo) / sp2 * (zone - 10);
      svg += `<polyline points="${sp0.map((x, i) => (x.druck != null ? `${xm(i)},${yL(x.druck)}` : null)).filter(Boolean).join(" ")}" fill="none" stroke="${grau}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      const iMax = sp0.findIndex((x) => x.druck === dMax), iMin = sp0.findIndex((x) => x.druck === dMin);
      const marke = (i, v, oben) => `<circle cx="${xm(i)}" cy="${yL(v)}" r="2.5" fill="${grau}"/><text x="${xm(i)}" y="${yL(v) + (oben ? -6 : 13)}" text-anchor="middle" font-size="11" fill="${grau}">${this._zahl(v, 0)}</text>`;
      svg += marke(iMax, dMax, true);
      if (iMin !== iMax) svg += marke(iMin, dMin, false);
    }
    const fHoch = (x) => (tag ? x.t?.max : x.t?.mean), fTief = (x) => x.t?.min;
    svg += `<polyline points="${linie(fHoch)}" fill="none" stroke="${orange}" stroke-width="2"/>`;
    if (tag) svg += `<polyline points="${linie(fTief)}" fill="none" stroke="${blau}" stroke-width="2"/>`;
    sp0.forEach((x, i) => {
      if (fHoch(x) != null) svg += this._pille(xm(i), y(fHoch(x)), `${this._zahl(fHoch(x), tag ? 0 : 1)}°`, orange);
      if (tag && fTief(x) != null) svg += this._pille(xm(i), y(fTief(x)), `${this._zahl(fTief(x), 0)}°`, blau);
    });
    svg += `</svg>`;
    const zeit = (dt) => tag
      ? `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][dt.getDay()]}<small>${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.</small>`
      : `${String(dt.getHours()).padStart(2, "0")}:00`;
    const wind = (x) => x.wind == null && x.boee == null ? "–"
      : `<ha-icon icon="mdi:weather-windy"></ha-icon> ${x.wind != null ? this._zahl(x.wind, 0) : "–"}<small>Böe ${x.boee != null ? this._zahl(x.boee, 0) : "–"}</small>`;
    inhalt.style.width = `${W}px`;
    inhalt.innerHTML = `
      <div class="zeile">${sp0.map((x) => `<div class="zeit" style="width:${sp}px">${zeit(x.d)}</div>`).join("")}</div>
      ${svg}
      ${c.wind || c.boee ? `<div class="zeile">${sp0.map((x) => `<div class="wind" style="width:${sp}px">${wind(x)}</div>`).join("")}</div>` : ""}`;
    legende.innerHTML = (tag ? `<span><i style="background:${orange}"></i>Höchstwert</span><span><i style="background:${blau}"></i>Tiefstwert</span>`
      : `<span><i style="background:${orange}"></i>Temperatur (Mittel)</span>`)
      + (c.regen ? `<span><i class="balken" style="background:${regenF}"></i>Regen (${eR})</span>` : "")
      + (drucke.length ? `<span><i style="background:${grau}"></i>Luftdruck (${eL}, Höchst/Tiefst beschriftet)</span>` : "")
      + (c.wind || c.boee ? `<span><i style="background:#81c784"></i>Wind Ø / stärkste Böe (${eW})</span>` : "");
  }

  getCardSize() { return 7; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
}

if (!customElements.get(TYPE9)) customElements.define(TYPE9, WetterVerlaufKarte);
if (!window.customCards.some((c) => c.type === TYPE9)) {
  window.customCards.push({ type: TYPE9, name: "Wetter-Verlauf-Karte", description: "Gemessene Wetterwerte (Temperatur, Regen, Wind, Luftdruck) mit Zeitraumwahl und Blättern" });
}

// Eingabemaske (visueller Editor) und Startwerte
{
  const ids = (hass) => Object.keys(hass?.states ?? {});
  const finde = (hass, re, dom = "sensor.") => ids(hass).find((id) => id.startsWith(dom) && re.test(id)) || "";
  const ent = (domain, extra = {}) => ({ entity: { filter: { domain, ...extra } } });
  const nummer = (min, max, step = 1, unit) => ({ number: { min, max, step, mode: "box", ...(unit ? { unit_of_measurement: unit } : {}) } });
  const auswahl = (opts) => ({ select: { mode: "dropdown", options: opts.map(([value, label]) => ({ value, label })) } });
  const text = { text: {} };
  const formular = (schema, labels, hilfen = {}) => () => ({
    schema,
    computeLabel: (s) => labels[s.name] ?? s.name,
    computeHelper: (s) => hilfen[s.name],
  });
  const setze = (typ, form, stub) => {
    const K = customElements.get(typ);
    if (!K) return;
    if (form) K.getConfigForm = form;
    if (stub) K.getStubConfig = (hass) => Object.fromEntries(Object.entries(stub(hass)).filter(([, v]) => v !== ""));
  };
  setze("wetter-verlauf-karte",
    formular([
      { name: "temperatur", required: true, selector: ent("sensor") },
      { name: "regen", selector: ent("sensor") },
      { name: "wind", selector: ent("sensor") },
      { name: "boee", selector: ent("sensor") },
      { name: "luftdruck", selector: ent("sensor") },
    ], { temperatur: "Außentemperatur", regen: "Regen (Gesamtzähler)", wind: "Windgeschwindigkeit", boee: "Windböe", luftdruck: "Luftdruck" },
    { regen: "Ein Zähler, der aufsummiert (z. B. total_rain); pro Stunde/Tag wird die Änderung genommen" }),
    (hass) => ({ temperatur: finde(hass, /outdoor_temperature|aussen.*temp/), regen: finde(hass, /total_rain/),
      wind: finde(hass, /wind_speed/), boee: finde(hass, /wind_gust/), luftdruck: finde(hass, /relative_pressure|pressure/) }));
}
}

console.info("%c wetter-verlauf-karte %c v1.0.0 ", "color:#fff;background:#03a9f4;font-weight:700", "color:#03a9f4");
