import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.ts";
import { loadPhoto, type Photo } from "../state.ts";

interface Props {
  photos: Photo[];
  onAdd(photo: Photo): void;
  onRemove(id: string): void;
  onNext(): void;
}

export function CaptureStep({ photos, onAdd, onRemove, onNext }: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => () => stream?.getTracks().forEach((tr) => tr.stop()), [stream]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  async function openCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      setStream(s);
      setError(false);
    } catch {
      setError(true);
    }
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.95));
    if (blob) onAdd(await loadPhoto(blob));
  }

  async function upload(files: FileList | null) {
    for (const f of Array.from(files ?? [])) onAdd(await loadPhoto(f));
  }

  return (
    <section className="card">
      <h2>{t.capture}</h2>
      <p className="muted">{t.captureHint}</p>

      {stream ? (
        <div className="camera">
          <video ref={videoRef} autoPlay playsInline muted />
          <div className="camera-guide" aria-hidden>
            <div className="guide-card" />
            <div className="guide-hand" />
          </div>
          <button className="primary shutter" onClick={shoot}>
            {t.shoot}
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="primary" onClick={openCamera}>
            {t.openCamera}
          </button>
          <label className="button">
            {t.upload}
            <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => upload(e.target.files)} />
          </label>
        </div>
      )}
      {error && <p className="warn">{t.cameraError}</p>}

      {photos.length > 0 && (
        <div className="thumbs">
          {photos.map((p) => (
            <figure key={p.id}>
              <img src={p.url} alt="" />
              <button className="link" onClick={() => onRemove(p.id)}>
                {t.remove}
              </button>
            </figure>
          ))}
        </div>
      )}

      <div className="actions">
        <span />
        <button className="primary" disabled={photos.length === 0} onClick={onNext}>
          {t.next}
        </button>
      </div>
    </section>
  );
}
