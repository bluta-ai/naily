import { useMemo, useState } from "react";
import { defaultParams, getPattern, measureNail, type Design, type NailOutline } from "@naily/core";
import { detectLang, dictionaries, I18nContext, type Lang } from "./i18n.ts";
import { collectOutlines, loadProfile, saveProfile, type Photo, type PhotoNail } from "./state.ts";
import { CaptureStep } from "./components/CaptureStep.tsx";
import { PhotoMarker } from "./components/PhotoMarker.tsx";
import { ReviewStep } from "./components/ReviewStep.tsx";
import { DesignStep } from "./components/DesignStep.tsx";
import { OrderStep } from "./components/OrderStep.tsx";

type Step = "intro" | "capture" | "mark" | "review" | "design" | "order" | "done";
const STEPS: Step[] = ["capture", "mark", "review", "design", "order"];

const initialDesign = (): Design => ({ main: { patternId: "french", params: defaultParams(getPattern("french")!) } });

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = dictionaries[lang];
  const [step, setStep] = useState<Step>("intro");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activePhoto, setActivePhoto] = useState(0);
  const [savedNails, setSavedNails] = useState<NailOutline[] | null>(loadProfile);
  /** Set when the customer reuses a saved profile instead of scanning. */
  const [profileNails, setProfileNails] = useState<NailOutline[] | null>(null);
  const [design, setDesign] = useState<Design>(initialDesign);
  const [orderId, setOrderId] = useState<string | null>(null);

  const outlines = useMemo(() => profileNails ?? collectOutlines(photos).complete, [photos, profileNails]);
  const measured = useMemo(() => outlines.map(measureNail), [outlines]);
  const placed = useMemo(() => new Set(photos.flatMap((p) => p.nails.map((n) => n.finger))), [photos]);

  const updatePhoto = (photo: Photo) => setPhotos((ps) => ps.map((p) => (p.id === photo.id ? photo : p)));

  // A finger lives on exactly one photo: placing it here removes it from the others.
  const placeNail = (photoId: string, nail: PhotoNail) =>
    setPhotos((ps) =>
      ps.map((p) => {
        const others = p.nails.filter((n) => n.finger !== nail.finger);
        return { ...p, nails: p.id === photoId ? [...others, nail] : others };
      }),
    );

  function restart() {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setProfileNails(null);
    setDesign(initialDesign());
    setOrderId(null);
    setSavedNails(loadProfile());
    setStep("intro");
  }

  const stepIndex = STEPS.indexOf(step);
  const photo = photos[Math.min(activePhoto, photos.length - 1)];

  return (
    <I18nContext.Provider value={{ t, lang }}>
      <header className="top">
        <button className="brand" onClick={restart}>
          Naily <span>甲印</span>
        </button>
        <button className="link" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
          {lang === "zh" ? "EN" : "中文"}
        </button>
      </header>

      {stepIndex >= 0 && (
        <ol className="stepper">
          {t.steps.map((label, i) => (
            <li key={label} className={i === stepIndex ? "current" : i < stepIndex ? "done" : ""}>
              {label}
            </li>
          ))}
        </ol>
      )}

      <main>
        {step === "intro" && (
          <section className="card intro">
            <h1>{t.tagline}</h1>
            <ol>
              <li>{t.intro1}</li>
              <li>{t.intro2}</li>
              <li>{t.intro3}</li>
            </ol>
            <p className="muted small">{t.privacy}</p>
            <div className="row">
              <button className="primary" onClick={() => setStep("capture")}>
                {t.start}
              </button>
              {savedNails && (
                <button
                  onClick={() => {
                    setProfileNails(savedNails);
                    setStep("review");
                  }}
                >
                  {t.useSaved}
                </button>
              )}
            </div>
          </section>
        )}

        {step === "capture" && (
          <CaptureStep
            photos={photos}
            onAdd={(p) => setPhotos((ps) => [...ps, p])}
            onRemove={(id) =>
              setPhotos((ps) => {
                const gone = ps.find((p) => p.id === id);
                if (gone) URL.revokeObjectURL(gone.url);
                return ps.filter((p) => p.id !== id);
              })
            }
            onNext={() => {
              setActivePhoto(0);
              setStep("mark");
            }}
          />
        )}

        {step === "mark" && photo && (
          <section className="card">
            {photos.length > 1 && (
              <div className="tabs">
                {photos.map((p, i) => (
                  <button key={p.id} className={p.id === photo.id ? "active" : ""} onClick={() => setActivePhoto(i)}>
                    {t.photo} {i + 1}
                  </button>
                ))}
              </div>
            )}
            <PhotoMarker key={photo.id} photo={photo} placed={placed} onChange={updatePhoto} onPlaceNail={placeNail} />
            <div className="actions">
              <button onClick={() => setStep("capture")}>{t.back}</button>
              <button className="primary" disabled={placed.size === 0} onClick={() => setStep("review")}>
                {t.next}
              </button>
            </div>
          </section>
        )}

        {step === "review" && (
          <ReviewStep
            nails={outlines}
            onBack={() => {
              setProfileNails(null);
              setStep(profileNails ? "intro" : "mark");
            }}
            onNext={() => setStep("design")}
          />
        )}

        {step === "design" && (
          <DesignStep nails={measured} design={design} onChange={setDesign} onBack={() => setStep("review")} onNext={() => setStep("order")} />
        )}

        {step === "order" && (
          <OrderStep
            nails={outlines}
            design={design}
            onBack={() => setStep("design")}
            onPlaced={(id) => {
              saveProfile(outlines);
              setOrderId(id);
              setStep("done");
            }}
          />
        )}

        {step === "done" && (
          <section className="card done">
            <h1>{t.thanks}</h1>
            <p>{t.orderNo}</p>
            <p className="order-id">{orderId}</p>
            <p className="muted">{t.doneNote}</p>
            <button className="primary" onClick={restart}>
              {t.newOrder}
            </button>
          </section>
        )}
      </main>
    </I18nContext.Provider>
  );
}
