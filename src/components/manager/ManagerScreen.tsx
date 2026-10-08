"use client";

import React from "react";
import Link from "next/link";
import { ViewerCanvas } from "@/components/viewer/ViewerCanvas";
import { MoldBedStage, type BedPartInput } from "@/components/viewer/MoldBedStage";
import { layoutPrintBed } from "@/lib/bed-layout";

/**
 * /manager client screen (mold-studio ticket 15). Env-password gated via
 * /api/manager/login; the end-user UI never links here. Shows the placed
 * orders with the print-bed view (manager-only per ticket 05) and STL/zip
 * downloads.
 */

const faDate = (iso: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));

const PART_COLORS = ["#6b3d48", "#507567", "#b78978", "#3d1f27"];

interface ManagerOrder {
  id: string;
  status: string;
  jobStatus: string;
  jobErrorCode: string | null;
  priceTomans: number;
  sizeCm: number | null;
  createdAt: string;
  thumbnailUrl: string | null;
  parts: Array<{ name: string; dims: number[] | null; fitsRefBed: boolean | null }>;
  artifacts: {
    files: Array<{ name: string; role: string; bytes: number; url: string }>;
    zipUrl: string | null;
  } | null;
}

export function ManagerScreen() {
  const [authed, setAuthed] = React.useState<boolean | null>(null);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [orders, setOrders] = React.useState<ManagerOrder[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/manager/orders");
    if (!res.ok) {
      setAuthed(false);
      return;
    }
    const data = (await res.json()) as { orders: ManagerOrder[] };
    setOrders(data.orders);
    setAuthed(true);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const login = async () => {
    setError(null);
    const res = await fetch("/api/manager/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("رمز درست نیست");
      return;
    }
    setPassword("");
    void load();
  };

  if (authed === null || authed === false) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-xs rounded-2xl border border-line bg-paper p-5 shadow-md">
          <h1 className="text-sm font-extrabold text-plum">پنل مدیر</h1>
          <p className="mt-1 text-[11px] text-ink/55">
            دسترسی داخلی — رمز محیطی.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void login()}
            placeholder="رمز مدیر"
            className="mt-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          />
          {error && <p className="mt-2 text-[11px] text-plum">{error}</p>}
          <button
            type="button"
            onClick={() => void login()}
            className="mt-3 w-full rounded-full bg-plum py-2 text-xs font-extrabold text-paper transition hover:opacity-90"
          >
            ورود
          </button>
        </div>
      </div>
    );
  }

  const selectedOrder = orders?.find((o) => o.id === selected) ?? null;

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-extrabold text-plum">
          پنل مدیر — سفارش‌های قالب
        </h1>
        <span className="flex-1" />
        <Link
          href="/"
          className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-bold text-ink/70 transition hover:border-plum/40 hover:text-plum"
        >
          صفحهٔ اصلی
        </Link>
      </div>

      {orders && orders.length === 0 && (
        <p className="mt-10 text-center text-xs text-ink/50">
          هنوز سفارشی ثبت نشده.
        </p>
      )}

      {orders && orders.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-line">
          <table className="w-full text-right text-xs">
            <thead className="bg-cream text-[11px] text-ink/60">
              <tr>
                <th className="px-3 py-2 font-bold">تاریخ</th>
                <th className="px-3 py-2 font-bold">طرح</th>
                <th className="px-3 py-2 font-bold">اندازه</th>
                <th className="px-3 py-2 font-bold">قیمت</th>
                <th className="px-3 py-2 font-bold">وضعیت</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className={`border-t border-line/70 ${selected === o.id ? "bg-cream/60" : ""}`}
                >
                  <td className="px-3 py-2 tabular-nums">{faDate(o.createdAt)}</td>
                  <td className="px-3 py-2">
                    {o.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={o.thumbnailUrl}
                        alt="طرح"
                        className="h-10 w-10 rounded-lg border border-line object-cover"
                      />
                    ) : (
                      <span className="text-ink/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {o.sizeCm ? `${faSize(o.sizeCm)} سانتی‌متر` : "—"}
                  </td>
                  <td className="px-3 py-2 font-extrabold tabular-nums text-plum">
                    {faSize(o.priceTomans)} تومان
                  </td>
                  <td className="px-3 py-2">
                    {o.jobStatus === "success" ? (
                      <span className="rounded-full bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal">
                        {o.status === "placed" ? "ثبت‌شده" : o.status}
                      </span>
                    ) : (
                      <span className="text-[10px] text-ink/50">
                        جاب: {o.jobErrorCode ?? o.jobStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => setSelected(selected === o.id ? null : o.id)}
                      className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-bold transition hover:border-plum/40 hover:text-plum"
                    >
                      {selected === o.id ? "بستن" : "نمای چاپ"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedOrder && selectedOrder.jobStatus === "success" && (
        <OrderDetail order={selectedOrder} />
      )}
    </div>
  );
}

function faSize(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function OrderDetail({ order }: { order: ManagerOrder }) {
  const overflow = layoutPrintBed(
    order.parts
      .filter((p) => !!p.dims)
      .map((p) => ({ name: p.name, dims: p.dims as [number, number, number] })),
  ).overflow;

  const bedParts: BedPartInput[] = order.artifacts
    ? order.parts
        .filter((p) => !!p.dims)
        .map((p, i) => ({
          name: p.name,
          dims: p.dims as [number, number, number],
          url:
            order.artifacts!.files.find(
              (f) => f.name === `${p.name}.stl` && f.role === "part",
            )?.url ?? "",
          color: PART_COLORS[i % PART_COLORS.length],
        }))
        .filter((p) => !!p.url)
    : [];

  return (
    <section className="mt-5 rounded-2xl border border-line bg-cream/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xs font-extrabold text-plum">
          سفارش {order.id.slice(0, 8)}
        </h2>
        {overflow.length > 0 && (
          <span className="rounded-full bg-plum/10 px-2 py-0.5 text-[10px] font-bold text-plum">
            بیرون از بستر ۲۲۰: {overflow.join("، ")}
          </span>
        )}
        <span className="flex-1" />
        {order.artifacts?.zipUrl && (
          <a
            href={order.artifacts.zipUrl}
            download
            className="rounded-full bg-plum px-3 py-1 text-[11px] font-extrabold text-paper transition hover:opacity-90"
          >
            دانلود ZIP
          </a>
        )}
      </div>

      <div className="mt-3 h-[420px] overflow-hidden rounded-xl border border-line bg-paper">
        {bedParts.length > 0 ? (
          <ViewerCanvas controlsEnabled>
            <MoldBedStage parts={bedParts} />
          </ViewerCanvas>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink/50">
            فایل‌های قطعات در دسترس نیست.
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {order.artifacts?.files.map((f) => (
          <a
            key={f.name}
            href={f.url}
            download
            className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-bold transition hover:border-plum/40 hover:text-plum"
          >
            {f.name} ({faSize(Math.round(f.bytes / 1024))}KB)
          </a>
        ))}
      </div>
    </section>
  );
}
