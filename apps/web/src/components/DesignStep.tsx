import {
  defaultParams,
  getPattern,
  PATTERNS,
  renderNail,
  renderSheet,
  type Design,
  type NailMeasurement,
  type PatternChoice,
} from "@naily/core";
import { useI18n } from "../i18n.ts";
import { NailPreview, orderForDisplay } from "./NailPreview.tsx";

interface Props {
  nails: NailMeasurement[];
  design: Design;
  onChange(design: Design): void;
  onBack(): void;
  onNext(): void;
}

export function DesignStep({ nails, design, onChange, onBack, onNext }: Props) {
  const { t } = useI18n();
  const sample = nails.find((n) => n.finger === "R3") ?? nails[0]!;

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
      <h2>{t.designTitle}</h2>
      <NailPreview nails={orderForDisplay(nails)} design={design} />
      <p className="muted small">{t.previewNote}</p>

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

      <div className="actions">
        <button onClick={onBack}>{t.back}</button>
        <button onClick={download}>{t.download}</button>
        <button className="primary" onClick={onNext}>
          {t.next}
        </button>
      </div>
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
