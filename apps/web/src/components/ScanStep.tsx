import { useEffect, useRef, useState } from "react";
import type { ScanStep as Step } from "@naily/core";
import { useI18n } from "../i18n.ts";
import { scanPhoto, type ScanResponse } from "../state.ts";
import { Illustration } from "./Illustration.tsx";

interface Props {
  step: Step;
  index: number;
  total: number;
  result?: ScanResponse;
  onResult(result: ScanResponse | undefined): void;
  onNext(): void;
  onBack(): void;
}

/** One photo: picture of what to do, one big button, then a clear yes/no answer. */
export function ScanStep({ step, index, total, result, onResult, onNext, onBack }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const text = t.steps[step];

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPhotoUrl(URL.createObjectURL(file));
    setBusy(true);
    onResult(undefined);
    const res = await scanPhoto(file, step);
    setBusy(false);
    if (!res.ok) setFailures((f) => f + 1);
    onResult(res);
  }

  const takePhoto = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const found = result?.ok ? (result.nails?.length ?? 0) : 0;

  return (
    <section className="card scan">
      <p className="step-count">{t.stepOf(index + 1, total)}</p>
      <h1>{text.title}</h1>

      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      {!photoUrl && (
        <>
          <Illustration step={step} />
          <p className="big-text">{text.text}</p>
          <p className="muted">{t.tip}</p>
          <button className="primary huge" onClick={takePhoto}>
            📷 {t.takePhoto}
          </button>
        </>
      )}

      {photoUrl && (
        <div className="photo-result">
          <PhotoWithOutlines url={photoUrl} result={result} />
          <div aria-live="polite">
            {busy && (
              <p className="status">
                <span className="spinner" aria-hidden /> {t.measuring}
              </p>
            )}
            {result?.ok && <p className="status good">✓ {t.found(found)}</p>}
            {result && !result.ok && <p className="status bad">{t.problems[result.problem ?? "unreadable"]}</p>}
          </div>
          {result?.ok && (
            <>
              <button className="primary huge" onClick={onNext}>
                {t.next}
              </button>
              <button className="plain" onClick={takePhoto}>
                {t.retake}
              </button>
            </>
          )}
          {result && !result.ok && (
            <>
              <button className="primary huge" onClick={takePhoto}>
                📷 {t.tryAgain}
              </button>
              {failures >= 2 && (
                <button className="plain" onClick={onNext}>
                  {t.skip}
                  <small>{t.skipNote}</small>
                </button>
              )}
            </>
          )}
        </div>
      )}

      <button className="link back" onClick={onBack}>
        ‹ {t.back}
      </button>
    </section>
  );
}

function PhotoWithOutlines({ url, result }: { url: string; result?: ScanResponse }) {
  const p = result?.preview;
  const w = p?.width;
  return (
    <div className="photo">
      <img src={url} alt="" />
      {p && w && p.height && (
        <svg viewBox={`0 0 ${w} ${p.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
          {p.card && (
            <polygon
              points={p.card.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="rgba(33,150,243,0.12)"
              stroke="#2196f3"
              strokeWidth={w / 300}
            />
          )}
          {p.nails.map((n) => (
            <polygon
              key={n.finger}
              points={n.points.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="rgba(76,175,80,0.25)"
              stroke="#2e7d32"
              strokeWidth={w / 350}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
