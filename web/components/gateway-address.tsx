"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "./gateway-connection";

export function GatewayAddress({ publicBase }: { publicBase?: string }) {
  const [base, setBase] = useState(publicBase ?? "");
  useEffect(() => { setBase(publicBase || window.location.origin + "/v1"); }, [publicBase]);
  return (
    <div className="studio-address">
      <label htmlFor="overview-address">URL de la API</label>
      <div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 7 5 5-5 5m7 0h7" /></svg>
        <input id="overview-address" value={base} readOnly onFocus={(event) => event.target.select()} />
        <CopyButton value={base} label="Copiar URL" />
      </div>
    </div>
  );
}
