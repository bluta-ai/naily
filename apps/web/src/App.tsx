import { useMemo, useState } from "react";
import { measureNail, PRESETS, SCAN_STEPS, type Design, type FingerId, type NailOutline, type ScanStep as Step } from "@naily/core";
import { detectLang, dictionaries, I18nContext, type Lang } from "./i18n.ts";
import { collectNails, loadProfile, saveProfile, type ScanResponse, type StepResults } from "./state.ts";
import { ScanStep } from "./components/ScanStep.tsx";
import { SizesStep } from "./components/SizesStep.tsx";
import { DesignStep } from "./components/DesignStep.tsx";
import { OrderStep } from "./components/OrderStep.tsx";

type Screen = { name: "welcome" } | { name: "scan"; index: number } | { name: "sizes" } | { name: "design" } | { name: "order" } | { name: "done" };

const stepFor = (finger: FingerId): Step =>
  `${finger[0] === "L" ? "left" : "right"}-${finger.endsWith("1") ? "thumb" : "hand"}` as Step;

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = dictionaries[lang];
  const [screen, setScreen] = useState<Screen>({ name: "welcome" });
  const [results, setResults] = useState<StepResults>({});
  /** This visit's photos, kept in memory only, for the try-on preview. */
  const [photos, setPhotos] = useState<Partial<Record<Step, File>>>({});
  const [savedNails] = useState<NailOutline[] | null>(loadProfile);
  /** Set when the customer reuses saved sizes instead of taking photos. */
  const [profileNails, setProfileNails] = useState<NailOutline[] | null>(null);
  const [design, setDesign] = useState<Design>(PRESETS[0]!.design);
  const [orderId, setOrderId] = useState<string | null>(null);

  const collected = useMemo(() => collectNails(results), [results]);
  const nails = profileNails ?? collected.nails;
  const missing = profileNails ? [] : collected.missing;
  const measured = useMemo(() => nails.map(measureNail), [nails]);

  const setResult = (step: Step, r: ScanResponse | undefined, photo?: File) => {
    setResults((prev) => ({ ...prev, [step]: r }));
    if (photo) setPhotos((prev) => ({ ...prev, [step]: photo }));
  };
  const shots = profileNails
    ? []
    : (["left-hand", "right-hand"] as Step[]).flatMap((step) => {
        const file = photos[step];
        const result = results[step];
        return file && result ? [{ step, file, result }] : [];
      });

  function restart() {
    setResults({});
    setPhotos({});
    setProfileNails(null);
    setDesign(PRESETS[0]!.design);
    setOrderId(null);
    setScreen({ name: "welcome" });
  }

  return (
    <I18nContext.Provider value={{ t, lang }}>
      <header className="top">
        <button className="brand" onClick={restart}>
          Naily <span>甲印</span>
        </button>
        <button className="lang" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
          {lang === "zh" ? "English" : "中文"}
        </button>
      </header>

      <main>
        {screen.name === "welcome" && (
          <section className="card welcome">
            <h1>{t.tagline}</h1>
            <p className="big-text">{t.welcomeText}</p>
            <h2>{t.need}</h2>
            <ul className="needs">
              <li>📱 {t.needPhone}</li>
              <li>💳 {t.needCard}</li>
              <li>💡 {t.needLight}</li>
            </ul>
            <button className="primary huge" onClick={() => setScreen({ name: "scan", index: 0 })}>
              {t.start}
            </button>
            {savedNails && (
              <button
                className="plain"
                onClick={() => {
                  setProfileNails(savedNails);
                  setScreen({ name: "sizes" });
                }}
              >
                {t.useSaved}
              </button>
            )}
            <p className="muted">🔒 {t.privacy}</p>
          </section>
        )}

        {screen.name === "scan" && (
          <ScanStep
            key={SCAN_STEPS[screen.index]}
            step={SCAN_STEPS[screen.index]!}
            index={screen.index}
            total={SCAN_STEPS.length}
            result={results[SCAN_STEPS[screen.index]!]}
            onResult={(r, photo) => setResult(SCAN_STEPS[screen.index]!, r, photo)}
            onNext={() =>
              setScreen(screen.index + 1 < SCAN_STEPS.length ? { name: "scan", index: screen.index + 1 } : { name: "sizes" })
            }
            onBack={() => setScreen(screen.index === 0 ? { name: "welcome" } : { name: "scan", index: screen.index - 1 })}
          />
        )}

        {screen.name === "sizes" && (
          <SizesStep
            nails={nails}
            missing={missing}
            onRescan={(finger) => setScreen({ name: "scan", index: SCAN_STEPS.indexOf(stepFor(finger)) })}
            onNext={() => setScreen({ name: "design" })}
            onBack={() => {
              if (profileNails) {
                setProfileNails(null);
                setScreen({ name: "welcome" });
              } else setScreen({ name: "scan", index: SCAN_STEPS.length - 1 });
            }}
          />
        )}

        {screen.name === "design" && (
          <DesignStep
            nails={measured}
            shots={shots}
            design={design}
            onChange={setDesign}
            onBack={() => setScreen({ name: "sizes" })}
            onNext={() => setScreen({ name: "order" })}
          />
        )}

        {screen.name === "order" && (
          <OrderStep
            nails={nails}
            design={design}
            onBack={() => setScreen({ name: "design" })}
            onPlaced={(id) => {
              saveProfile(nails);
              setOrderId(id);
              setScreen({ name: "done" });
            }}
          />
        )}

        {screen.name === "done" && (
          <section className="card done">
            <h1>✓ {t.thanks}</h1>
            <p className="big-text">{t.orderNo}</p>
            <p className="order-id">{orderId}</p>
            <p className="big-text muted">{t.doneNote}</p>
            <button className="primary huge" onClick={restart}>
              {t.newOrder}
            </button>
          </section>
        )}
      </main>
    </I18nContext.Provider>
  );
}
