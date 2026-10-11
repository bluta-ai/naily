import { useState } from "react";
import { FINGERS, measureNail, type FingerId, type NailOutline } from "@naily/core";
import { useI18n } from "../i18n.ts";
import { FingerLabel } from "./FingerLabel.tsx";
import { NailPreview, orderForDisplay } from "./NailPreview.tsx";

interface Props {
  nails: NailOutline[];
  missing: FingerId[];
  onRescan(finger: FingerId): void;
  onNext(): void;
  onBack(): void;
}

const PLAIN = { main: { patternId: "solid", params: { base: "#f4b6c2" } } };

export function SizesStep({ nails, missing, onRescan, onNext, onBack }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const measured = nails.map(measureNail);
  const byFinger = new Map(measured.map((m) => [m.finger, m]));

  return (
    <section className="card">
      <h1>{missing.length ? t.needRescan : `✓ ${t.sizesTitle}`}</h1>
      {measured.length > 0 && <NailPreview nails={orderForDisplay(measured)} design={PLAIN} />}
      {!missing.length && <p className="big-text">{t.sizesText}</p>}

      {missing.length > 0 ? (
        <button className="primary huge" onClick={() => onRescan(missing[0]!)}>
          📷 {t.rescan}
        </button>
      ) : (
        <button className="primary huge" onClick={onNext}>
          {t.next}
        </button>
      )}

      <button className="plain" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t.details} {open ? "▴" : "▾"}
      </button>
      {open && (
        <table className="sizes">
          <thead>
            <tr>
              <th />
              <th>{t.width}</th>
              <th>{t.length}</th>
              <th>{t.shape}</th>
            </tr>
          </thead>
          <tbody>
            {FINGERS.map((f) => {
              const m = byFinger.get(f);
              return (
                <tr key={f}>
                  <th>
                    <FingerLabel finger={f} />
                    {m?.estimated ? " *" : ""}
                  </th>
                  <td>{m ? `${m.widthMm.toFixed(1)} ${t.mm}` : "—"}</td>
                  <td>{m ? `${m.lengthMm.toFixed(1)} ${t.mm}` : "—"}</td>
                  <td>{m ? t.shapes[m.shape] : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && measured.some((m) => m.estimated) && <p className="muted">{t.mirrored}</p>}

      <button className="link back" onClick={onBack}>
        ‹ {t.back}
      </button>
    </section>
  );
}
