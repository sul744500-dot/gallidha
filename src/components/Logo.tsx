import { useLang } from "../lib/lang";

export function Logo({ size = "lg" }: { size?: "sm" | "md" | "lg" }) {
  const { lang } = useLang();
  const main = size === "lg" ? "text-6xl sm:text-7xl" : size === "md" ? "text-4xl" : "text-2xl";
  const sub = size === "lg" ? "text-lg sm:text-xl" : size === "md" ? "text-sm" : "text-[10px]";
  return (
    <div className="inline-flex flex-col items-center select-none" dir="rtl" style={{ perspective: "600px" }}>
      <div className={`logo-3d ${main} ${size === "lg" ? "animate-wiggle" : ""}`} style={{ transform: "rotateX(14deg)" }}>
        قلّدها <span className="text-[0.62em]">إذا تقدر</span>
      </div>
      {size !== "sm" && (
        <div className={`logo-sub ${sub} -mt-1`} dir="ltr">
          {lang === "ar" ? "GALLIDHA" : "IMITATE IT IF YOU CAN"}
        </div>
      )}
    </div>
  );
}
