import { useState } from "react";
import {
  MAX_SETS,
  priceOrder,
  PRODUCTS,
  validateOrder,
  type Design,
  type NailOutline,
  type OrderRequest,
  type Product,
  type ShippingAddress,
} from "@naily/core";
import { useI18n } from "../i18n.ts";

interface Props {
  nails: NailOutline[];
  design: Design;
  onBack(): void;
  onPlaced(orderId: string): void;
}

const FIELDS: (keyof ShippingAddress)[] = ["name", "phone", "line1", "line2", "city", "region", "postalCode", "country"];

const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

export function OrderStep({ nails, design, onBack, onPlaced }: Props) {
  const { t, lang } = useI18n();
  const [product, setProduct] = useState<Product>("press-on");
  const [sets, setSets] = useState(1);
  const [shipping, setShipping] = useState<ShippingAddress>({
    name: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
    country: lang === "zh" ? "中国" : "",
  });
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const price = priceOrder(product, sets);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const order: OrderRequest = {
      product,
      sets,
      nails,
      design,
      shipping: { ...shipping, line2: shipping.line2 || undefined },
      ...(email ? { email } : {}),
      ...(note ? { note } : {}),
    };
    const local = validateOrder(order);
    if (local.length) {
      setErrors(local);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(order),
      });
      const body = await res.json();
      if (!res.ok) setErrors(body.errors ?? [body.error ?? `Error ${res.status}`]);
      else onPlaced(body.id);
    } catch {
      setErrors(["Network error, please try again."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t.product}</h2>
      <div className="products">
        {(Object.keys(PRODUCTS) as Product[]).map((p) => (
          <label key={p} className={`product ${p === product ? "active" : ""}`}>
            <input type="radio" name="product" checked={p === product} onChange={() => setProduct(p)} />
            <span>{PRODUCTS[p].name[lang]}</span>
            <strong>{yuan(PRODUCTS[p].priceFen)}</strong>
          </label>
        ))}
      </div>
      <label className="field inline">
        <span>{t.sets}</span>
        <input type="number" min={1} max={MAX_SETS} value={sets} onChange={(e) => setSets(Math.min(MAX_SETS, Math.max(1, Number(e.target.value) || 1)))} />
      </label>

      <h2>{t.orderTitle}</h2>
      <div className="form-grid">
        {FIELDS.map((f) => (
          <label key={f} className={`field ${f === "line1" || f === "line2" ? "wide" : ""}`}>
            <span>{t[f]}</span>
            <input
              value={shipping[f] ?? ""}
              required={f !== "line2"}
              type={f === "phone" ? "tel" : "text"}
              autoComplete={AUTOCOMPLETE[f]}
              onChange={(e) => setShipping({ ...shipping, [f]: e.target.value })}
            />
          </label>
        ))}
        <label className="field wide">
          <span>{t.email}</span>
          <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field wide">
          <span>{t.note}</span>
          <textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <dl className="price">
        <dt>{t.subtotal}</dt>
        <dd>{yuan(price.subtotalFen)}</dd>
        <dt>{t.shipping}</dt>
        <dd>{price.shippingFen ? yuan(price.shippingFen) : t.free}</dd>
        <dt>{t.total}</dt>
        <dd>
          <strong>{yuan(price.totalFen)}</strong>
        </dd>
      </dl>

      {errors.length > 0 && (
        <ul className="warn">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button type="button" onClick={onBack}>
          {t.back}
        </button>
        <button className="primary" disabled={busy}>
          {busy ? t.placing : t.placeOrder}
        </button>
      </div>
    </form>
  );
}

const AUTOCOMPLETE: Record<keyof ShippingAddress, string> = {
  name: "name",
  phone: "tel",
  line1: "address-line1",
  line2: "address-line2",
  city: "address-level2",
  region: "address-level1",
  postalCode: "postal-code",
  country: "country-name",
};
