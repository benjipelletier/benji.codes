import "@longku/styles/longku.css";
import { THEME_BOOT_SCRIPT } from "@longku/lib/theme";

export const metadata = {
  title: "龙库 · chengyu corpus & jielong trainer",
  description:
    "A corpus of every chengyu you know, filed by starting syllable and drilled with 接龙 chains.",
};

export default function LongkuLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Stamps data-theme before first paint so a dark-mode user never sees a
          flash of the paper ground. Must run synchronously, hence the inline
          script rather than an effect. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      {children}
    </>
  );
}
