import type { Metadata } from "next";
import { ServicePicker } from "@/components/landing/ServicePicker";

export const metadata: Metadata = {
  title: "ZeroLab — انتخاب خدمت",
  description: "قالب سیلیکونی سفارشی؛ از ایده تا فایل سه‌بعدی.",
};

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-12 md:py-20">
      <header className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm font-bold tracking-[0.35em] text-teal">
          ZEROLAB
        </p>
        <h1 className="text-3xl font-extrabold leading-snug text-plum md:text-4xl">
          دنیای قالب‌ات را انتخاب کن
        </h1>
        <p className="max-w-xl text-sm leading-8 text-ink/70 md:text-base">
          لابراتوار ZeroLab ایده‌ات را به قالب سیلیکونی سفارشی می‌رساند. اول
          بگو با چه چیزی پر می‌کنی — متریال و ایمنی قالب از همین انتخاب شروع
          می‌شود.
        </p>
      </header>

      <div className="mt-10 md:mt-14">
        <ServicePicker />
      </div>

      <footer className="mt-auto pt-12 text-center text-xs leading-6 text-ink/50">
        انتخاب تو در لابراتوار ذخیره می‌شود و پرامپت‌های متریال را تعیین
        می‌کند — بعداً هم می‌توانی از لابراتوار برگردی و عوضش کنی.
      </footer>
    </main>
  );
}
