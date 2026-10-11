import type { FingerId } from "@naily/core";
import { useI18n } from "../i18n.ts";

export function FingerLabel({ finger, short }: { finger: FingerId; short?: boolean }) {
  const { t, lang } = useI18n();
  const hand = t.hands[finger[0] as "L" | "R"];
  const name = t.fingers[Number(finger[1]) as 1 | 2 | 3 | 4 | 5];
  if (short) return <>{`${hand[0]}·${name}`}</>;
  return <>{lang === "zh" ? `${hand}${name}` : `${hand} ${name.toLowerCase()}`}</>;
}
