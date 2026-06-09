import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }) {
  return <div className={cn("rounded-md bg-white/[0.035]", className)} {...props} />;
}

export { Skeleton };
