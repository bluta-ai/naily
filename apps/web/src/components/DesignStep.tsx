import { useState } from "react";
import {
  defaultParams,
  getPattern,
  PATTERNS,
  PRESETS,
  renderNail,
  renderSheet,
  type Design,
  type NailMeasurement,
  type PatternChoice,
} from "@naily/core";
import { useI18n } from "../i18n.ts";
import { NailPreview, orderForDisplay } from "./NailPreview.tsx";
import { BROWSER_MODE } from "../backend.ts";

interface Props {
  nails: NailMeasurement[];
  design: Design;
  onChange(design: Design): void;
  onBack(): void;
  onNext(): void;
}

export function DesignStep({ nails, design, onChange, onBack, onNext }: Props) {
  const { t, lang } = useI18n();
  const [customising, setCustomising] = useState(false);
  const sample = nails.find((n) => n.finger === "R3") ?? nails[0]!;
  const hand = orderForDisplay(nails).filter((n) => n.finger[0] === "R");
  const current = JSON.stringify(design);

  function download() {
    const svg = renderSheet(nails, design, { cutLines: false, title: "Naily" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = "naily-design.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="card">
      <h1>{t.designTitle}</h1>
      <NailPreview nails={orderForDisplay(nails)} design={design} />
      <p className="muted">{t.previewNote}</p>

      {!customising && (
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`preset ${JSON.stringify(p.design) === current ? "active" : ""}`}
              aria-pressed={JSON.stringify(p.design) === current}
              onClick={() => onChange(p.design)}
            >
              <NailPreview nails={hand} design={p.design} />
              <span>{p.name[lang]}</span>
            </button>
          ))}
        </div>
      )}

      {customising && (
        <>
          <PatternEditor id="main" sample={sample} choice={design.main} onChange={(main) => onChange({ ...design, main })} />
          <label className="toggle">
            <input
              type="checkbox"
              checked={Boolean(design.accent)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? { ...design, accent: { fingers: ["L4", "R4"], patternId: "glitter", params: defaultParams(getPattern("glitter")!) } }
                    : { main: design.main },
                )
              }
            />
            {t.accent}
          </label>
          {design.accent && (
            <PatternEditor
              id="accent"
              sample={nails.find((n) => n.finger === "R4") ?? sample}
              choice={design.accent}
              onChange={(c) => onChange({ ...design, accent: { ...c, fingers: design.accent!.fingers } })}
            />
          )}
        </>
      )}

      <button className="primary huge" onClick={onNext}>
        {t.next}
      </button>
      <div className="row">
        <button className="plain" onClick={() => setCustomising(!customising)}>
          {customising ? t.hideCustomise : `🎨 ${t.customise}`}
        </button>
        {/* Hosted pages (Claude Artifacts) cannot start downloads. */}
        {!BROWSER_MODE && (
          <button className="plain" onClick={download}>
            {t.download}
          </button>
        )}
      </div>
      <button className="link back" onClick={onBack}>
        ‹ {t.back}
      </button>
    </section>
  );
}

function PatternEditor({ id, sample, choice, onChange }: { id: string; sample: NailMeasurement; choice: PatternChoice; onChange(c: PatternChoice): void }) {
  const { lang } = useI18n();
  const pattern = getPattern(choice.patternId)!;
  return (
    <div className="pattern-editor">
      <div className="patterns">
        {PATTERNS.map((p) => {
          const preview = { patternId: p.id, params: p.id === choice.patternId ? choice.params : defaultParams(p) };
          return (
            <button
              key={p.id}
              className={`pattern ${p.id === choice.patternId ? "active" : ""}`}
              onClick={() => p.id !== choice.patternId && onChange({ patternId: p.id, params: defaultParams(p) })}
            >
              <svg
                viewBox={`-0.5 -0.5 ${sample.widthMm + 1} ${sample.lengthMm + 1}`}
                dangerouslySetInnerHTML={{ __html: renderNail(sample, { main: preview }, { uid: `pp-${id}-${p.id}` }) }}
              />
              <span>{p.name[lang]}</span>
            </button>
          );
        })}
      </div>
      <div className="params">
        {pattern.params.map((spec) => (
          <label key={spec.key}>
            <span>{spec.label[lang]}</span>
            {spec.type === "color" ? (
              <input
                type="color"
                value={String(choice.params[spec.key])}
                onChange={(e) => onChange({ ...choice, params: { ...choice.params, [spec.key]: e.target.value } })}
              />
            ) : (
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={Number(choice.params[spec.key])}
                onChange={(e) => onChange({ ...choice, params: { ...choice.params, [spec.key]: Number(e.target.value) } })}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
