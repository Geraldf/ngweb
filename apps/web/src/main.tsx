import { StrictMode, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import ausstattungImage from "./assets/Ausstattung.jpg";
import badezimmerImage from "./assets/BadeZimmer.jpeg";
import heroImage from "./assets/frontimage.jpg";
import gartenImage from "./assets/Garten.jpg";
import kinderzimmerImage from "./assets/Kinderzimmer.jpg";
import schlafzimmerImage from "./assets/Schlafzimmer.jpg";
import terrasseImage from "./assets/Terassse.jpg";
import wohnenKuecheImage from "./assets/Wohnen_Kueche.jpg";
import "./styles.css";

const links = ["Home", "La Casa", "Galerie", "Lage & Infos", "Preise & Kalender"];
type MediaItem = { id: string; filename: string; title: string; mimeType: string; placement: "library" | "gallery"; order: number; createdAt: string };
type GalleryPhoto = { id: string; src: string; title: string; position?: string; className?: string };

const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function App() {
  const isImpressum = window.location.pathname.replace(/\/$/, "") === "/impressum";
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePhoto, setActivePhoto] = useState<number | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [uploading, setUploading] = useState(false);

  const gallery = useMemo<GalleryPhoto[]>(() =>
    media.filter((item) => item.placement === "gallery").sort((a, b) => a.order - b.order).map((item) => ({
      id: item.id,
      src: `${apiBase}/uploads/${item.filename}`,
      title: item.title,
    })), [media]);
  const sortedMedia = useMemo(() => [...media].sort((a, b) => a.order - b.order), [media]);

  const loadMedia = async () => {
    try {
      const response = await fetch(`${apiBase}/api/media`);
      if (!response.ok) throw new Error("Die Bildbibliothek ist gerade nicht erreichbar.");
      setMedia(await response.json() as MediaItem[]);
      setMediaError("");
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Die Bildbibliothek ist gerade nicht erreichbar.");
    }
  };

  useEffect(() => { void loadMedia(); }, []);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);

  useEffect(() => {
    if (activePhoto === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePhoto(null);
      if (event.key === "ArrowRight") setActivePhoto((activePhoto + 1) % gallery.length);
      if (event.key === "ArrowLeft") setActivePhoto((activePhoto - 1 + gallery.length) % gallery.length);
    };
    document.body.classList.add("lightbox-open");
    window.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("lightbox-open"); window.removeEventListener("keydown", onKey); };
  }, [activePhoto]);

  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setMediaError("");
    try {
      for (const file of files) {
        const response = await fetch(`${apiBase}/api/media`, {
          method: "POST",
          headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
          body: file,
        });
        if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? "Upload fehlgeschlagen.");
      }
      await loadMedia();
      event.target.value = "";
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  };

  const updateMedia = async (item: MediaItem, changes: Partial<Pick<MediaItem, "title" | "placement" | "order">>) => {
    setMedia((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, ...changes } : candidate));
    const response = await fetch(`${apiBase}/api/media/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
    if (!response.ok) { setMediaError("Die Änderung konnte nicht gespeichert werden."); await loadMedia(); }
  };

  const moveMedia = async (item: MediaItem, offset: -1 | 1) => {
    const currentIndex = sortedMedia.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sortedMedia.length) return;

    const reordered = [...sortedMedia];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    const normalized = reordered.map((candidate, index) => ({ ...candidate, order: index + 1 }));
    setMedia(normalized);
    setMediaError("");

    try {
      const response = await fetch(`${apiBase}/api/media/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: normalized.map((candidate) => candidate.id) }),
      });
      if (!response.ok) throw new Error();
      setMedia(await response.json() as MediaItem[]);
    } catch {
      setMediaError("Die Reihenfolge konnte nicht gespeichert werden.");
      await loadMedia();
    }
  };

  const deleteMedia = async (item: MediaItem) => {
    if (!window.confirm(`„${item.title}“ endgültig löschen?`)) return;
    const response = await fetch(`${apiBase}/api/media/${item.id}`, { method: "DELETE" });
    if (response.ok) setMedia((current) => current.filter((candidate) => candidate.id !== item.id));
    else setMediaError("Das Bild konnte nicht gelöscht werden.");
  };

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/#home" aria-label="Casa Baia Sant'Anna – Startseite">
          <span className="brand-mark">CB</span>
          <span className="brand-copy"><strong>Casa Baia</strong><small>Sant’Anna · Sardegna</small></span>
        </a>
        <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Menü öffnen">
          <span>Menü</span><i /><i />
        </button>
      </header>

      <button className="manage-button" onClick={() => setManagerOpen(true)} aria-label="Bilder verwalten">Bilder verwalten</button>

      <div className={`menu-panel ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}>
        <button className="close-button" onClick={() => setMenuOpen(false)} aria-label="Menü schließen">Schließen <span>×</span></button>
        <nav>{links.map((link, i) => <a key={link} href={["/#home", "/#casa", "/#galerie", "/#lage", "/#preise"][i]} onClick={() => setMenuOpen(false)}><small>0{i + 1}</small>{link}</a>)}</nav>
        <p>Sardinien, Italien<br />info@casa-baia-sant-anna.com</p>
      </div>

      {isImpressum ? <main className="legal-page">
        <section className="legal-hero">
          <p className="eyebrow">Rechtliche Hinweise</p>
          <h1>Impressum</h1>
        </section>
        <section className="legal-content">
          <div className="section-number">01 <span /></div>
          <div className="legal-details">
            <h2>Casa Baia<br /><em>Sant’Anna</em></h2>
            <div className="legal-copy">
              <p>Susanne Adrian-Fuchs &amp; Gerald Fuchs</p>
              <address>Chemnitzer Strasse 8<br />78658 Zimmern o.R.<br />Deutschland</address>
              <p><a href="tel:+4974134898934">+49 (0) 741 34898934</a><br /><a href="mailto:info@casa-baia-sant-anna.com">info@casa-baia-sant-anna.com</a><br /><a href="https://www.casa-baia-sant-anna.com">www.casa-baia-sant-anna.com</a></p>
              <hr />
              <h3>Online-Streitbeilegung</h3>
              <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit. Die Plattform finden Sie unter: <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noreferrer">ec.europa.eu/consumers/odr</a>.</p>
              <p>Als Kunde haben Sie jederzeit die Möglichkeit, die Schlichtungsstelle der Europäischen Kommission zu kontaktieren. Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle der Europäischen Kommission teilzunehmen.</p>
              <p className="site-credit"><strong>Internetauftritt</strong><br />Gerald Fuchs</p>
            </div>
          </div>
        </section>
      </main> : <main id="home">
        <section className="hero" style={{ backgroundImage: `url(${heroImage})` }}>
          <div className="hero-shade" />
          <div className="hero-content">
            <p className="eyebrow">Ein Rückzugsort am Meer</p>
            <h1>Benvenuti<br />in Sardegna</h1>
            <a href="#entdecken" className="round-link" aria-label="Mehr entdecken"><span>Entdecken</span><b>↓</b></a>
          </div>
          <p className="hero-note">40° 42' N<br />9° 43' E</p>
        </section>

        <section className="welcome" id="entdecken">
          <div className="section-number">01 <span /></div>
          <div className="welcome-heading">
            <p className="eyebrow dark">Willkommen</p>
            <h2>Ein Ort, der<br /><em>bleibt.</em></h2>
          </div>
          <div className="welcome-copy">
            <p className="lead">Zwischen duftender Macchia und dem glasklaren Wasser Sardiniens liegt ein Zuhause für stille, sonnige Tage.</p>
            <p>Unser Ferienhaus verbindet Ruhe, Natur und mediterrane Leichtigkeit. Die Küste beginnt fast vor der Haustür, während der Blick weit über die ursprüngliche Landschaft bis zu den Bergen schweift.</p>
            <p>Wir haben diesen besonderen Platz geschaffen, um anzukommen, loszulassen und die einfachen Dinge wieder bewusst zu genießen.</p>
            <p className="signature">Susanne &amp; Gerald</p>
            <a className="text-link" href="#casa">Die Casa kennenlernen <span>→</span></a>
          </div>
        </section>

        <section className="quote" id="casa">
          <p>La dolce vita</p>
          <blockquote>„Zuhause ist kein Ort –<br />Zuhause ist ein Gefühl.“</blockquote>
        </section>
        <section className="casa-section" aria-labelledby="casa-title">
          <div className="casa-intro">
            <div className="section-number">03 <span /></div>
            <div className="casa-heading">
              <p className="eyebrow dark">La Casa</p>
              <h2 id="casa-title">Unser<br /><em>Wohlfühlort.</em></h2>
            </div>
            <div className="casa-copy">
              <p className="lead">Hier finden wir Ruhe, Entspannung und neue Energie – unser ganz persönlicher Rückzugsort, um die Seele baumeln zu lassen und den Alltag hinter uns zu lassen.</p>
              <p>Direkt am Naturschutzgebiet gelegen, bietet unser Ferienhaus einen atemberaubenden Panoramablick über die sardische Landschaft bis hin zu den Bergen. Umgeben von der immergrünen, duftenden Macchia erleben wir abends spektakuläre Sonnenuntergänge, die den Himmel in warmen Farben erstrahlen lassen.</p>
              <p>Von unserem Haus aus erreichen Sie den wunderschönen Sandstrand Porto Ainu bequem zu Fuß. Ein malerischer Küstenweg führt von dort, vorbei an einer Strandbar und durch einen duftenden Pinienwald, weiter zu den Stränden Sant’Anna, Sa Capannizza und Budoni – ein Paradies für Spaziergänger und Naturliebhaber.</p>
            </div>
          </div>

          <div className="casa-details">
            <article className="casa-feature casa-feature-main">
              <img className="casa-feature-image" src={ausstattungImage} alt="Helle, moderne Ausstattung der Casa" loading="lazy" />
              <p className="feature-number">01</p>
              <div><h3>Ausstattung</h3><p>Unsere neue Casa ist hell, modern und gemütlich eingerichtet. Wir haben großen Wert auf eine gute und komfortable Ausstattung gelegt, damit das Haus zu jeder Jahreszeit genutzt werden kann.</p><p>Das Haus umfasst einen offenen Wohn- und Essbereich mit gut ausgestatteter Küche, eine angrenzende große Terrasse mit Privatpool, zwei Schlafzimmer und ein Badezimmer. Kostenloses WLAN ist überall verfügbar. Moderne Klimageräte befinden sich in den Schlafräumen und im Wohn- und Essbereich. Alle Fenster sind mit hochwertigen, beweglichen Jalousien und Fliegengittern versehen.</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={wohnenKuecheImage} alt="Offener Wohnbereich mit Küche" loading="lazy" />
              <p className="feature-number">02</p>
              <div><h3>Wohnen &amp; Küche</h3><p>Flat-TV mit Satellitenempfang und Amazon Fire TV Stick · Klimaanlage und Heizung · kostenloses WLAN · Sofa · Geschirrspüler · Gasherd · Backofen · Kühlschrank mit Gefrierfach · Mikrowelle · Lavazza Kaffee- und Espressomaschine · gute Küchenausstattung</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={terrasseImage} alt="Terrasse mit Blick in die sardische Landschaft" loading="lazy" />
              <p className="feature-number">03</p>
              <div><h3>Terrasse</h3><p>Die große Terrasse mit angrenzendem Privatpool bietet einen unverbauten Panoramablick. Hier befinden sich die Außendusche mit Warmwasser, die praktische Außenküche und, separat untergebracht, die Waschmaschine.</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={badezimmerImage} alt="Badezimmer der Casa" loading="lazy" />
              <p className="feature-number">04</p>
              <div><h3>Badezimmer</h3><p>Geräumig und mit Fenster · Waschbecken · Dusche · WC · Bidet · Ablageflächen</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={schlafzimmerImage} alt="Schlafzimmer mit Doppelbett" loading="lazy" />
              <p className="feature-number">05</p>
              <div><h3>Schlafzimmer</h3><p>Doppelbett 160 × 200 cm · Klimaanlage und Heizung · großer Kleiderschrank · Kommode · Spiegel · Nachttische · direkter Zugang zum Außenbereich</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={kinderzimmerImage} alt="Schlafzimmer mit zwei Einzelbetten" loading="lazy" />
              <p className="feature-number">06</p>
              <div><h3>Schlafzimmer</h3><p>Zwei Einzelbetten 90 × 200 cm, als Doppelbett 180 × 200 cm nutzbar · Klimaanlage und Heizung · Kleiderschrank · Nachttische</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={gartenImage} alt="Mediterran angelegter Garten" loading="lazy" />
              <p className="feature-number">07</p>
              <div><h3>Garten</h3><p>Der große Garten grenzt an ein Naturschutzgebiet und ist terrassenartig und liebevoll mediterran angelegt. Der Blick schweift weit in die reizvolle, landestypische Natur. Es gibt viel Platz für Ruhe und Privatsphäre.</p></div>
            </article>
            <article className="casa-feature">
              <p className="feature-number">08</p>
              <div><h3>Zugang &amp; Parken</h3><p>Das Grundstück ist mit einem abschließbaren Tor gesichert. Dahinter befindet sich der Pkw-Stellplatz; weitere Parkmöglichkeiten liegen direkt am Grundstück.</p></div>
            </article>
          </div>
        </section>
        <section className="gallery-section" id="galerie">
          <div className="gallery-intro">
            <div className="section-number">02 <span /></div>
            <div><p className="eyebrow dark">Impressionen</p><h2>Augenblicke<br /><em>am Meer.</em></h2></div>
            <p>Ein Haus zwischen Himmel und Macchia. Entdecken Sie die stillen Ecken, das warme Licht und den Blick auf Sardiniens Küste.</p>
          </div>
          <div className="gallery-grid">
            {gallery.map((photo, index) => <button className={`gallery-card ${photo.className ?? ""}`} key={photo.id} onClick={() => setActivePhoto(index)} aria-label={`${photo.title} vergrößern`}>
              <img src={photo.src} style={{ objectPosition: photo.position }} alt={photo.title} loading="lazy" />
              <span className="gallery-overlay"><small>{String(index + 1).padStart(2, "0")}</small><b>＋</b></span>
            </button>)}
          </div>
        </section>


      </main>}

      {activePhoto !== null && <div className="lightbox" role="dialog" aria-modal="true" aria-label="Bildergalerie" onClick={() => setActivePhoto(null)}>
        <button className="lightbox-close" onClick={() => setActivePhoto(null)} aria-label="Galerie schließen">Schließen <span>×</span></button>
        <button className="lightbox-arrow" onClick={(e) => { e.stopPropagation(); setActivePhoto((activePhoto - 1 + gallery.length) % gallery.length); }} aria-label="Vorheriges Bild">←</button>
        <figure onClick={(e) => e.stopPropagation()}><img src={gallery[activePhoto].src} style={{ objectPosition: gallery[activePhoto].position }} alt={gallery[activePhoto].title} /><figcaption><span>{String(activePhoto + 1).padStart(2, "0")} / {String(gallery.length).padStart(2, "0")}</span></figcaption></figure>
        <button className="lightbox-arrow" onClick={(e) => { e.stopPropagation(); setActivePhoto((activePhoto + 1) % gallery.length); }} aria-label="Nächstes Bild">→</button>
      </div>}

      {managerOpen && <div className="media-manager" role="dialog" aria-modal="true" aria-labelledby="media-title">
        <div className="manager-header">
          <div><p className="eyebrow">Website-Inhalte</p><h2 id="media-title">Bilder verwalten</h2></div>
          <button className="manager-close" onClick={() => setManagerOpen(false)} aria-label="Bildverwaltung schließen">×</button>
        </div>
        <div className="manager-toolbar">
          <label className={`upload-button ${uploading ? "is-busy" : ""}`}>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={uploadImages} disabled={uploading} />
            {uploading ? "Wird hochgeladen …" : "＋ Bilder hochladen"}
          </label>
          <p>JPEG, PNG, WebP oder GIF · maximal 10 MB</p>
          <p className="order-hint">Reihenfolge mit ↑ und ↓ festlegen</p>
        </div>
        {mediaError && <p className="manager-error" role="alert">{mediaError}</p>}
        {media.length === 0 ? <div className="manager-empty"><strong>Noch keine eigenen Bilder</strong><span>Geladene Bilder erscheinen hier und zunächst direkt in der Galerie.</span></div> :
          <div className="media-list">{sortedMedia.map((item, index) => <article className="media-row" key={item.id}>
            <span className="media-number" aria-label={`Bild Nummer ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
            <img src={`${apiBase}/uploads/${item.filename}`} alt="" />
            <div className="media-fields">
              <label>Bildtitel<input value={item.title} onChange={(event) => setMedia((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, title: event.target.value } : candidate))} onBlur={(event) => void updateMedia(item, { title: event.target.value })} /></label>
              <label>Platzierung<select value={item.placement} onChange={(event) => void updateMedia(item, { placement: event.target.value as MediaItem["placement"] })}><option value="gallery">In der Galerie</option><option value="library">Nur Bibliothek</option></select></label>
            </div>
            <div className="media-actions">
              <button disabled={index === 0} onClick={() => void moveMedia(item, -1)} aria-label={`${item.title} nach oben verschieben`}>↑</button>
              <button disabled={index === sortedMedia.length - 1} onClick={() => void moveMedia(item, 1)} aria-label={`${item.title} nach unten verschieben`}>↓</button>
              <button className="delete-button" onClick={() => void deleteMedia(item)}>Löschen</button>
            </div>
          </article>)}</div>}
      </div>}

      <footer><a className="brand footer-brand" href="/#home"><span className="brand-mark">CB</span><span className="brand-copy"><strong>Casa Baia</strong><small>Sant’Anna · Sardegna</small></span></a><p>© 2026 Casa Baia Sant’Anna</p><p><a href="/impressum">Impressum</a> &nbsp; · &nbsp; Datenschutz</p></footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
