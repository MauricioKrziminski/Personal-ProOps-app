import black from "@/assets/mark-black.png";
import white from "@/assets/mark-white.png";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <>
      <img src={black} alt="ProOps" className={cn("dark:hidden", className)} />
      <img src={white} alt="ProOps" className={cn("hidden dark:block", className)} />
    </>
  );
}
