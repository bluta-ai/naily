import { checkNailPlausible, FINGERS, measureNail, type NailOutline } from "@naily/core";
import { useI18n } from "../i18n.ts";
import { FingerLabel } from "./FingerLabel.tsx";

interface Props {
  nails: NailOutline[];
  onBack(): void;
  onNext(): void;
}

export function ReviewStep({ nails, onBack, onNext }: Props) {
  const { t } = useI18n();
  const measured = nails.map(measureNail);
  const byFinger = new Map(measured.map((m) => [m.finger, m]));
  const missing = FINGERS.filter((f) => !byFinger.has(f));
  const problems = measured.map(checkNailPlausible).filter((p): p is string => p !== null);

  return (
    <section className="card">
      <h2>{t.sizesTitle}</h2>
      <table className="sizes">
        <thead>
          <tr>
            <th />
            <th>{t.width}</th>
            <th>{t.length}</th>
            <th>{t.shape}</th>
            <th>{t.size}</th>
          </tr>
        </thead>
        <tbody>
          {FINGERS.map((f) => {
            const m = byFinger.get(f);
            return (
              <tr key={f} className={m ? "" : "missing"}>
                <th>
                  <FingerLabel finger={f} />
                  {m?.estimated ? " *" : ""}
                </th>
                <td>{m ? `${m.widthMm.toFixed(1)} ${t.mm}` : "—"}</td>
                <td>{m ? `${m.lengthMm.toFixed(1)} ${t.mm}` : "—"}</td>
                <td>{m ? t.shapes[m.shape] : "—"}</td>
                <td>{m ? m.size : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {measured.some((m) => m.estimated) && <p className="muted small">{t.mirrored}</p>}
      {missing.length > 0 && (
        <p className="warn">
          {t.missing}:{" "}
          {missing.map((f, i) => (
            <span key={f}>
              {i > 0 && ", "}
              <FingerLabel finger={f} />
            </span>
          ))}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button onClick={onBack}>{t.back}</button>
        <button className="primary" disabled={missing.length > 0 || problems.length > 0} onClick={onNext}>
          {t.next}
        </button>
      </div>
    </section>
  );
}
