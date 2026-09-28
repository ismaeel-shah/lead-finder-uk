import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "border-input bg-card dark:bg-input/20 flex h-10 w-full min-w-0 rounded-lg border px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-primary/60 focus-visible:ring-primary/15 focus-visible:ring-4 aria-invalid:border-destructive aria-invalid:ring-destructive/15";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldBase, "placeholder:text-muted-foreground/70 py-1 [color-scheme:light] dark:[color-scheme:dark]", className)}
      {...props}
    />
  );
}

/** Native <select>: accessible and good on mobile. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn(fieldBase, "pr-8", className)} {...props} />;
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("text-foreground/80 text-[13px] leading-none font-medium select-none", className)} {...props} />;
}

export { Input, NativeSelect, Label };
